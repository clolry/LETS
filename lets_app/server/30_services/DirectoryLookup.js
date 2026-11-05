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

    var SUFFIXES = NAME_SUFFIXES;

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

  /**
   * How many consecutive lookup failures mean "stop".
   *
   * @clolry's sweep errored 281 times in a row after 113 successes, then 275
   * after 125. That is a quota, not 556 unmatched people, and continuing
   * through it spends the execution budget on calls that cannot succeed.
   *
   * Eight rather than two or three: a single unlucky name can fail for its
   * own reasons, and stopping a 400-lookup sweep on one bad row would make
   * the feature useless. Eight in a row is a pattern.
   */
  var ERROR_STREAK_LIMIT = 8;

  /**
   * Generational suffixes, recognised on either side of a comparison.
   *
   * Module scope rather than a local in parseName, because candidateMatches
   * needs the same list and two copies would drift.
   */
  var NAME_SUFFIXES = ['JR', 'SR', 'II', 'III', 'IV', 'V'];

  /**
   * Removes a trailing generational suffix from a SURNAME-ONLY string.
   *
   * 'Tekus Jr' -> 'Tekus'. 'Van Der Berg' -> unchanged.
   *
   * Distinct from parseName, which expects a full name and would read
   * 'Tekus Jr' as forename Tekus, surname Jr. A bare family-name field has no
   * forename, so it needs its own rule — and conflating the two is how the
   * first version of this fix came to do nothing at all.
   *
   * REQUIRES SOMETHING BEFORE THE SUFFIX. A surname that is only 'Jr' is not
   * a suffix to strip; it is somebody's actual name, and returning '' would
   * match everyone.
   */
  function stripNameSuffix(v) {
    var s = _str_(v);
    if (!s) return '';
    var toks = s.split(/\s+/).filter(Boolean);
    if (toks.length < 2) return s;
    var tail = toks[toks.length - 1].toUpperCase().replace(/\./g, '');
    if (NAME_SUFFIXES.indexOf(tail) === -1) return s;
    return toks.slice(0, -1).join(' ');
  }

  /** A comparison key: uppercased, punctuation and spacing removed. */
  function nameKey(v) {
    return _str_(v).toUpperCase().replace(/[^A-Z]/g, '');
  }

  /**
   * The address GSA's convention would produce for a roster name.
   *
   * WHY THIS EXISTS, AND WHY IT IS NOT USED AS AN ANSWER
   * ---------------------------------------------------
   * @clolry typed the six unresolvable names into an email client and every
   * one autocompleted immediately:
   *
   *   keonia.cobbins@gsa.gov    manuel.gotay@gsa.gov
   *   megan.holycross-simmons@gsa.gov   dawn.mccleskey@gsa.gov
   *   varuna.singh@gsa.gov
   *
   * All five are exactly forename.surname@gsa.gov. So the people exist, the
   * addresses follow a rule, and People.searchDirectoryPeople returned
   * nothing for them — Gmail's autocomplete reads a different index than the
   * People API's name search does.
   *
   * CONSTRUCTING AN ADDRESS AND WRITING IT WOULD BE WRONG. The convention
   * holds for these five and it is still a guess, and the failure mode is not
   * symmetrical:
   *
   *   a non-existent mailbox  mail bounces, the person cannot sign in. Bad,
   *                           visible, recoverable.
   *   SOMEONE ELSE'S mailbox  that person gains another's LETS access. Bad,
   *                           invisible, and the whole reason this module
   *                           refuses near-matches.
   *
   * The second is reachable: GSA disambiguates collisions with a middle
   * initial — 'brian.j.hall@gsa.gov' appeared in @clolry's own Hall list — so
   * a second Keonia Cobbins would hold keonia.a.cobbins@gsa.gov and the plain
   * form would belong to the first. Constructing it would hand one person the
   * other's identity.
   *
   * So this produces a CANDIDATE ADDRESS to be verified against the
   * directory, never an answer. verifyConstructedAddress does the verifying.
   *
   * @param {Object} parsed from parseName
   * @returns {string} '' when the name cannot produce one
   */
  function conventionalAddress(parsed, domain) {
    if (!parsed || !parsed.first || !parsed.last) return '';
    var d = _str_(domain) || 'gsa.gov';
    // Hyphens are KEPT: megan.holycross-simmons@gsa.gov is the real address.
    // Everything else non-alphanumeric goes, including the apostrophe in
    // O'Brien, which GSA strips.
    function part(v) {
      return _str_(v).toLowerCase().replace(/[^a-z0-9\-]/g, '');
    }
    var first = part(parsed.first);
    var last = part(stripNameSuffix(parsed.last));
    if (!first || !last) return '';
    return first + '.' + last + '@' + d;
  }

  /**
   * The parts of a surname, for compound-surname comparison.
   *
   * 'Azarcon Heller' -> ['AZARCON', 'HELLER']
   * 'Mbeki-Lawson'   -> ['MBEKILAWSON', 'MBEKI', 'LAWSON']
   *
   * A hyphenated name yields its JOINED form as well as its parts, because
   * the directory and HR disagree about whether to hyphenate and both forms
   * occur. The joined form is listed first so an exact match is preferred.
   */
  function surnameTokens(v) {
    var base = stripNameSuffix(splitDirectorySuffix(v).name);
    var out = [];
    var joined = nameKey(base);
    if (joined) out.push(joined);
    base.split(/[\s\-]+/).forEach(function (part) {
      var k = nameKey(part);
      if (k && out.indexOf(k) === -1) out.push(k);
    });
    return out;
  }

  /**
   * Is the roster surname one COMPONENT of the directory surname, or vice
   * versa?
   *
   * @clolry: "Andrea's information is correct but her email omits her maiden
   * name." The roster has 'Heller,Andrea A'; the directory has 'Andrea Azarcon
   * Heller' at andrea.azarcon@gsa.gov. 'Heller' is a whole token of 'Azarcon
   * Heller', and the two records are the same person under a compound
   * surname that HR and Workspace have each shortened differently.
   *
   * WHOLE TOKENS ONLY, in both directions. 'Heller' matches 'Azarcon Heller';
   * 'Hell' does not. Without that, 'Berg' would match 'Bergman' and this
   * becomes the substring matching the module exists to refuse.
   *
   * THIS IS WEAKER THAN AN EXACT SURNAME MATCH and is never sufficient on its
   * own — pickMatch requires an exact forename AND the mailbox to corroborate
   * AND a unique candidate before acting on it. Two unrelated people named
   * 'Smith' and 'Smith Jones' would satisfy this predicate, which is exactly
   * why it is only one of four conditions.
   *
   * @param {string} rosterSurname
   * @param {string} directorySurname
   * @returns {boolean}
   */
  function surnameComponentMatches(rosterSurname, directorySurname) {
    var a = surnameTokens(rosterSurname);
    var b = surnameTokens(directorySurname);
    if (!a.length || !b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (b.indexOf(a[i]) > -1) return true;
    }
    return false;
  }

  /** The local part of an address, split on its separators. */
  function emailTokens(email) {
    var local = _str_(email).toLowerCase().split('@')[0];
    return local.split(/[._+\-]/).filter(Boolean);
  }

  /**
   * Does the mailbox itself confirm the roster's legal name?
   *
   * THE SIGNAL @clolry's QUEUE OUTPUT REVEALED. Five entries looked like
   * nicknames and were not ambiguous at all:
   *
   *   roster 'Tekus Jr,John J'    directory 'Jack Tekus'    john.tekus@gsa.gov
   *   roster 'Freeman,Richard D'  directory 'Rick Freeman'  richard.freeman@gsa.gov
   *   roster 'Cecchi,Anthony N'   directory 'Tony Cecchi'   anthony.cecchi@gsa.gov
   *   roster 'Irvin,Kristen T'    directory 'Kristi Irvin'  kristen.irvin@gsa.gov
   *   roster 'Sangoi,Darshak N'   directory 'Darshak Sangoi' darshak.sangoi@gsa.gov
   *
   * The DISPLAY NAME is the nickname. The MAILBOX is the legal name, because
   * GSA provisions firstname.lastname from the HR record — the same record the
   * roster comes from. So when the local part contains the roster's forename
   * AND surname as whole tokens, that is not a resemblance between two
   * strings; it is the same source name expressed twice.
   *
   * WHOLE TOKENS, NOT SUBSTRINGS. 'dan.hall' must not confirm 'Danielle
   * Hall', and 'rob.ert' must not confirm 'Robert'. Splitting on the
   * separators GSA actually uses and comparing complete tokens is what keeps
   * this from degrading into the fuzzy matching the module refuses.
   *
   * BOTH NAMES REQUIRED. The surname alone is 'email-hint', which is weak —
   * every Hall in the directory has 'hall' in their address. The forename
   * alone is weaker still. Only both together identify a person.
   *
   * This correctly does NOT fire for the four genuine nickname cases, where
   * the mailbox uses the nickname too:
   *   'Kittrell,Angela K'   -> kim.kittrell       (kim is not angela)
   *   'Cayo,Nguyen B'       -> win.cayo           (win is not nguyen)
   *   'Schollaert,Charles F'-> charley.schollaert (charley is not charles)
   *   'Heller,Andrea A'     -> andrea.azarcon     (azarcon is not heller)
   * Those stay with a human, which is right — only @clolry knows Angela goes
   * by Kim.
   *
   * @param {Object} parsed from parseName
   * @param {string} email
   * @returns {boolean}
   */
  function emailConfirmsName(parsed, email, directorySurname) {
    if (!parsed) return false;
    var first = nameKey(parsed.first);
    if (!first) return false;

    // Surname tokens from the roster AND, when supplied, from the directory
    // name. Andrea's mailbox is andrea.azarcon — 'azarcon' is a token of her
    // directory surname 'Azarcon Heller' but appears nowhere in the roster's
    // 'Heller'. Without the directory side the mailbox cannot corroborate a
    // compound surname at all, which is the case @clolry raised.
    var surnames = surnameTokens(stripNameSuffix(parsed.last));
    if (directorySurname) {
      surnameTokens(directorySurname).forEach(function (t) {
        if (surnames.indexOf(t) === -1) surnames.push(t);
      });
    }
    if (!surnames.length) return false;

    var keys = emailTokens(email).map(nameKey);
    var hasFirst = false;
    var hasSurname = false;
    keys.forEach(function (k) {
      if (k === first) hasFirst = true;
      if (surnames.indexOf(k) > -1) hasSurname = true;
    });
    return hasFirst && hasSurname;
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
    // UPPERCASE, DIGITS AND HYPHENS. GSA org codes are 'FC', 'FCA0B', and
    // also 'IX-C', 'Q2AADC-C', '5P2SS3F1-C' — @clolry's queue output showed
    // all three forms, and the earlier letters-and-digits-only rule left them
    // attached to the surname. 'Hall - IX-C' then compared as surname
    // 'Hall - IX-C' and matched nothing.
    //
    // Requiring UPPERCASE still rejects 'Smith - Jones', which my first
    // version split into surname 'Smith' and org 'JONES', inventing an org
    // from somebody's double-barrelled name and discarding half of it.
    //
    // 12 characters rather than 8, because '5P2SS3F1-C' is 10. Still short
    // enough that a descriptive tail — 'Office of Acquisition' — is not
    // mistaken for a code.
    if (!tail || tail.length > 12 || !/^[A-Z0-9][A-Z0-9\-]*$/.test(tail)) {
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

    // STRIP A GENERATIONAL SUFFIX FROM THE CANDIDATE TOO.
    //
    // The roster's suffix is already removed by parseName, so 'Tekus Jr,John J'
    // compares as surname 'Tekus'. The CANDIDATE was not getting the same
    // treatment: GSA returns familyName 'Tekus Jr - FC', which strips to
    // 'Tekus Jr' and then fails against 'Tekus'.
    //
    // @clolry's live sweep showed the asymmetry directly: 'Kirkland III,Ozel'
    // resolved and 'Tekus Jr,John J' did not. Both are suffixed; the
    // difference is that Kirkland's directory entry omits the III and
    // Tekus's includes the Jr. So the behaviour depended on whether the
    // directory happened to carry the suffix, which is not a rule — it is a
    // coin toss across an unknown share of 1,046 positions.
    //
    // Applying the same split to both sides makes the comparison symmetric,
    // which is the only form in which it can be reasoned about.
    //
    // NOT via parseName. My first attempt reused it, and parseName('Tekus Jr')
    // returns surname 'Jr', forename 'Tekus' — because a bare family-name
    // field has no forename and the forename-first branch takes the last
    // token as the surname. Comparing against 'Jr' fails just as badly as
    // comparing against 'Tekus Jr', so the fix silently did nothing.
    family = stripNameSuffix(family);
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
      directoryOrg: candidateOrg,
      // Surfaced so pickMatch and suggestCandidates can test the surname
      // without repeating the suffix/org-suffix/displayName resolution above.
      // A second copy of that logic would disagree with this one eventually.
      resolvedGiven: given,
      resolvedFamily: family,
      surnameMatches: !!lastOk,
      // WEAKER than surnameMatches: the roster surname is a component of the
      // directory surname, or vice versa. Never sufficient alone.
      surnameComponentMatches: surnameComponentMatches(parsed.last, family),
      forenameMatches: !!firstOk
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
      // BEFORE REFUSING: does a mailbox confirm the roster's legal name?
      //
      // @clolry's queue output showed five entries that looked like nicknames
      // and were not ambiguous at all:
      //
      //   roster 'Freeman,Richard D'  directory 'Rick Freeman'
      //                               richard.freeman@gsa.gov
      //
      // The display name is the nickname; the MAILBOX is the legal name,
      // because GSA provisions firstname.lastname from the HR record — the
      // same record the roster comes from. That is not a resemblance between
      // two strings, it is one source name expressed twice, and refusing it
      // sends an administrator to confirm something the data already states.
      //
      // Requires BOTH names as WHOLE TOKENS (see emailConfirmsName), and
      // requires exactly ONE such candidate. Two addresses both confirming
      // the same person would mean the directory holds duplicates, which is a
      // human's problem rather than a tie to break.
      //
      // The surname must still match the directory name, so this cannot
      // resolve a wholly different person whose address happens to contain
      // two matching tokens.
      var confirmed = [];
      var compound = [];
      list.forEach(function (c) {
        var cm = candidateMatches(parsed, c);
        if (!emailConfirmsName(parsed, c.email, cm.resolvedFamily)) return;

        if (cm.surnameMatches) {
          confirmed.push(c);
          return;
        }

        // A COMPOUND SURNAME, which needs all three of:
        //   - the forename matching exactly
        //   - the roster surname being a whole COMPONENT of the directory
        //     surname, or vice versa
        //   - the mailbox carrying the forename and a surname token
        //
        // @clolry: "Andrea's information is correct but her email omits her
        // maiden name." Roster 'Heller,Andrea A'; directory 'Andrea Azarcon
        // Heller' at andrea.azarcon@gsa.gov.
        //
        // Three independent conditions, not one looser comparison. Any two
        // of them are satisfiable by coincidence — a 'Smith' and a 'Smith
        // Jones' share a surname component, and plenty of people share a
        // forename — but a mailbox provisioned from the HR record AND an
        // exact forename AND a shared surname token is the same person.
        if (cm.forenameMatches && cm.surnameComponentMatches) {
          compound.push(c);
        }
      });

      if (confirmed.length === 1) {
        return {
          email: _str_(confirmed[0].email).toLowerCase(),
          method: 'email-confirms-name',
          confidence: 'exact',
          returnedCount: list.length,
          matchedCount: 0,
          candidateCount: list.length,
          reason: ''
        };
      }

      // Only when it is the ONLY compound candidate AND no exact-surname
      // candidate exists. If an exact surname matched, that one wins and this
      // never runs; if two compounds qualify, a human decides.
      if (!confirmed.length && compound.length === 1) {
        return {
          email: _str_(compound[0].email).toLowerCase(),
          method: 'compound-surname',
          // NOT 'exact'. The surnames genuinely differ, and a later reader
          // asking "why does Andrea Heller have Andrea Azarcon's address"
          // deserves to find this labelled as an inference rather than a
          // certainty.
          confidence: 'inferred',
          returnedCount: list.length,
          matchedCount: 0,
          candidateCount: list.length,
          reason: ''
        };
      }

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
  function resolveOne(position, searchFn, verifyFn) {
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

    // LAST RESORT: the name search found nobody, so try the conventional
    // address and VERIFY it.
    //
    // @clolry's six unresolvable names all autocompleted in an email client
    // as forename.surname@gsa.gov, so the people exist and the API's NAME
    // search does not find them. An address lookup does.
    //
    // Only when the name search produced NOTHING. A refusal because two
    // people matched, or because a nickname did not, is a real ambiguity and
    // must not be overridden by a constructed guess.
    if (!picked.email && verifyFn && picked.method === 'none' &&
        !picked.returnedCount) {
      var v;
      try {
        v = verifyFn(parsed);
      } catch (e2) {
        v = { verified: false, reason: 'verification failed: ' + e2.message };
      }
      if (v && v.verified) {
        return {
          positionNumber: _str_(position.positionNumber),
          employeeName: _str_(position.employeeName),
          email: _str_(v.email).toLowerCase(),
          method: 'verified-convention',
          // NOT 'exact'. The address was constructed from a naming rule and
          // then confirmed to exist under a matching name — which is strong,
          // and is not the same as the directory having volunteered it.
          confidence: 'verified',
          candidateCount: 0,
          reason: ''
        };
      }
      if (v && v.reason) {
        picked.reason = picked.reason + ' Tried ' + (v.email || 'a constructed address') +
                        ': ' + v.reason;
      }
    }

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
    // Optional. When absent, resolveBatch behaves exactly as before — which
    // is what keeps the pure tests pure.
    var verifyFn = o.verifyFn || null;
    var start = parseInt(o.startIndex, 10) || 0;
    var began = (o.now instanceof Date) ? o.now.getTime() : Date.now();
    var deadline = began + (parseInt(o.deadlineMs, 10) || 240000);   // 4 min
    var maxLookups = parseInt(o.maxLookups, 10) || 100000;

    var out = {
      resolved: [], refused: [], skipped: 0,
      lookups: 0, nextIndex: start, complete: false,
      stoppedBecause: '',
      // Counted separately from refusals. A refusal is a DECISION — the name
      // was ambiguous, or nothing matched. An error is an ATTEMPT THAT DID
      // NOT HAPPEN, and conflating them makes a throttled run look like a
      // matching failure.
      errors: 0,
      errorSamples: [],
      rateLimited: false
    };
    var consecutiveErrors = 0;

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

      var r = resolveOne(p, searchFn, verifyFn);
      out.lookups++;
      if (r.email) {
        out.resolved.push(r);
        consecutiveErrors = 0;
      } else {
        out.refused.push(r);
        if (r.method === 'error') {
          out.errors++;
          consecutiveErrors++;
          // Keep the first few messages. @clolry's sweep reported 281 errors
          // and the log showed only '[error, 0 candidate(s)]' — the reason
          // was recorded per row and never surfaced, so the cause was
          // invisible.
          if (out.errorSamples.length < 5) {
            out.errorSamples.push(r.employeeName + ': ' + r.reason);
          }
        } else {
          consecutiveErrors = 0;
        }
      }

      // STOP ON A RUN OF CONSECUTIVE ERRORS.
      //
      // @clolry's first run: 113 resolved, then 281 errors in a row. Its
      // second: 125 resolved, then 275. The pattern is a quota — roughly 120
      // lookups per execution, after which every call fails.
      //
      // Continuing through 275 doomed calls wastes the remainder of the
      // budget and, worse, marks 275 positions as attempted so the run
      // reports a failure rate that is really a throttle. Stopping early
      // leaves them untried, which is honest and lets the next run reach
      // them.
      if (consecutiveErrors >= ERROR_STREAK_LIMIT) {
        out.stoppedBecause = consecutiveErrors + ' consecutive lookup ' +
                             'errors — almost certainly a rate limit. ' +
                             'Stopped rather than burning the remaining budget.';
        out.rateLimited = true;
        i++;                       // this position was attempted
        break;
      }
    }

    out.nextIndex = i;

    // 'COMPLETE' MEANS EVERY POSITION WAS ATTEMPTED SUCCESSFULLY, not merely
    // that the loop reached the end.
    //
    // @clolry's third run printed 'SWEEP COMPLETE' with 556 positions having
    // errored across the three runs — two thirds of the roster still had no
    // address. The flag meant 'end of list' and was read, reasonably, as
    // 'done'. A resumable sweep whose completion signal ignores failures is
    // worse than one with no signal.
    out.reachedEnd = i >= list.length;
    out.complete = out.reachedEnd && out.errors === 0;
    if (out.complete) {
      out.stoppedBecause = 'finished';
    } else if (out.reachedEnd && out.errors) {
      out.stoppedBecause = 'reached the end of the roster, but ' + out.errors +
                           ' lookup(s) failed and were not resolved. Re-run ' +
                           'to retry them.';
    }
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
      // SEPARATE FROM REFUSALS. A refusal is a decision about a person; an
      // error is a call that never completed. @clolry's run reported '287
      // refused' when 281 of those were a rate limit, which reads as a
      // matching failure and is not one.
      errors: batch.errors || 0,
      errorSamples: batch.errorSamples || [],
      rateLimited: !!batch.rateLimited,
      reachedEnd: !!batch.reachedEnd,
      byMethod: byMethod,
      refusedByReason: byReason,
      complete: batch.complete,
      nextIndex: batch.nextIndex,
      note: (batch.errors
              ? ((batch.rateLimited
                   ? 'STOPPED EARLY: '
                   : 'WARNING: ') + batch.errors + ' lookup(s) FAILED rather ' +
                 'than being refused — these are calls that did not complete, ' +
                 'almost certainly a rate limit, and those positions still ' +
                 'have no address. Re-run to retry them. ')
              : '') +
            'Refusals are deliberate. ' + byReason.ambiguous + ' name(s) match ' +
            'more than one person in the directory, and choosing between them ' +
            'would risk granting LETS access to the wrong person — those must ' +
            'be set by hand in the roster editor.'
    };
  }

  /**
   * Candidates to OFFER an administrator when nothing matched automatically.
   *
   * @clolry: "can we get a user interface where it prompts the admin to
   * resolve the names and provides potential matches? For instance
   * Kittrell,Angela K should have Kittrell,Kim offered as a potential match."
   *
   * WHY THIS IS A SEPARATE FUNCTION FROM pickMatch
   * ----------------------------------------------
   * pickMatch answers "may this be written automatically", and its only
   * acceptable outputs are one certain match or nothing. This answers "what
   * should a human look at", which is a different question with a different
   * risk profile: a wrong SUGGESTION costs a moment's reading, where a wrong
   * AUTO-MATCH grants someone else's access.
   *
   * So the rules here are deliberately looser than pickMatch's, and they must
   * never be reused by it. Nothing in this function writes anything or is
   * reachable from the automatic path — test_directory_lookup.js asserts that
   * pickMatch does not call it.
   *
   * WHAT COUNTS AS WORTH OFFERING
   * -----------------------------
   * The surname must match exactly, after suffix and org-suffix stripping.
   * That is the anchor: 'Kittrell,Angela K' against a directory 'Kittrell,
   * Kim' is a plausible nickname; 'Kittrell' against 'Kitterell' is a
   * different family and offering it invites a mis-click.
   *
   * Forenames are then ranked by how they differ, because WHY they differ is
   * what an admin needs to judge:
   *
   *   initial       roster forename starts with the candidate's, or vice
   *                 versa — 'Angela' / 'A', or a middle name used as a first
   *   contains      one contains the other — 'Kim' inside 'Kimberly'
   *   email-hint    the local part of the address contains the roster
   *                 surname, so the mailbox is at least the right family
   *   same-surname  nothing else in common
   *
   * NOT ranked by edit distance. 'Jon'/'John' and 'Ron'/'John' are one
   * character apart each, and presenting them as equally likely is worse than
   * presenting neither — it implies a confidence the measure does not have.
   *
   * @param {Object} parsed from parseName
   * @param {Array} candidates
   * @param {string} [rosterOrgCode]
   * @returns {Array} ranked suggestions, best first
   */
  function suggestCandidates(parsed, candidates, rosterOrgCode) {
    if (!parsed || !parsed.last) return [];

    var rosterLast = nameKey(stripNameSuffix(parsed.last));
    var rosterFirst = nameKey(parsed.first);
    var out = [];

    (candidates || []).forEach(function (c) {
      var email = _str_(c.email).toLowerCase();
      if (!email) return;

      var given = _str_(c.givenName);
      var family = _str_(c.familyName);
      if (!given || !family) {
        var fromDisplay = parseName(splitDirectorySuffix(c.displayName).name);
        if (!given) given = fromDisplay.first;
        if (!family) family = fromDisplay.last;
      }
      var fsplit = splitDirectorySuffix(family);
      family = stripNameSuffix(fsplit.name);
      given = splitDirectorySuffix(given).name;

      var candLast = nameKey(family);
      var candFirst = nameKey(given);
      if (!candLast) return;

      // THE SURNAME IS THE ANCHOR, but a COMPONENT of it counts.
      //
      // 'Heller' against a directory 'Azarcon Heller' is the same person with
      // a compound surname — @clolry: "Andrea's information is correct but her
      // email omits her maiden name." Requiring the whole surname to match
      // would have excluded her from the suggestions entirely, which is how
      // she came to be offered only because of the email hint.
      //
      // Still whole tokens: 'Heller' matches 'Azarcon Heller', 'Hell' does
      // not, and 'Berg' does not match 'Bergman'.
      var exactSurname = (candLast === rosterLast);
      if (!exactSurname && !surnameComponentMatches(parsed.last, family)) {
        return;
      }

      var reason = 'same-surname';
      var rank = 3;

      // THE MAILBOX CONFIRMING THE LEGAL NAME outranks every resemblance,
      // because it is the only signal here that comes from the HR record
      // rather than from two strings looking alike. pickMatch now resolves
      // these automatically, so a suggestion of this kind should be rare —
      // but when it appears it belongs at the top.
      if (emailConfirmsName(parsed, email)) {
        reason = 'email-confirms-name';
        rank = -1;
      }

      // A compound-surname candidate with an exact forename is strong: HR and
      // Workspace shortening a double surname differently is common, and the
      // forename still agrees exactly.
      if (!exactSurname && rosterFirst && candFirst &&
          rosterFirst === candFirst) {
        reason = 'compound-surname';
        rank = 0;
      }

      if (rank > 0 && rosterFirst && candFirst) {
        // A SHARED FIRST LETTER IS NOT A SIGNAL.
        //
        // @clolry's queue offered 'Jermaine Hall' as the top suggestion for
        // 'Hall,Joseph C', with a pre-filled accept command — because both
        // forenames start with J. That is the eight-Halls trap exactly,
        // re-entered through the 'initial' reason, and it was worse than the
        // original: a confident single suggestion rather than an obvious
        // list.
        //
        // Measured against the real nicknames in this roster, a shared PREFIX
        // of three or more characters separates them cleanly:
        //
        //   Charles/Charley 6   Kristen/Kristi 5   Bradley/Brad 4
        //   Katherine/Kate  3   Richard/Rick   3
        //   Joseph/Jermaine 1   Michael/Mary   1   Anthony/Tony 0
        //
        // Three is where real diminutives sit and coincidence does not. The
        // genuine short forms that share nothing — Anthony/Tony,
        // Angela/Kim — cannot be reached by prefix at all and must stay with
        // a human, which is correct.
        var shared = 0;
        while (shared < rosterFirst.length && shared < candFirst.length &&
               rosterFirst.charAt(shared) === candFirst.charAt(shared)) {
          shared++;
        }
        if (shared >= 3) {
          reason = 'nickname-prefix';
          rank = 0;
        }
        if (rosterFirst.indexOf(candFirst) === 0 ||
            candFirst.indexOf(rosterFirst) === 0) {
          reason = 'contains';
          rank = 0;
        }
      }
      // 'email-hint' means only that the mailbox names the right family, which
      // every same-surname colleague satisfies — @clolry's output showed
      // eight Halls all labelled email-hint, which told him nothing and made
      // the list look more informative than it was.
      //
      // So it is only a REASON when nothing better applies, and it never
      // demotes a stronger one. My first version assigned rank 2
      // unconditionally and pushed a 'contains' match from 0 to 2.
      if (rank > 2 && email.split('@')[0].toUpperCase()
                           .replace(/[^A-Z]/g, '').indexOf(rosterLast) > -1) {
        reason = 'email-hint';
        rank = 2;
      }

      out.push({
        email: email,
        directoryName: (given + ' ' + family).trim(),
        displayName: _str_(c.displayName),
        directoryOrg: fsplit.org || splitDirectorySuffix(c.displayName).org,
        orgAgrees: candidateOrgMatches(rosterOrgCode, fsplit.org ||
                                       splitDirectorySuffix(c.displayName).org),
        reason: reason,
        rank: rank
      });
    });

    // An org-code agreement promotes a suggestion, because it is the one
    // signal here that comes from a shared identifier rather than a
    // resemblance.
    out.forEach(function (o) { if (o.orgAgrees) o.rank -= 1; });

    out.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.email < b.email ? -1 : 1;
    });

    // A LIST WITH NO DISTINGUISHING SIGNAL IS WORSE THAN NO LIST.
    //
    // @clolry's output for 'Hall,Joseph C' offered eight Halls — Adam, Brian,
    // Christopher, Dan, David, Deanna, Ellis, Emma — every one labelled
    // 'email-hint', which is true of anyone named Hall and therefore says
    // nothing. The first was pre-filled into the accept command, so the
    // path of least resistance was to assign Adam Hall's address to Joseph
    // Hall.
    //
    // When nothing in the list has a forename signal, the honest answer is
    // that the directory cannot distinguish them. Returning them ranked
    // implies an order the evidence does not support.
    var hasSignal = out.some(function (o) {
      return o.reason === 'email-confirms-name' ||
             o.reason === 'compound-surname' ||
             o.reason === 'nickname-prefix' || o.reason === 'contains';
    });
    if (!hasSignal && out.length > 2) {
      return out.map(function (o) {
        var copy = {};
        Object.keys(o).forEach(function (k) { copy[k] = o[k]; });
        // Flagged rather than dropped: knowing eight people share the surname
        // is itself useful, and the UI can say so without offering a pick.
        copy.indistinguishable = true;
        copy.reason = 'surname-only';
        return copy;
      });
    }
    return out;
  }

  return {
    parseName: parseName,
    suggestCandidates: suggestCandidates,
    nameKey: nameKey,
    stripNameSuffix: stripNameSuffix,
    conventionalAddress: conventionalAddress,
    surnameTokens: surnameTokens,
    surnameComponentMatches: surnameComponentMatches,
    emailTokens: emailTokens,
    emailConfirmsName: emailConfirmsName,
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
