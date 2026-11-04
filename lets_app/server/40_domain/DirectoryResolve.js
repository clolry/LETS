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

  var query = parsed.first + ' ' + parsed.last;
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
