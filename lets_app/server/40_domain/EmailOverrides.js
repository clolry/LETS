/**
 * EmailOverrides.js
 * Admin corrections to a roster email address, and the roster write.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The HR feed is authoritative about email addresses — @clolry: "the email
 * address provided in this data source is definitive and without question" —
 * and measured coverage is 821 of 821 named rows. So in the normal case
 * nothing here runs.
 *
 * It exists for the abnormal case, and that case is not hypothetical. If the
 * feed ever carries a wrong address, or none, for one person, this is the ONLY
 * way to correct it that survives the next import. Editing HC_Positions by
 * hand does not: importRoster clears and rewrites every row, so a hand edit
 * lives until tomorrow morning and then silently reverts.
 *
 * The consequence of having no correction path is specific. Email_Address is
 * how LETS decides who somebody IS:
 *
 *   Access.js   the HC supervisor access rule matches the signed-in user
 *               against Email_Address
 *   Access.js   the Service Center Director lookup matches on it
 *   HCPrivacy   the reviewer allow-list, so a reviewer can contact a traveler
 *
 * A person with a wrong address cannot sign in, and nobody can fix it until
 * HR corrects the source — which can take weeks.
 *
 * WHAT WAS DELETED AROUND IT
 * --------------------------
 * These five functions are what remains of a ~5,100-line directory
 * name-matching subsystem (DirectoryLookup.js, DirectoryResolve.js,
 * test_directory_lookup.js). That subsystem existed for one reason: the
 * previous HR source, the FAS HRLinks feed, had 33 columns and not one of them
 * was an email address, so addresses had to be INFERRED from names via the
 * Google People API.
 *
 * Inferring an identity that the access gate then trusts is a security
 * boundary resting on a guess, and the matching had to refuse an ambiguous
 * name rather than pick one — eight people named Hall, a surname carrying an
 * org suffix, three nicknames needing a human decision.
 *
 * The FC workforce report carries Employee Email, so none of that is needed.
 * The People advanced service is removed from appsscript.json with it: an
 * unused directory.readonly scope on a web app running as USER_ACCESSING is a
 * permission every user grants for no reason.
 *
 * WHY THE OVERRIDE TAB SURVIVED THE DELETION
 * ------------------------------------------
 * @clolry chose this deliberately when asked. The alternative was deleting
 * HC_Email_Overrides too, which is simpler and leaves no way to correct one
 * person's address — so a single bad cell in the feed locks somebody out of
 * LETS indefinitely. 150 lines against that risk is cheap.
 *
 * The tab also holds the RECORD of decisions already made, including
 * deliberate 'no address' entries for people who genuinely have no mailbox.
 * Deleting it would discard those and put them back in front of an admin as
 * open questions.
 */

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
    // found first wins — a non-deterministic authorization.
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
