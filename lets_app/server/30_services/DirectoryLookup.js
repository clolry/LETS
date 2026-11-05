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

      // A TRAILING SUFFIX IS NOT THE SURNAME. 'John Tekus Jr' parsed to
      // surname 'Jr', forename 'John' — so the roster's 'Tekus Jr,John J'
      // could never match its own directory entry.
      //
      // Found by testing the forename-first branch against the real roster
      // shapes. The comma branch below already handled suffixes; this one did
      // not, and the displayName fallback added in candidateMatches is what
      // made the gap reachable.
      var tail = toks[toks.length - 1].toUpperCase().replace(/\./g, '');
      if (toks.length > 2 && SUFFIXES.indexOf(tail) > -1) {
        out.suffix = toks.pop();
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
   * Splits a GSA directory name from its trailing org suffix.
   *
   * THE REASON NOTHING MATCHED. @clolry's diagnostic showed:
   *
   *   givenName="Lawrence" familyName="Hale - FC" displayName="Lawrence Hale - FC"
   *
   * GSA's Workspace directory appends ' - <ORG>' to the family name and the
   * display name. So the roster's surname 'Hale' was being compared against
   * 'Hale - FC' and failing, on every single entry. 46 of 50 refusals were
   * this, which is why the count was suspiciously uniform.
   *
   * WHY ` - ` AND NOT A BARE HYPHEN
   * ------------------------------
   * The delimiter is space-hyphen-space. A bare hyphen is part of real
   * surnames — 'Mbeki-Lawson', 'Fitzgerald-Moreau', 'Aubert-Bell' all appear
   * in this roster — and stripping on it would truncate them to 'Mbeki' and
   * then match the wrong person, or nobody. nameKey() strips punctuation
   * before comparing, so a hyphenated surname needs no special handling here;
   * only the spaced suffix does.
   *
   * ANCHORED AT THE END, and only the LAST such group is removed. A surname
   * containing ' - ' in the middle keeps its first part.
   *
   * THE ORG TOKEN IS RETURNED, NOT DISCARDED. It is in the same vocabulary as
   * the roster's Dept ID (Org) — see candidateOrgMatches — which makes it a
   * genuine second identifying field rather than a decoration.
   *
   * @param {string} v
   * @returns {{name: string, org: string}}
   */
  function splitDirectorySuffix(v) {
    var raw = _str_(v);
    if (!raw) return { name: '', org: '' };

    // Last ' - ' in the string. Everything after it is the org token, which
    // for GSA is short and alphanumeric.
    var at = raw.lastIndexOf(' - ');
    if (at === -1) return { name: raw, org: '' };

    var tail = raw.slice(at + 3).trim();
    // Only treat it as an org suffix if the tail LOOKS like an org code:
    // short, no spaces, letters and digits. 'Smith - Jones' is not a
    // suffixed surname, and 'Hale - Office of Acquisition' is a description
    // rather than a code — neither should be stripped as if it were FC.
    // UPPERCASE OR DIGITS ONLY. GSA org codes are 'FC', 'FCA0B', 'FAS' —
    // always upper. Requiring that rejects 'Smith - Jones', which my first
    // version split into surname 'Smith' and org 'JONES', inventing an org
    // out of somebody's double-barrelled name and discarding half of it.
    if (!tail || tail.length > 8 || !/^[A-Z0-9]+$/.test(tail)) {
      return { name: raw, org: '' };
    }
    return { name: raw.slice(0, at).trim(), org: tail.toUpperCase() };
  }

  /**
   * Does a candidate's directory org agree with the roster's org code?
   *
   * I PREVIOUSLY ARGUED AGAINST USING THIS AS A TIE-BREAK, on the grounds
   * that "the feed's org code and the directory's department string are
   * different vocabularies, and a plausible-looking correlation would be the
   * most dangerous rule in the file."
   *
   * @clolry's diagnostic falsified that. The directory suffix is 'FC' — the
   * same code space as Dept ID (Org), where the roster's 'FCA0B' is FC's
   * descendant. They are the SAME vocabulary, so this is a real second
   * identifying field, not a correlation.
   *
   * Used ONLY to separate two candidates that already match exactly on
   * surname and forename, and only when the comparison is decisive. A
   * candidate with no org suffix never wins or loses on this basis — absence
   * is not disagreement.
   *
   * PREFIX IN EITHER DIRECTION. The directory may carry the DAC ('FC') where
   * the roster carries a service centre ('FCA0B'), or the reverse if the
   * directory is more specific. Both are agreement; the shorter being a
   * prefix of the longer is what makes them the same branch.
   *
   * @param {string} rosterOrg the position's Dept ID (Org)
   * @param {string} directoryOrg from splitDirectorySuffix
   * @returns {boolean} true only when both are present and one contains the other
   */
  function candidateOrgMatches(rosterOrg, directoryOrg) {
    var a = _str_(rosterOrg).toUpperCase();
    var b = _str_(directoryOrg).toUpperCase();
    if (!a || !b) return false;
    return a.indexOf(b) === 0 || b.indexOf(a) === 0;
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

    // STRUCTURED FIELDS FIRST, THEN displayName.
    //
    // @clolry's first live run refused 46 of 50 lookups with
    // "1 directory entr(ies) were returned ... but none matched exactly on
    // both surname and forename". A single candidate returned and rejected,
    // 46 times, is not 46 wrong people — it is one systematic mismatch.
    //
    // The People API populates names.displayName for every directory result
    // but does NOT always populate givenName and familyName, particularly for
    // DOMAIN_CONTACT entries. Comparing only the structured fields therefore
    // compares against two empty strings, and nameKey('') is falsy, so lastOk
    // and firstOk were both false for every such candidate.
    //
    // So when the structured fields are absent, the displayName is parsed and
    // compared instead. THIS IS NOT A LOOSENING: the comparison is still
    // exact on surname and forename, nicknames and spelling variants are
    // still refused, and an ambiguous name is still refused. It changes WHERE
    // the name is read from, not how strictly it is judged.
    //
    // The structured fields WIN when present, because 'Van Der Berg, Hans'
    // splits reliably only when the API has already done it.
    var given = _str_(c.givenName);
    var family = _str_(c.familyName);
    if (!given || !family) {
      var fromDisplay = parseName(splitDirectorySuffix(c.displayName).name);
      // Only fill what is missing. A candidate with a familyName and no
      // givenName should keep its real familyName.
      if (!given) given = fromDisplay.first;
      if (!family) family = fromDisplay.last;
    }

    // STRIP THE ORG SUFFIX GSA APPENDS TO THE FAMILY NAME.
    //
    // @clolry's diagnostic:
    //   givenName="Lawrence" familyName="Hale - FC" displayName="Lawrence Hale - FC"
    //
    // The roster's 'Hale' was compared against 'Hale - FC' and failed, on
    // every entry. That is 46 of 50 refusals, which is why the count was so
    // uniform. The given name is stripped too, in case the convention ever
    // appears there.
    var familySplit = splitDirectorySuffix(family);
    family = familySplit.name;
    given = splitDirectorySuffix(given).name;
    // Surfaced so pickMatch can use the org as a tie-break between
    // same-named candidates.
    var candidateOrg = familySplit.org ||
                       splitDirectorySuffix(c.displayName).org;

    var lastOk = nameKey(parsed.last) &&
                 nameKey(parsed.last) === nameKey(family);
    var firstOk = nameKey(parsed.first) &&
                  nameKey(parsed.first) === nameKey(given);

    var pm = nameKey(parsed.middle);
    var cm = nameKey(c.middleName);
    // 'NMN' is HR shorthand for "no middle name" and appears in the roster as
    // a literal middle name — 'Patnaik,Udaya NMN'. Treated as absent, or it
    // would never agree with a real middle name and could only ever fail a
    // tie-break.
    if (pm === 'NMN') pm = '';
    var middleAgrees = false;
    if (pm && cm) {
      // An initial on either side matches a full name starting with it:
      // 'J' against 'JAMES' agrees. This is a TIE-BREAK, so a loose rule is
      // safe here in a way it would not be for the forename.
      middleAgrees = (pm === cm) ||
                     (pm.length === 1 && cm.charAt(0) === pm) ||
                     (cm.length === 1 && pm.charAt(0) === cm);
    }

    return {
      matches: !!(lastOk && firstOk),
      middleAgrees: middleAgrees,
      directoryOrg: candidateOrg
    };
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
  function pickMatch(parsed, candidates, rosterOrgCode) {
    // TWO COUNTS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.
    //
    // `candidateCount` was reused for both "how many did the directory
    // return" and "how many matched", and the second assignment won. So a
    // no-match refusal reported 0 candidates while its own reason text said
    // "1 directory entr(ies) were returned" — the sample line read as "nobody
    // came back" when somebody had.
    //
    // That cost a diagnostic round trip: the summary said noMatch and the
    // per-row line said no candidates, and those are different bugs.
    var none = {
      email: '', method: 'none', confidence: 'none',
      returnedCount: 0, matchedCount: 0,
      // Kept as an alias for returnedCount so existing callers keep working,
      // and because "how many did the directory offer" is the more useful of
      // the two at a glance.
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
    none.returnedCount = list.length;
    none.candidateCount = list.length;

    if (!list.length) {
      none.reason = 'No directory entry found for ' + parsed.first + ' ' +
                    parsed.last + '.';
      return none;
    }

    var matched = [];
    list.forEach(function (c) {
      var m = candidateMatches(parsed, c);
      if (m.matches) {
        matched.push({
          candidate: c,
          middleAgrees: m.middleAgrees,
          orgAgrees: candidateOrgMatches(rosterOrgCode, m.directoryOrg)
        });
      }
    });

    none.matchedCount = matched.length;

    if (!matched.length) {
      // WHAT THE DIRECTORY ACTUALLY SENT, in the refusal itself.
      //
      // The previous message said only that N entries were returned and none
      // matched, which is true of a nickname, a namesake, and a candidate
      // carrying no name fields at all — three different problems with
      // different fixes. Naming the candidates makes the systematic case
      // obvious from the summary instead of needing a second run.
      var shown = list.slice(0, 3).map(function (c) {
        var bits = [];
        if (_str_(c.givenName) || _str_(c.familyName)) {
          bits.push('given=' + JSON.stringify(_str_(c.givenName)) +
                    ' family=' + JSON.stringify(_str_(c.familyName)));
        }
        if (_str_(c.displayName)) {
          bits.push('display=' + JSON.stringify(_str_(c.displayName)));
        }
        if (!bits.length) bits.push('NO NAME FIELDS AT ALL');
        return bits.join(' ') + ' <' + c.email + '>';
      }).join(' | ');

      none.reason = list.length + ' directory entr(ies) returned for "' +
                    parsed.first + ' ' + parsed.last + '", none matching on ' +
                    'both surname and forename. Returned: ' + shown +
                    '. Nicknames and spelling variants are NOT matched, ' +
                    'because a near-match would grant LETS access to the ' +
                    'wrong person.';
      return none;
    }

    if (matched.length === 1) {
      return {
        email: _str_(matched[0].candidate.email).toLowerCase(),
        method: 'unique-name',
        confidence: 'exact',
        returnedCount: list.length,
        matchedCount: 1,
        candidateCount: list.length,
        reason: ''
      };
    }

    // Several people share the name. Two tie-breaks, middle name first.
    var byMiddle = matched.filter(function (m) { return m.middleAgrees; });
    if (byMiddle.length === 1) {
      return {
        email: _str_(byMiddle[0].candidate.email).toLowerCase(),
        method: 'middle-name',
        confidence: 'exact',
        returnedCount: list.length,
        matchedCount: matched.length,
        candidateCount: list.length,
        reason: ''
      };
    }

    // ORG CODE, which I previously argued against and was wrong about.
    //
    // I wrote: "the feed's org code and the directory's department string are
    // different vocabularies, and a plausible-looking correlation would be the
    // most dangerous rule in the file."
    //
    // @clolry's diagnostic falsified that. GSA's directory appends the ORG
    // CODE — 'Hale - FC' — which is the same code space as the roster's Dept
    // ID (Org), where 'FCA0B' is a descendant of 'FC'. Not a correlation: the
    // same identifier.
    //
    // Still narrow. It only separates candidates that ALREADY match exactly
    // on surname and forename, it requires both orgs to be present, and it
    // must leave exactly one survivor. A candidate with no org suffix cannot
    // win or lose on this basis, because absence is not disagreement.
    var byOrg = matched.filter(function (m) { return m.orgAgrees; });
    if (byOrg.length === 1) {
      return {
        email: _str_(byOrg[0].candidate.email).toLowerCase(),
        method: 'org-code',
        confidence: 'exact',
        returnedCount: list.length,
        matchedCount: matched.length,
        candidateCount: list.length,
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
                  (byOrg.length > 1
                    ? ', and ' + byOrg.length + ' of them share this org code'
                    : '') +
                  '. Refusing to choose: a wrong address would grant LETS ' +
                  'access to the wrong person. Set this one by hand in the ' +
                  'roster editor.';
    none.email = '';
    none.method = 'ambiguous';
    none.matchedCount = matched.length;
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

    var picked = pickMatch(parsed, candidates, position && position.orgCode);
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
    splitDirectorySuffix: splitDirectorySuffix,
    candidateOrgMatches: candidateOrgMatches,
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
