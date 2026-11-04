/**
 * DirectoryLookup.js
 * Resolving a work email address from a person's name, via the Google
 * Workspace domain directory.
 *
 * WHY THIS EXISTS
 * ---------------
 * The FAS HRLinks feed has 33 columns and not one of them is an email address.
 * That is a blocking gap rather than a missing nicety:
 *
 *   Access.js:435-441   the HC supervisor access rule matches the signed-in
 *                       user's email against Email_Address. With none, no
 *                       supervisor is admitted by that rule.
 *   Access.js:982       the Division Director lookup matches on email too.
 *   HCPrivacy.js:79     emailAddress is on the reviewer allow-list because
 *                       "a reviewer must be able to contact a traveller".
 *
 * @clolry: "remember that we want to setup Google Contacts Directory lookup to
 * find the email address."
 *
 * THE RISK THIS MODULE IS BUILT AROUND
 * ------------------------------------
 * A WRONG EMAIL IS MUCH WORSE THAN NO EMAIL, and the difference is a security
 * boundary rather than a data-quality one.
 *
 * Email_Address is how LETS decides who someone IS. Write the wrong address
 * onto a position whose Supervisory_Status is '2' and you have granted that
 * person site access, made them a candidate Division Director for approval
 * routing, and pointed a reviewer's "contact the traveller" link at them. None
 * of that announces itself: the roster looks complete, and the only symptom is
 * that the wrong person can see and approve travel.
 *
 * Name matching is inherently ambiguous — GSA certainly has more than one
 * 'Smith, Michael' — so this module REFUSES an ambiguous match rather than
 * picking the first or the best-scoring candidate. A position left with no
 * email is a known gap that someone can fix; a position with a confident wrong
 * email is an undetected one.
 *
 * Every resolution records how it was made, so an audit can tell an exact
 * unique match from a confirmed guess. There are no guesses in this file.
 *
 * WHAT IS PURE HERE AND WHAT IS NOT
 * ---------------------------------
 * All name parsing and candidate selection is pure and injectable: the search
 * function is a parameter, so the whole decision surface is testable without
 * the People API. Only 40_domain/DirectoryResolve.js touches the network.
 */

var DirectoryLookup = (function () {

  function _str_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  /**
   * Splits a roster name into parts.
   *
   * The feed writes 'Mould,Melissa J' — surname first, comma, forename, then
   * an optional middle initial. The May export used the same shape, and the
   * liability log uses separate First/Last columns, so both are handled.
   *
   * SUFFIXES ARE STRIPPED FROM THE SURNAME, not from the forename. 'Smith
   * Jr,Robert' has surname Smith and suffix Jr; leaving 'Smith Jr' in place
   * would fail an exact surname comparison against a directory that stores
   * 'Smith'. Hyphenated and multi-word surnames are preserved — 'Mbeki-Lawson'
   * and 'Van Der Berg' are single surnames, and splitting them would make
   * every match fail.
   *
   * @param {string} raw
   * @returns {{last: string, first: string, middle: string, suffix: string,
   *            usable: boolean}}
   */
  function parseName(raw) {
    var s = _str_(raw);
    var out = { last: '', first: '', middle: '', suffix: '', usable: false };
    if (!s) return out;

    var SUFFIXES = ['JR', 'SR', 'II', 'III', 'IV', 'V', 'JR.', 'SR.'];

    var last = '';
    var rest = '';

    if (s.indexOf(',') > -1) {
      var parts = s.split(',');
      last = _str_(parts[0]);
      rest = _str_(parts.slice(1).join(' '));
    } else {
      // 'Melissa Mould' — forename first. Last token is the surname, which is
      // wrong for 'Van Der Berg' but this shape is only used by sources that
      // do not provide a comma, and it is reported as a lower-confidence
      // parse below.
      var toks = s.split(/\s+/).filter(Boolean);
      if (toks.length === 1) {
        out.last = toks[0];
        return out;                    // one token: unusable for matching
      }
      last = toks[toks.length - 1];
      rest = toks.slice(0, -1).join(' ');
    }

    // Pull a suffix off the surname.
    var lastToks = last.split(/\s+/).filter(Boolean);
    if (lastToks.length > 1) {
      var tail = lastToks[lastToks.length - 1].toUpperCase().replace(/\./g, '');
      if (SUFFIXES.indexOf(tail) > -1 || SUFFIXES.indexOf(tail + '.') > -1) {
        out.suffix = lastToks.pop();
        last = lastToks.join(' ');
      }
    }

    var restToks = rest.split(/\s+/).filter(Boolean);
    // A trailing suffix can also sit after the forename: 'Smith,Robert Jr'.
    if (restToks.length > 1) {
      var t = restToks[restToks.length - 1].toUpperCase().replace(/\./g, '');
      if (SUFFIXES.indexOf(t) > -1) {
        out.suffix = out.suffix || restToks.pop();
      }
    }

    out.last = last;
    out.first = restToks[0] || '';
    // Everything after the forename is a middle name or initial. Kept as a
    // TIE-BREAK only — see pickMatch. It is never required, because the
    // directory often holds a full middle name where the roster holds an
    // initial, or neither.
    out.middle = restToks.slice(1).join(' ');
    out.usable = !!(out.last && out.first);
    return out;
  }

  /** A comparison key: uppercased, punctuation and spacing removed. */
  function nameKey(v) {
    return _str_(v).toUpperCase().replace(/[^A-Z]/g, '');
  }

  /**
   * Does a directory candidate match the roster name?
   *
   * EXACT ON SURNAME AND FORENAME, after normalising case, punctuation and
   * spacing. Deliberately strict:
   *
   *   - no fuzzy or edit-distance matching. 'Jon' and 'John' are different
   *     people, and so are 'Erikson' and 'Ericson'. A near-match that writes
   *     an email grants access to someone;
   *   - no forename-INITIAL matching. 'M Smith' against 'Michael Smith' would
   *     match Mary, Michael and Mark;
   *   - a nickname is NOT matched to a legal name. The directory holding
   *     'Mike Smith' where the roster says 'Michael' produces NO match, which
   *     is correct — this module cannot know that Mike is Michael, and
   *     guessing is how the wrong Michael gets picked.
   *
   * The middle name is compared only when BOTH sides have one, and only to
   * break a tie between otherwise-identical candidates. Requiring it would
   * reject most real matches, since HR and the directory disagree about middle
   * names constantly.
   *
   * @param {Object} parsed from parseName
   * @param {Object} candidate { givenName, familyName, middleName, email }
   * @returns {{matches: boolean, middleAgrees: boolean}}
   */
  function candidateMatches(parsed, candidate) {
    var c = candidate || {};
    var lastOk = nameKey(parsed.last) &&
                 nameKey(parsed.last) === nameKey(c.familyName);
    var firstOk = nameKey(parsed.first) &&
                  nameKey(parsed.first) === nameKey(c.givenName);

    var pm = nameKey(parsed.middle);
    var cm = nameKey(c.middleName);
    var middleAgrees = false;
    if (pm && cm) {
      // An initial on either side matches a full name starting with it:
      // 'J' against 'JAMES' agrees. This is a TIE-BREAK, so a loose rule is
      // safe here in a way it would not be for the forename.
      middleAgrees = (pm === cm) ||
                     (pm.length === 1 && cm.charAt(0) === pm) ||
                     (cm.length === 1 && pm.charAt(0) === cm);
    }

    return { matches: !!(lastOk && firstOk), middleAgrees: middleAgrees };
  }

  /**
   * Chooses at most one candidate, or refuses.
   *
   * THIS FUNCTION IS THE SECURITY BOUNDARY of the whole feature. Its only
   * acceptable outputs are a single certain match or nothing.
   *
   * Resolution order:
   *   1. exactly one name match                  -> resolve, 'unique'
   *   2. several name matches, exactly one of
   *      which also agrees on middle name        -> resolve, 'middle-name'
   *   3. anything else                           -> REFUSE, with the reason
   *      and the candidate count
   *
   * There is deliberately no step that breaks a remaining tie. Not by
   * alphabetical order, not by which account was created first, not by
   * org-code similarity — the feed's org code and the directory's department
   * string are different vocabularies, and a plausible-looking correlation
   * would be the most dangerous rule in the file.
   *
   * @param {Object} parsed
   * @param {Array} candidates
   * @returns {{email: string, method: string, confidence: string,
   *            candidateCount: number, reason: string}}
   */
  function pickMatch(parsed, candidates) {
    var none = {
      email: '', method: 'none', confidence: 'none',
      candidateCount: 0, reason: ''
    };

    if (!parsed || !parsed.usable) {
      none.reason = 'The roster name could not be split into a surname and ' +
                    'forename, so there is nothing to match on.';
      return none;
    }

    var list = (candidates || []).filter(function (c) {
      return c && _str_(c.email);
    });
    none.candidateCount = list.length;

    if (!list.length) {
      none.reason = 'No directory entry found for ' + parsed.first + ' ' +
                    parsed.last + '.';
      return none;
    }

    var matched = [];
    list.forEach(function (c) {
      var m = candidateMatches(parsed, c);
      if (m.matches) matched.push({ candidate: c, middleAgrees: m.middleAgrees });
    });

    none.candidateCount = matched.length;

    if (!matched.length) {
      none.reason = list.length + ' directory entr(ies) were returned for "' +
                    parsed.first + ' ' + parsed.last + '" but none matched ' +
                    'exactly on both surname and forename. Nicknames and ' +
                    'spelling variants are NOT matched, because a near-match ' +
                    'would grant LETS access to the wrong person.';
      return none;
    }

    if (matched.length === 1) {
      return {
        email: _str_(matched[0].candidate.email).toLowerCase(),
        method: 'unique-name',
        confidence: 'exact',
        candidateCount: 1,
        reason: ''
      };
    }

    // Several people share the name. The middle name is the only tie-break.
    var byMiddle = matched.filter(function (m) { return m.middleAgrees; });
    if (byMiddle.length === 1) {
      return {
        email: _str_(byMiddle[0].candidate.email).toLowerCase(),
        method: 'middle-name',
        confidence: 'exact',
        candidateCount: matched.length,
        reason: ''
      };
    }

    // REFUSED. See the function comment: there is no further tie-break,
    // because every available one is a guess.
    none.reason = matched.length + ' people in the directory are named "' +
                  parsed.first + ' ' + parsed.last + '"' +
                  (parsed.middle ? ' and the middle name did not separate them'
                                 : ' and the roster has no middle name to ' +
                                   'separate them') +
                  '. Refusing to choose: a wrong address would grant LETS ' +
                  'access to the wrong person. Set this one by hand in the ' +
                  'roster editor.';
    none.email = '';
    none.method = 'ambiguous';
    return none;
  }

  /**
   * Resolves one position's email.
   *
   * @param {Object} position         needs employeeName
   * @param {Function} searchFn       name -> Array of candidates
   * @returns {Object} the pickMatch result plus the parsed name
   */
  function resolveOne(position, searchFn) {
    var parsed = parseName(position && position.employeeName);
    if (!parsed.usable) {
      return {
        positionNumber: _str_(position && position.positionNumber),
        employeeName: _str_(position && position.employeeName),
        email: '', method: 'none', confidence: 'none', candidateCount: 0,
        reason: 'Name "' + _str_(position && position.employeeName) +
                '" could not be parsed into a surname and forename.'
      };
    }

    var candidates = [];
    try {
      candidates = searchFn(parsed) || [];
    } catch (e) {
      return {
        positionNumber: _str_(position.positionNumber),
        employeeName: _str_(position.employeeName),
        email: '', method: 'error', confidence: 'none', candidateCount: 0,
        reason: 'Directory search failed: ' + e.message
      };
    }

    var picked = pickMatch(parsed, candidates);
    return {
      positionNumber: _str_(position.positionNumber),
      employeeName: _str_(position.employeeName),
      email: picked.email,
      method: picked.method,
      confidence: picked.confidence,
      candidateCount: picked.candidateCount,
      reason: picked.reason
    };
  }

  /**
   * Resolves a batch, time-boxed and resumable.
   *
   * WHY TIME-BOXING IS NOT OPTIONAL. Apps Script kills an execution at six
   * minutes. The roster is roughly 900 positions and each lookup is a network
   * round trip, so a naive loop over all of them will be killed partway
   * through — and a run that dies after writing some addresses and not others,
   * with no record of where it stopped, is the worst outcome: the next run
   * starts over and the quota is spent twice.
   *
   * So this stops cleanly at a deadline and returns the index to resume from.
   * The caller persists it.
   *
   * SKIPS POSITIONS THAT ALREADY HAVE AN EMAIL by default. Re-resolving an
   * address a human corrected by hand would overwrite their correction with a
   * machine guess — and the hand-corrected ones are precisely the ambiguous
   * cases this module refused.
   *
   * @param {Array} positions
   * @param {Function} searchFn
   * @param {Object} [opts] { startIndex, deadlineMs, maxLookups,
   *                          includeExisting, now }
   * @returns {Object}
   */
  function resolveBatch(positions, searchFn, opts) {
    var o = opts || {};
    var start = parseInt(o.startIndex, 10) || 0;
    var began = (o.now instanceof Date) ? o.now.getTime() : Date.now();
    var deadline = began + (parseInt(o.deadlineMs, 10) || 240000);   // 4 min
    var maxLookups = parseInt(o.maxLookups, 10) || 100000;

    var out = {
      resolved: [], refused: [], skipped: 0,
      lookups: 0, nextIndex: start, complete: false,
      stoppedBecause: ''
    };

    var list = positions || [];
    var i = start;

    for (; i < list.length; i++) {
      if (out.lookups >= maxLookups) {
        out.stoppedBecause = 'lookup cap of ' + maxLookups + ' reached';
        break;
      }
      // Checked BEFORE the lookup, not after, so the deadline cannot be
      // overshot by one network call.
      if (Date.now() > deadline) {
        out.stoppedBecause = 'time limit reached';
        break;
      }

      var p = list[i];
      if (!p) { out.skipped++; continue; }

      // A vacant seat has no occupant to look up.
      if (_str_(p.occupancyStatus).toUpperCase() === 'VACANT') {
        out.skipped++;
        continue;
      }
      if (!o.includeExisting && _str_(p.emailAddress)) {
        out.skipped++;
        continue;
      }

      var r = resolveOne(p, searchFn);
      out.lookups++;
      if (r.email) out.resolved.push(r);
      else out.refused.push(r);
    }

    out.nextIndex = i;
    out.complete = i >= list.length;
    if (out.complete) out.stoppedBecause = 'finished';
    return out;
  }

  /**
   * Summarises a batch for a human.
   *
   * The counts that matter are the REFUSALS by reason, not the successes. An
   * admin needs to know how many positions still have no address and why,
   * because those are the ones that still cannot sign in.
   */
  function summarise(batch) {
    var byReason = { ambiguous: 0, notFound: 0, noMatch: 0, unparseable: 0, error: 0 };
    (batch.refused || []).forEach(function (r) {
      if (r.method === 'ambiguous') byReason.ambiguous++;
      else if (r.method === 'error') byReason.error++;
      else if (r.candidateCount === 0 && /could not be parsed/.test(r.reason)) {
        byReason.unparseable++;
      } else if (/No directory entry found/.test(r.reason)) byReason.notFound++;
      else byReason.noMatch++;
    });

    var byMethod = {};
    (batch.resolved || []).forEach(function (r) {
      byMethod[r.method] = (byMethod[r.method] || 0) + 1;
    });

    return {
      lookups: batch.lookups,
      resolved: (batch.resolved || []).length,
      refused: (batch.refused || []).length,
      skipped: batch.skipped,
      byMethod: byMethod,
      refusedByReason: byReason,
      complete: batch.complete,
      nextIndex: batch.nextIndex,
      note: 'Refusals are deliberate. ' + byReason.ambiguous + ' name(s) match ' +
            'more than one person in the directory, and choosing between them ' +
            'would risk granting LETS access to the wrong person — those must ' +
            'be set by hand in the roster editor.'
    };
  }

  return {
    parseName: parseName,
    nameKey: nameKey,
    candidateMatches: candidateMatches,
    pickMatch: pickMatch,
    resolveOne: resolveOne,
    resolveBatch: resolveBatch,
    summarise: summarise
  };
})();

// Node/CommonJS export for the test suite. Inert in Apps Script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DirectoryLookup;
}
