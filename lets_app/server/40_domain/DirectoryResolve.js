/**
 * DirectoryResolve.js
 * The network side of the directory email lookup, and the roster write.
 *
 * Split from 30_services/DirectoryLookup.js so that every matching decision —
 * which is where a wrong answer grants someone else's access — is pure and
 * testable without the People API. This file only fetches and writes.
 *
 * WHY THE PEOPLE API AND NOT THE ADMIN SDK
 * ----------------------------------------
 * AdminDirectory.Users.list is the obvious choice and is wrong here. It needs
 * admin.directory.user.readonly, which only a Workspace SUPER ADMIN can
 * authorise. This web app runs as USER_ACCESSING (appsscript.json), so the
 * scope would be requested from whichever ordinary user happened to trigger
 * it, and the call would fail for everyone who is not an admin.
 *
 * People.People.searchDirectoryPeople reads the same domain directory under
 * directory.readonly, which any domain user can grant. That is also what
 * @clolry described — "Google Contacts Directory lookup" — since the domain
 * directory is what Contacts surfaces.
 *
 * REQUIRES A MANUAL SETUP STEP. The People advanced service must be enabled in
 * the Apps Script project, and appsscript.json carries the dependency. If it
 * is missing, `People` is undefined — so every entry point here checks and
 * returns an actionable message rather than a ReferenceError.
 *
 * THE QUOTA AND TIME SHAPE
 * ------------------------
 * Roughly 900 positions, one network round trip each, against a six-minute
 * execution limit. A naive loop is killed partway through, and a run that
 * writes some addresses and loses its place is worse than one that does
 * nothing: the next attempt starts over and spends the quota twice.
 *
 * So resolution is time-boxed and resumable. The resume index lives in a
 * Script Property, and the trigger-driven entry point picks up where the last
 * run stopped.
 */

/** Script Property holding the resume index for the directory sweep. */
var DIRECTORY_RESUME_KEY = 'DIRECTORY_LOOKUP_RESUME_INDEX';

function _str2_(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Searches the domain directory for one parsed name.
 *
 * Queries on 'Forename Surname' because searchDirectoryPeople takes a free
 * text query, not structured fields. The query is deliberately BROAD and the
 * filtering is strict and local — DirectoryLookup.pickMatch decides, not the
 * search ranking. Trusting the API's relevance order would mean the top hit
 * for 'Michael Smith' silently becomes the answer, which is exactly the guess
 * this feature must not make.
 *
 * @param {Object} parsed from DirectoryLookup.parseName
 * @returns {Array} candidates [{ givenName, familyName, middleName, email }]
 */
function _directorySearch_(parsed) {
  if (typeof People === 'undefined' || !People || !People.People) {
    throw new Error(
      'The People advanced service is not enabled in this Apps Script ' +
      'project. Enable it under Services (identifier "People", v1) — ' +
      'appsscript.json already declares the dependency.');
  }

  var query = _str2_(parsed.query) || (parsed.first + ' ' + parsed.last);
  var res;
  try {
    res = People.People.searchDirectoryPeople({
      query: query,
      readMask: 'names,emailAddresses,organizations',
      // Both sources: DOMAIN_PROFILE covers Workspace accounts,
      // DOMAIN_CONTACT covers shared external contacts an admin has added.
      // A person present only as a domain contact still has a real address.
      sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE',
                'DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT'],
      // Enough to see that a name is ambiguous. A cap of 1 would hide the
      // ambiguity and make every lookup look certain, which is the failure
      // mode this whole module is shaped against.
      pageSize: 30
    });
  } catch (e) {
    // A 429 is expected under a long sweep. Surfaced rather than swallowed, so
    // resolveBatch records it as an error for that position and the sweep can
    // be re-run for the refusals only.
    throw new Error('People.searchDirectoryPeople failed for "' + query +
                    '": ' + e.message);
  }

  var people = (res && res.people) || [];
  var out = [];
  people.forEach(function (p) {
    var names = (p.names || [])[0] || {};
    var emails = p.emailAddresses || [];
    if (!emails.length) return;
    // The PRIMARY address, or the first. An alias would still identify the
    // right person, but Access.js compares the signed-in user's email
    // exactly, and the signed-in identity is the primary.
    var primary = null;
    for (var i = 0; i < emails.length; i++) {
      if (emails[i].metadata && emails[i].metadata.primary) { primary = emails[i]; break; }
    }
    var chosen = primary || emails[0];
    out.push({
      givenName: names.givenName || '',
      familyName: names.familyName || '',
      middleName: names.middleName || '',
      // ALWAYS POPULATED BY THE API, unlike givenName/familyName —
      // particularly for DOMAIN_CONTACT entries. candidateMatches parses this
      // when the structured fields are missing, which is what fixed 46 of
      // @clolry's 50 refusals.
      displayName: names.displayName || '',
      email: String(chosen.value || '').toLowerCase()
    });
  });
  return out;
}

/**
 * Dry run: what the directory would resolve, without writing anything.
 *
 * Run this first. It reports the resolved addresses, the refusals and why each
 * was refused — the refusals are the interesting part, because those positions
 * still cannot sign in.
 *
 * @param {Object} [opts] { startIndex, maxLookups, includeExisting }
 * @returns {Object} successResponse | errorResponse
 * @client
 * @editor  Takes no required arguments; safe to Run directly.
 */
function previewDirectoryEmails(opts) {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  try {
    if (typeof People === 'undefined' || !People || !People.People) {
      return errorResponse(
        'The People advanced service is not enabled. In the Apps Script ' +
        'editor: Services -> Add a service -> People API (v1). The project ' +
        'manifest already declares it, so this only needs doing once per ' +
        'project.');
    }

    var bundle = HC.hcGetBundle();
    if (!bundle.success) {
      return errorResponse('Could not read the roster: ' + bundle.error);
    }

    var o = opts || {};
    var batch = DirectoryLookup.resolveBatch(bundle.data, _directorySearch_, {
      startIndex: parseInt(o.startIndex, 10) || 0,
      // Lower than the live sweep's budget: a preview should return promptly
      // and 50 lookups is enough to see the shape of the refusals.
      maxLookups: parseInt(o.maxLookups, 10) || 50,
      deadlineMs: 120000,
      includeExisting: !!o.includeExisting
    });

    var summary = DirectoryLookup.summarise(batch);
    return successResponse({
      summary: summary,
      resolved: batch.resolved.slice(0, 100),
      refused: batch.refused.slice(0, 100),
      nextIndex: batch.nextIndex,
      complete: batch.complete,
      note: 'Nothing was written. ' + summary.note
    });
  } catch (e) {
    console.error('previewDirectoryEmails failed: ' + e.message);
    return errorResponse('Directory preview failed: ' + e.message);
  }
}

/**
 * Reports which build of the directory matcher is deployed.
 *
 * WHY THIS EXISTS
 * ---------------
 * @clolry has now run previewDirectoryEmails three times and received
 * byte-identical output — 50 lookups, 0 resolved, 46 noMatch, the same ten
 * names — across two commits that each changed the matching logic. Identical
 * output after a behavioural change means the code under test did not change,
 * and nothing in the result distinguishes "the fix did not work" from "the fix
 * is not running".
 *
 * That ambiguity has now cost three round trips on this feature alone, and it
 * cost two earlier on the HR feed tab name before diagnoseHrFeedSource was
 * added for exactly the same reason. The lesson generalises: anything whose
 * only observable is a count needs a version marker.
 *
 * The markers below are ASSERTIONS ABOUT BEHAVIOUR, not a version string.
 * A string can be bumped without the behaviour shipping; these run the real
 * matcher against the real candidate shape from @clolry's diagnostic, so a
 * PASS means that specific defect is genuinely fixed in the running build.
 *
 * Reads nothing, writes nothing, makes no network call. Safe at any time.
 *
 * @returns {Object}
 * @editor
 */
function diagnoseDirectoryBuild() {
  var checks = [];

  function check(name, actual, expected, why) {
    var pass = String(actual) === String(expected);
    checks.push({ check: name, pass: pass, got: actual, want: expected, why: why });
  }

  // 1. The GSA org suffix on a family name. This is the defect that caused 46
  //    of 50 refusals.
  try {
    var split = DirectoryLookup.splitDirectorySuffix('Hale - FC');
    check('org suffix stripped from surname', split.name, 'Hale',
          'GSA appends " - FC" to familyName; without stripping it, EVERY ' +
          'candidate fails the surname comparison');
    check('org token extracted', split.org, 'FC',
          'used as a tie-break between namesakes in different portfolios');
  } catch (e) {
    checks.push({ check: 'splitDirectorySuffix exists', pass: false,
                  got: e.message, want: 'a function',
                  why: 'THIS BUILD PREDATES THE FIX — the function is absent' });
  }

  // 2. End to end against the exact candidate from the live diagnostic.
  try {
    var parsed = DirectoryLookup.parseName('Hale,Lawrence C');
    var live = {
      givenName: 'Lawrence', familyName: 'Hale - FC', middleName: '',
      displayName: 'Lawrence Hale - FC', email: 'lawrence.hale@gsa.gov'
    };
    var m = DirectoryLookup.candidateMatches(parsed, live);
    check('live candidate matches', m.matches, 'true',
          'this is the literal candidate the directory returned for ' +
          'Lawrence Hale');

    var picked = DirectoryLookup.pickMatch(parsed, [live]);
    check('live candidate resolves', picked.email, 'lawrence.hale@gsa.gov',
          'if this fails, the sweep will still refuse every GSA entry');
  } catch (e) {
    checks.push({ check: 'end-to-end match', pass: false, got: e.message,
                  want: 'resolved', why: 'unexpected error' });
  }

  // 3. The displayName fallback, from the commit before.
  try {
    var dn = DirectoryLookup.pickMatch(
      DirectoryLookup.parseName('Hale,Lawrence C'),
      [{ givenName: '', familyName: '', displayName: 'Lawrence Hale',
         email: 'l@gsa.gov' }]);
    check('displayName fallback works', dn.email, 'l@gsa.gov',
          'the People API leaves givenName/familyName empty on many entries');
  } catch (e) {
    checks.push({ check: 'displayName fallback', pass: false, got: e.message,
                  want: 'l@gsa.gov', why: 'unexpected error' });
  }

  // 4. Separate returned/matched counts — the field that contradicted itself
  //    in the live log.
  try {
    var nm = DirectoryLookup.pickMatch(
      DirectoryLookup.parseName('Smith,Michael'),
      [{ givenName: 'Mike', familyName: 'Smith', email: 'm@gsa.gov' }]);
    check('returned count is reported', nm.returnedCount, '1',
          'the log read "0 candidate(s)" while the reason said 1 was ' +
          'returned; those are different bugs');
  } catch (e) {
    checks.push({ check: 'returnedCount', pass: false, got: e.message,
                  want: '1', why: 'unexpected error' });
  }

  // 5. Strictness must be intact. A build that resolved everything by
  //    loosening the comparison would pass 1-4 and be far worse than one that
  //    resolves nothing.
  try {
    var nick = DirectoryLookup.pickMatch(
      DirectoryLookup.parseName('Smith,Michael'),
      [{ givenName: 'Mike', familyName: 'Smith - FC', email: 'm@gsa.gov' }]);
    check('a nickname is still REFUSED', nick.email, '',
          'resolving this would grant LETS access to the wrong person');

    var amb = DirectoryLookup.pickMatch(
      DirectoryLookup.parseName('Smith,Michael'),
      [{ givenName: 'Michael', familyName: 'Smith - FC', email: 'a@gsa.gov' },
       { givenName: 'Michael', familyName: 'Smith - FC', email: 'b@gsa.gov' }],
      'FCA0B');
    check('two namesakes in one org still REFUSED', amb.method, 'ambiguous',
          'the org tie-break must leave exactly one survivor, not pick the ' +
          'first');
  } catch (e) {
    checks.push({ check: 'strictness', pass: false, got: e.message,
                  want: 'refused', why: 'unexpected error' });
  }

  var failed = checks.filter(function (c) { return !c.pass; });

  console.log('=== diagnoseDirectoryBuild ===');
  checks.forEach(function (c) {
    console.log((c.pass ? '  PASS  ' : '  FAIL  ') + c.check);
    if (!c.pass) {
      console.log('          got ' + JSON.stringify(c.got) +
                  ', want ' + JSON.stringify(c.want));
      console.log('          ' + c.why);
    }
  });
  console.log('');

  if (failed.length) {
    console.log(failed.length + ' of ' + checks.length + ' checks FAILED.');
    console.log('');
    console.log('THIS DEPLOYMENT IS RUNNING AN OLDER BUILD of ' +
                'DirectoryLookup.js. The matching fixes are not present, so ' +
                'previewDirectoryEmails will keep returning the same ' +
                'refusals no matter how many times it is run.');
    console.log('Deploy the current sandbox branch, then re-run this.');
  } else {
    console.log('All ' + checks.length + ' checks passed — the current ' +
                'matcher IS deployed. If previewDirectoryEmails still ' +
                'refuses everything, the cause is in the data rather than ' +
                'the code: run diagnoseDirectoryMatch() to see what the ' +
                'directory returned.');
  }

  return { ok: failed.length === 0, checks: checks };
}

/**
 * Prints the RAW directory response for one name.
 *
 * WHY THIS EXISTS
 * ---------------
 * @clolry's first sweep refused 46 of 50 lookups with "1 directory entr(ies)
 * were returned ... but none matched exactly on both surname and forename".
 * One candidate returned and rejected, 46 times, is not 46 wrong people — it
 * is one systematic mismatch, and the refusal message could not say which
 * because it never showed what the directory actually returned.
 *
 * The cause was that the People API leaves givenName and familyName empty on
 * many entries while always populating displayName. Diagnosing that took a
 * guess; this makes it a lookup.
 *
 * Reads nothing from LETS and writes nothing. Safe at any time.
 *
 * @param {string} [name] roster-style 'Surname,Forename M'. Defaults to a
 *        name from the current roster so it can be run from the Run button.
 * @returns {Object}
 * @editor
 */
function diagnoseDirectoryMatch(name) {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  if (typeof People === 'undefined' || !People || !People.People) {
    console.log('The People advanced service is not enabled. ' +
                'Services -> Add a service -> People API (v1).');
    return { success: false };
  }

  var who = String(name || '').trim();
  if (!who) {
    // The Run button passes no arguments, so pick the first staffed position
    // that still has no email — the population this is meant to diagnose.
    var bundle = HC.hcGetBundle();
    var list = (bundle.success ? bundle.data : []) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].occupancyStatus !== 'VACANT' && list[i].employeeName &&
          !list[i].emailAddress) {
        who = list[i].employeeName;
        break;
      }
    }
  }
  if (!who) {
    console.log('No name supplied and no staffed position without an email.');
    return { success: false };
  }

  var parsed = DirectoryLookup.parseName(who);
  console.log('=== diagnoseDirectoryMatch ===');
  console.log('roster name : ' + JSON.stringify(who));
  console.log('parsed      : ' + JSON.stringify(parsed));
  console.log('query       : "' + parsed.first + ' ' + parsed.last + '"');
  console.log('');

  var candidates;
  try {
    candidates = _directorySearch_(parsed);
  } catch (e) {
    console.log('SEARCH FAILED: ' + e.message);
    return { success: false, error: e.message };
  }

  console.log(candidates.length + ' candidate(s) returned:');
  candidates.forEach(function (c, idx) {
    // EVERY FIELD, quoted. An empty givenName is invisible unquoted, and that
    // emptiness was the entire bug.
    console.log('  [' + idx + '] givenName=' + JSON.stringify(c.givenName) +
                ' familyName=' + JSON.stringify(c.familyName) +
                ' middleName=' + JSON.stringify(c.middleName) +
                ' displayName=' + JSON.stringify(c.displayName) +
                ' email=' + JSON.stringify(c.email));
    var m = DirectoryLookup.candidateMatches(parsed, c);
    console.log('        matches=' + m.matches +
                ' middleAgrees=' + m.middleAgrees);
  });
  console.log('');

  var picked = DirectoryLookup.pickMatch(parsed, candidates);
  console.log('decision: ' + JSON.stringify(picked, null, 2));
  return picked;
}

/**
 * Resolves and WRITES email addresses onto HC_Positions.
 *
 * Writes only the Email_Address cell of positions it resolved with certainty.
 * Never clears an existing address, and never writes a guess — see
 * DirectoryLookup.pickMatch, which refuses an ambiguous name rather than
 * choosing.
 *
 * ONE RANGE WRITE PER POSITION, not a full-sheet rewrite. The roster is the
 * authority on everything else in the row, and a rewrite here would race the
 * HR import — two writers rebuilding the same 900 rows from different sources.
 *
 * @param {Object} [opts] { startIndex, maxLookups, includeExisting }
 * @returns {Object} successResponse | errorResponse
 * @client
 * @editor  Resumes from the saved index when run with no arguments.
 */
function resolveDirectoryEmails(opts) {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  if (typeof People === 'undefined' || !People || !People.People) {
    return errorResponse('The People advanced service is not enabled. ' +
                         'Services -> Add a service -> People API (v1).');
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
  } catch (e) {
    return errorResponse('Another HR edit is in progress. Try again in a moment.');
  }

  try {
    var bundle = HC.hcGetBundle();
    if (!bundle.success) {
      return errorResponse('Could not read the roster: ' + bundle.error);
    }

    var o = opts || {};
    var start = parseInt(o.startIndex, 10);
    if (isNaN(start)) start = _directoryResumeIndex_();

    var batch = DirectoryLookup.resolveBatch(bundle.data, _directorySearch_, {
      startIndex: start,
      maxLookups: parseInt(o.maxLookups, 10) || 400,
      // Four minutes of a six-minute limit. The remainder is the write, the
      // cache invalidation and the resume-index save, which must not be the
      // things that get cut off.
      deadlineMs: 240000,
      includeExisting: !!o.includeExisting
    });

    var written = 0;
    if (batch.resolved.length) {
      var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
      var sheet = ss.getSheetByName(SHEET_NAMES.HC_POSITIONS);
      if (!sheet) {
        return errorResponse(SHEET_NAMES.HC_POSITIONS + ' tab not found.');
      }

      var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_POSITIONS];
      var pnCol = headers.indexOf('Position_Number') + 1;
      var emailCol = headers.indexOf('Email_Address') + 1;
      var updatedByCol = headers.indexOf('Updated_By') + 1;
      var updatedAtCol = headers.indexOf('Updated_At') + 1;
      if (pnCol < 1 || emailCol < 1) {
        return errorResponse('HC_Positions is missing Position_Number or ' +
                             'Email_Address.');
      }

      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return errorResponse('HC_Positions has no rows.');

      // Row index built ONCE. A getRange per position inside the loop would
      // be ~900 reads and would itself exhaust the execution budget.
      var keys = sheet.getRange(2, pnCol, lastRow - 1, 1).getValues();
      var rowByPn = {};
      for (var k = 0; k < keys.length; k++) {
        var key = String(keys[k][0] || '').trim();
        if (key) rowByPn[key] = k + 2;
      }

      var actor = _hcAdminActor_();
      var now = new Date();

      batch.resolved.forEach(function (r) {
        var rowNum = rowByPn[r.positionNumber];
        if (!rowNum) return;           // row vanished since the bundle was read
        sheet.getRange(rowNum, emailCol).setValue(r.email);
        if (updatedByCol > 0) {
          // The METHOD is recorded, not just the actor. An audit has to be
          // able to tell a unique-name match from a middle-name tie-break.
          sheet.getRange(rowNum, updatedByCol)
               .setValue('directory:' + r.method + ':' + actor);
        }
        if (updatedAtCol > 0) sheet.getRange(rowNum, updatedAtCol).setValue(now);
        written++;
      });

      try { new TravelDB().invalidate(SHEET_NAMES.HC_POSITIONS); } catch (e) { /* non-fatal */ }
      try { HC.hcCacheInvalidateAll(); } catch (e) { /* non-fatal */ }
    }

    // Saved AFTER the write, so a failure mid-write re-runs the same slice
    // rather than skipping it. Re-resolving a position that already has an
    // address is harmless; skipping one leaves someone unable to sign in.
    _setDirectoryResumeIndex_(batch.complete ? 0 : batch.nextIndex);

    var summary = DirectoryLookup.summarise(batch);
    console.log('=== resolveDirectoryEmails ===');
    console.log('lookups ' + summary.lookups + ', resolved ' + summary.resolved +
                ', written ' + written + ', refused ' + summary.refused +
                ', skipped ' + summary.skipped);
    console.log('refusals: ' + JSON.stringify(summary.refusedByReason));
    console.log(batch.complete
      ? 'sweep complete; resume index reset'
      : ('stopped: ' + batch.stoppedBecause + '; resume at ' + batch.nextIndex));

    return successResponse({
      summary: summary,
      written: written,
      nextIndex: batch.complete ? 0 : batch.nextIndex,
      complete: batch.complete,
      stoppedBecause: batch.stoppedBecause,
      refused: batch.refused.slice(0, 100)
    }, 'Wrote ' + written + ' email address(es). ' + summary.refused +
       ' position(s) refused — ' + summary.refusedByReason.ambiguous +
       ' because the name matches more than one person.');
  } catch (e) {
    console.error('resolveDirectoryEmails failed: ' + e.message);
    return errorResponse('Directory resolution failed: ' + e.message);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* already released */ }
  }
}

/** Where the last sweep stopped. 0 when it finished or has never run. */
function _directoryResumeIndex_() {
  try {
    var raw = PropertiesService.getScriptProperties()
      .getProperty(DIRECTORY_RESUME_KEY);
    var n = parseInt(raw, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  } catch (e) {
    return 0;
  }
}

function _setDirectoryResumeIndex_(index) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty(DIRECTORY_RESUME_KEY, String(parseInt(index, 10) || 0));
  } catch (e) {
    console.warn('Could not save the directory resume index: ' + e.message);
  }
}

/**
 * Trigger entry point: resumes the sweep where it stopped.
 *
 * Install with installDirectoryLookupTrigger. Several runs finish a full
 * roster; once complete the resume index resets to 0 and subsequent runs only
 * pick up positions with no address — new hires, in practice.
 *
 * @editor
 */
function syncDirectoryEmails() {
  return resolveDirectoryEmails({});
}

/**
 * Installs an hourly trigger until the sweep completes.
 *
 * HOURLY, NOT DAILY, deliberately. The first sweep needs several runs to get
 * through ~900 positions, and a daily trigger would take most of a week to
 * finish — during which supervisors cannot sign in. Once complete each run is
 * cheap, because positions that already have an address are skipped.
 *
 * Removes any existing trigger for this handler first, so running it twice
 * does not produce two sweeps racing each other through the same rows.
 *
 * @editor
 */
function installDirectoryLookupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncDirectoryEmails') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('syncDirectoryEmails').timeBased().everyHours(1).create();
  console.log('installDirectoryLookupTrigger: hourly. Remove it once the ' +
              'sweep reports complete and new hires are rare.');
  return { success: true };
}

// ============================================================================
// MANUAL RESOLUTION — the admin-facing half
// ============================================================================
//
// @clolry: "can we get a user interface where it prompts the admin to resolve
// the names and provides potential matches? For instance Kittrell,Angela K
// should have Kittrell,Kim offered as a potential match. Also, we need a way
// to save these so they aren't replaced when we pull the daily feed - once we
// make the match we need to keep it."
//
// Two requirements, and the second is the one that would have bitten silently.
//
// THE OVERRIDE TAB EXISTS BECAUSE THE IMPORT CLEARS THE ROSTER
// ------------------------------------------------------------
// importRoster replaces every row in HC_Positions. An address typed into the
// roster editor would survive until the next daily pull and then vanish — the
// person stops being able to sign in days after the correction, with nothing
// linking cause to effect, and the natural response is to type it in again.
//
// So a resolved address is stored in HC_Email_Overrides, keyed on
// Position_Number, and re-applied by the import. HC_Positions is the feed's to
// overwrite; the override tab is the organisation's.
//
// WHY A SEPARATE TAB RATHER THAN A PROTECTED COLUMN
// -------------------------------------------------
// A "do not overwrite this column" rule would have to live inside the import's
// write path, which is precisely where a later refactor would not look. A
// separate tab cannot be clobbered by a sheet-clearing import at all.

/**
 * Positions still needing a human decision, with candidates to offer.
 *
 * Returns the queue the resolution UI renders. Each entry carries the roster
 * name, the directory candidates that share the surname, and WHY each is
 * being suggested — because the reason is what an admin judges, not the
 * resemblance.
 *
 * SUGGESTIONS ARE NOT MATCHES. These use looser rules than the automatic
 * path, deliberately: a wrong suggestion costs a moment's reading, a wrong
 * auto-match grants someone else's access. Nothing here writes.
 *
 * @param {Object} [opts] { limit, startIndex }
 * @returns {Object} successResponse | errorResponse
 * @client
 */
function getEmailResolutionQueue(opts) {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  try {
    if (typeof People === 'undefined' || !People || !People.People) {
      return errorResponse(
        'The People advanced service is not enabled. Apps Script editor: ' +
        'Services -> Add a service -> People API (v1).');
    }

    var o = opts || {};
    var limit = parseInt(o.limit, 10) || 15;
    var start = parseInt(o.startIndex, 10) || 0;

    var bundle = HC.hcGetBundle();
    if (!bundle.success) {
      return errorResponse('Could not read the roster: ' + bundle.error);
    }

    var overrides = readEmailOverrides();
    var queue = [];
    var examined = 0;
    var i = start;
    var deadline = Date.now() + 120000;

    for (; i < bundle.data.length && queue.length < limit; i++) {
      var p = bundle.data[i];
      if (!p || p.occupancyStatus === 'VACANT') continue;
      if (!p.employeeName) continue;
      // Already has an address, from the feed or a previous resolution.
      if (p.emailAddress) continue;
      // Already decided by an admin, even if the roster has not caught up.
      if (overrides[p.positionNumber]) continue;

      if (Date.now() > deadline) break;

      var parsed = DirectoryLookup.parseName(p.employeeName);
      var candidates = [];
      try {
        candidates = _directorySearch_(parsed);
      } catch (e) {
        candidates = [];
      }
      examined++;

      // If the automatic matcher WOULD resolve this, it does not belong in a
      // manual queue — the sweep will handle it.
      var auto = DirectoryLookup.pickMatch(parsed, candidates, p.orgCode);
      if (auto.email) continue;

      // SURNAME-ONLY QUERY, as a second attempt.
      //
      // 'Angela Kittrell' returns nothing when the directory holds 'Kim
      // Kittrell' — the forename is what fails. Searching the surname alone
      // is what makes a nickname findable at all, and it is safe HERE in a
      // way it would never be in the automatic path, because every result is
      // shown to a human rather than written.
      var broader = candidates;
      if (!candidates.length || !DirectoryLookup
            .suggestCandidates(parsed, candidates, p.orgCode).length) {
        try {
          broader = _directorySearch_({
            first: '', last: parsed.last, query: parsed.last
          });
        } catch (e2) {
          broader = candidates;
        }

        // STILL NOTHING: try each COMPONENT of a compound surname.
        //
        // 'Holycross-Simmons,Megan N' returned no candidate at all, and a
        // query for the whole hyphenated surname is why. The directory may
        // hold her as 'Megan Simmons' or 'Megan Holycross' — HR and Workspace
        // disagree about compound surnames constantly, which is the same
        // disagreement behind Andrea Azarcon Heller.
        //
        // Only reached when the full surname found nothing, and every result
        // still goes to a human. The automatic path never sees these.
        if (!broader.length) {
          var parts = DirectoryLookup.surnameTokens(parsed.last);
          for (var pi = 0; pi < parts.length && !broader.length; pi++) {
            // Skip the joined form, already tried as the full surname, and
            // anything too short to be a useful query.
            if (parts[pi].length < 4) continue;
            try {
              var partHits = _directorySearch_({
                first: '', last: parts[pi], query: parts[pi]
              });
              if (partHits.length) broader = partHits;
            } catch (e3) { /* try the next part */ }
          }
        }
      }

      var suggestions = DirectoryLookup.suggestCandidates(
        parsed, broader, p.orgCode);

      queue.push({
        positionNumber: p.positionNumber,
        employeeName: p.employeeName,
        orgCode: p.orgCode,
        officeTitle: p.officeTitle,
        supervisoryStatus: p.supervisoryStatus,
        // Named so the UI can say WHY this person matters: a supervisor with
        // no address cannot sign in at all.
        isSupervisor: String(p.supervisoryStatus) === '2',
        parsedName: parsed,
        autoRefusalReason: auto.reason || '',
        suggestions: suggestions.slice(0, 8)
      });
    }

    return successResponse({
      queue: queue,
      nextIndex: i,
      complete: i >= bundle.data.length,
      examined: examined,
      // The whole population, so the UI can show progress rather than just a
      // page of work.
      totalNeedingEmail: bundle.data.filter(function (x) {
        return x && x.occupancyStatus !== 'VACANT' && x.employeeName &&
               !x.emailAddress && !overrides[x.positionNumber];
      }).length,
      overridesStored: Object.keys(overrides).length
    });
  } catch (e) {
    console.error('getEmailResolutionQueue failed: ' + e.message);
    return errorResponse('Could not build the resolution queue: ' + e.message);
  }
}

/**
 * Records an admin's decision, and writes it to the roster.
 *
 * WRITES TWO PLACES, and both are necessary:
 *
 *   HC_Email_Overrides   the durable record. Survives every import.
 *   HC_Positions         so the change takes effect now rather than after the
 *                        next daily pull.
 *
 * Writing only the override tab would mean a correction did nothing until
 * tomorrow. Writing only the roster is the data loss this exists to prevent.
 *
 * AN EMPTY EMAIL IS A DELIBERATE 'NO ADDRESS' RECORD, not an error. Some
 * people genuinely have no mailbox — contractors, pending arrivals — and
 * recording that stops them reappearing in the queue every day. It is stored
 * with a reason rather than silently skipped.
 *
 * @param {Object} entry { positionNumber, email, matchedDirectoryName, notes }
 * @returns {Object} successResponse | errorResponse
 * @client
 */
function saveEmailOverride(entry) {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  var e = entry || {};
  var pn = String(e.positionNumber || '').trim();
  var email = String(e.email || '').trim().toLowerCase();

  if (!pn) return errorResponse('A position number is required.');
  if (email && email.indexOf('@') === -1) {
    return errorResponse('"' + email + '" is not an email address.');
  }
  // A no-address record must say why, or it is indistinguishable from a
  // mistake and nobody will dare clear it later.
  if (!email && !String(e.notes || '').trim()) {
    return errorResponse(
      'Recording "no address" requires a note explaining why — otherwise a ' +
      'later reader cannot tell a deliberate decision from an accident.');
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
  } catch (lockErr) {
    return errorResponse('Another HR edit is in progress. Try again in a moment.');
  }

  try {
    var bundle = HC.hcGetBundle();
    var position = null;
    if (bundle.success) {
      for (var i = 0; i < bundle.data.length; i++) {
        if (String(bundle.data[i].positionNumber) === pn) {
          position = bundle.data[i];
          break;
        }
      }
    }
    if (!position) {
      return errorResponse('Position ' + pn + ' is not in the roster.');
    }

    // ONE ADDRESS, ONE PERSON. Two positions sharing a mailbox means one of
    // them will match the wrong person at the access gate, and whichever is
    // found first wins — a non-deterministic authorisation.
    if (email) {
      var clash = findPositionWithEmail_(bundle.data, email, pn);
      if (clash) {
        return errorResponse(
          email + ' is already on position ' + clash.positionNumber + ' (' +
          clash.employeeName + '). Two positions sharing an address makes ' +
          'the access gate match whichever it finds first, so this is ' +
          'refused. Clear the other one first if this is a correction.');
      }
    }

    var actor = _hcAdminActor_();
    var now = new Date();

    writeEmailOverrideRow_({
      positionNumber: pn,
      employeeName: position.employeeName,
      email: email,
      method: email ? (String(e.matchedDirectoryName || '').trim()
                        ? 'ADMIN_CONFIRMED' : 'ADMIN_MANUAL')
                    : 'ADMIN_NO_ADDRESS',
      matchedDirectoryName: String(e.matchedDirectoryName || '').trim(),
      notes: String(e.notes || '').trim(),
      actor: actor,
      now: now
    });

    var applied = applyEmailToRoster_(pn, email, actor, now);

    try { new TravelDB().invalidate(SHEET_NAMES.HC_POSITIONS); } catch (ce) { /* non-fatal */ }
    try { HC.hcCacheInvalidateAll(); } catch (ce2) { /* non-fatal */ }

    console.log('saveEmailOverride: ' + actor + ' set ' + pn + ' (' +
                position.employeeName + ') to ' +
                (email || '[no address]') +
                (applied ? '' : ' — override stored, roster row not found'));

    return successResponse(
      { positionNumber: pn, email: email, rosterUpdated: applied },
      email ? ('Saved ' + email + ' for ' + position.employeeName +
               '. This will survive the daily roster import.')
            : ('Recorded "no address" for ' + position.employeeName + '.'));
  } catch (err) {
    console.error('saveEmailOverride failed: ' + err.message);
    return errorResponse('Could not save: ' + err.message);
  } finally {
    try { lock.releaseLock(); } catch (relErr) { /* already released */ }
  }
}

/** A position other than `excludePn` already holding this address. */
function findPositionWithEmail_(positions, email, excludePn) {
  var want = String(email).toLowerCase();
  for (var i = 0; i < (positions || []).length; i++) {
    var p = positions[i];
    if (!p || !p.emailAddress) continue;
    if (String(p.positionNumber) === String(excludePn)) continue;
    if (String(p.emailAddress).toLowerCase() === want) return p;
  }
  return null;
}

/**
 * Every stored override, keyed on position number.
 *
 * Returns {} rather than throwing when the tab is absent, so a deployment
 * that has not run setupTravelDatabase still imports — the overrides are
 * additive, and their absence must not block the roster.
 *
 * @returns {Object} positionNumber -> override record
 */
function readEmailOverrides() {
  var out = {};
  try {
    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.HC_EMAIL_OVERRIDES);
    if (!sheet) return out;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return out;

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_EMAIL_OVERRIDES];
    var col = {};
    headers.forEach(function (h, i) { col[h] = i; });

    var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    rows.forEach(function (r) {
      var pn = String(r[col['Position_Number']] || '').trim();
      if (!pn) return;
      // Is_Active false is a RETIRED override, not a deleted one. The row
      // stays so the decision and its reversal are both on record.
      var active = r[col['Is_Active']];
      if (active === false || String(active).toUpperCase() === 'FALSE') return;
      // Later row wins, so a re-resolution supersedes without an edit in
      // place — append-only, like every other audit surface here.
      out[pn] = {
        positionNumber: pn,
        employeeName: String(r[col['Employee_Name_At_Resolution']] || ''),
        email: String(r[col['Email_Address']] || '').trim().toLowerCase(),
        method: String(r[col['Resolution_Method']] || ''),
        matchedDirectoryName: String(r[col['Matched_Directory_Name']] || ''),
        notes: String(r[col['Notes']] || '')
      };
    });
  } catch (e) {
    console.warn('readEmailOverrides: ' + e.message);
  }
  return out;
}

/** Appends one override row. */
function writeEmailOverrideRow_(o) {
  var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAMES.HC_EMAIL_OVERRIDES);
  if (!sheet) {
    throw new Error(SHEET_NAMES.HC_EMAIL_OVERRIDES + ' tab not found. Run ' +
                    'setupTravelDatabase() to create it.');
  }

  var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_EMAIL_OVERRIDES];
  var rec = {
    'Position_Number': o.positionNumber,
    'Employee_Name_At_Resolution': o.employeeName,
    'Email_Address': o.email,
    'Resolution_Method': o.method,
    'Matched_Directory_Name': o.matchedDirectoryName,
    'Notes': o.notes,
    'Is_Active': true,
    'Created_By': o.actor,
    'Created_At': o.now,
    'Updated_By': o.actor,
    'Updated_At': o.now
  };
  // Mapped over the schema headers, never built by hand: writes are
  // positional (docs/DATA_DICTIONARY.md §3.9).
  var row = headers.map(function (h) { return h in rec ? rec[h] : ''; });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length)
       .setValues([row]);
}

/** Writes an address straight onto the roster row. */
function applyEmailToRoster_(positionNumber, email, actor, now) {
  var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAMES.HC_POSITIONS);
  if (!sheet) return false;

  var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_POSITIONS];
  var pnCol = headers.indexOf('Position_Number') + 1;
  var emailCol = headers.indexOf('Email_Address') + 1;
  var byCol = headers.indexOf('Updated_By') + 1;
  var atCol = headers.indexOf('Updated_At') + 1;
  if (pnCol < 1 || emailCol < 1) return false;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var keys = sheet.getRange(2, pnCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() !== String(positionNumber).trim()) continue;
    var rowNum = i + 2;
    sheet.getRange(rowNum, emailCol).setValue(email);
    if (byCol > 0) sheet.getRange(rowNum, byCol).setValue('override:' + actor);
    if (atCol > 0) sheet.getRange(rowNum, atCol).setValue(now);
    return true;
  }
  return false;
}
