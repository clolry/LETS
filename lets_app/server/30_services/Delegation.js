/**
 * Delegation.js
 * Acting on another reviewer's behalf.
 *
 * WHAT THIS SOLVES
 * ----------------
 * @clolry: "In go.gov when a user delegates access, the other logs in and
 * then can choose to emulate that user's access and approvals (of course
 * they're logged as themselves but are given the rights to view/edit as the
 * other person would)."
 *
 * The parenthetical is the entire design. A delegate acts AS THEMSELVES with
 * somebody else's authority. They do not become that person, and the record
 * must never suggest they did.
 *
 * WHY NOT JUST GRANT THE ROLE
 * ---------------------------
 * The obvious implementation is a Travel_User_Roles row giving the delegate
 * the principal's role. It would work, and it would be wrong three ways:
 *
 *   1. Indistinguishable afterwards. Six months on, nobody can tell whether
 *      Bob was a BU reviewer or was covering for Alice for a fortnight.
 *   2. No end date. A role granted for two weeks of leave stays granted until
 *      somebody remembers.
 *   3. The approval log would show Bob approving under his own authority,
 *      losing the fact that the authority was Alice's.
 *
 * So a delegation is its own record, with its own lifetime, and every action
 * taken under it carries BOTH identities.
 *
 * THE ACT-AS SWITCH IS EXPLICIT
 * -----------------------------
 * Holding a delegation does not silently widen what a delegate sees. They
 * choose to act as the principal, per session, and the UI says so while it is
 * on. A delegate who forgot they held somebody's authority and approved
 * something under it by accident is the failure this prevents.
 *
 * WHAT A DELEGATE CANNOT DO
 * -------------------------
 *   - Re-delegate. Authority would spread transitively and the audit chain
 *     would become unfollowable.
 *   - Create a delegation at all. Only the principal, or an admin on their
 *     behalf.
 *   - Act outside the window. An expired delegation is refused, not warned
 *     about.
 */

var Delegation = (function () {

  function _str_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
  function _lower_(v) { return _str_(v).toLowerCase(); }

  /** YYYY-MM-DD, or '' when unparseable. */
  function toDateString(v) {
    if (!v) return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      var m = v.getMonth() + 1;
      var d = v.getDate();
      return v.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' +
             (d < 10 ? '0' + d : d);
    }
    var s = _str_(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var parsed = new Date(s);
    return isNaN(parsed.getTime()) ? '' : toDateString(parsed);
  }

  function today() {
    return toDateString(new Date());
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  /**
   * Every delegation row.
   *
   * Reads BY HEADER NAME, not position. Eighteen places in LETS read
   * positionally and a column insertion silently misfiles them (G-014).
   */
  function readAll(db) {
    var data;
    try {
      data = db.readSheet(SHEET_NAMES.REVIEW_DELEGATIONS);
    } catch (e) {
      console.warn('Delegation: could not read ' +
                   SHEET_NAMES.REVIEW_DELEGATIONS + ': ' + e.message);
      return [];
    }
    if (!data || !data.headers.length) return [];
    var i = data.headerIndex;
    var g = function (row, n) { return (n in i) ? row[i[n]] : ''; };

    var out = [];
    data.rows.forEach(function (row) {
      var id = _str_(g(row, 'Delegation_ID'));
      if (!id) return;
      out.push({
        delegationId: id,
        principalEmail: _lower_(g(row, 'Principal_Email')),
        principalName: _str_(g(row, 'Principal_Name')),
        delegateEmail: _lower_(g(row, 'Delegate_Email')),
        delegateName: _str_(g(row, 'Delegate_Name')),
        scope: _str_(g(row, 'Scope')) || 'all',
        startDate: toDateString(g(row, 'Start_Date')),
        endDate: toDateString(g(row, 'End_Date')),
        reason: _str_(g(row, 'Reason')),
        status: _str_(g(row, 'Status')).toUpperCase() || 'ACTIVE',
        createdBy: _lower_(g(row, 'Created_By')),
        createdAt: toDateString(g(row, 'Created_At')),
        revokedBy: _lower_(g(row, 'Revoked_By')),
        revokedAt: toDateString(g(row, 'Revoked_At')),
        revokeReason: _str_(g(row, 'Revoke_Reason'))
      });
    });
    return out;
  }

  /**
   * Is this delegation in force today?
   *
   * EXPIRY IS COMPUTED, NOT STORED. The Status column has an EXPIRED value
   * and nothing writes it — there is no nightly job, and adding one would
   * mean a delegation stayed live until the job next ran.
   *
   * Computing it from the dates means an end date of yesterday stops working
   * at midnight with no moving part. Status is therefore only ever ACTIVE or
   * REVOKED in the sheet, and EXPIRED is derived for display.
   *
   * @param {Object} d
   * @param {string} [asOf] YYYY-MM-DD, defaults to today
   * @returns {boolean}
   */
  function isInForce(d, asOf) {
    if (!d) return false;
    if (d.status === 'REVOKED') return false;
    var when = asOf || today();
    if (!d.startDate || !d.endDate) return false;
    return d.startDate <= when && when <= d.endDate;
  }

  /** The display status, which includes the derived EXPIRED. */
  function effectiveStatus(d, asOf) {
    if (!d) return '';
    if (d.status === 'REVOKED') return 'REVOKED';
    var when = asOf || today();
    if (d.endDate && d.endDate < when) return 'EXPIRED';
    if (d.startDate && d.startDate > when) return 'SCHEDULED';
    return 'ACTIVE';
  }

  /**
   * Delegations this user may currently act under.
   *
   * @param {string} email the delegate
   * @param {string} [asOf]
   * @returns {Array<Object>}
   */
  function availableTo(email, asOf) {
    var who = _lower_(email);
    if (!who) return [];
    try {
      var db = new TravelDB();
      return readAll(db).filter(function (d) {
        return d.delegateEmail === who && isInForce(d, asOf);
      });
    } catch (e) {
      console.error('Delegation.availableTo: ' + e.message);
      return [];
    }
  }

  /**
   * Checks that `delegate` may act as `principal` right now.
   *
   * Called before every delegated action. Re-checked at ACTION TIME rather
   * than trusted from the session, because a delegation can be revoked while
   * somebody is sitting on a page with the switch already on.
   *
   * @param {string} delegateEmail
   * @param {string} principalEmail
   * @param {string} [asOf]
   * @returns {{allowed: boolean, delegation: Object|null, reason: string}}
   */
  function canActAs(delegateEmail, principalEmail, asOf) {
    var dEmail = _lower_(delegateEmail);
    var pEmail = _lower_(principalEmail);

    if (!dEmail || !pEmail) {
      return { allowed: false, delegation: null,
               reason: 'Both the delegate and the principal must be identified.' };
    }
    if (dEmail === pEmail) {
      // Not an error worth refusing loudly — it just means no delegation is
      // needed. But it must not return a delegation object, or the caller
      // would stamp an action as delegated when it was not.
      return { allowed: false, delegation: null,
               reason: 'You are already acting as yourself.' };
    }

    var matches = availableTo(dEmail, asOf).filter(function (d) {
      return d.principalEmail === pEmail;
    });

    if (!matches.length) {
      return { allowed: false, delegation: null,
               reason: 'You do not hold an active delegation from ' + pEmail + '.' };
    }

    // Most recently created wins when several overlap. Overlapping
    // delegations from one principal are not an error — a reviewer may extend
    // cover by adding a second rather than revoking the first.
    matches.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    return { allowed: true, delegation: matches[0], reason: '' };
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /**
   * Checks a proposed delegation.
   *
   * @param {Object} d
   * @param {Object} options { actorEmail, isAdmin, existing }
   * @returns {Array<string>}
   */
  function validate(d, options) {
    options = options || {};
    var problems = [];
    var del = d || {};

    var principal = _lower_(del.principalEmail);
    var delegate = _lower_(del.delegateEmail);
    var actor = _lower_(options.actorEmail);

    if (!principal) problems.push('The principal (whose authority is lent) is required.');
    else if (principal.indexOf('@') === -1) problems.push('Principal email looks invalid.');

    if (!delegate) problems.push('The delegate (who may act) is required.');
    else if (delegate.indexOf('@') === -1) problems.push('Delegate email looks invalid.');

    if (principal && delegate && principal === delegate) {
      problems.push('A reviewer cannot delegate to themselves.');
    }

    // ONLY THE PRINCIPAL, OR AN ADMIN. A reviewer going on leave should not
    // need an administrator; but nobody else may lend authority that is not
    // theirs.
    if (actor && principal && actor !== principal && !options.isAdmin) {
      problems.push('You can only delegate your own authority. Ask ' + principal +
                    ' to set this up, or an administrator.');
    }

    // NO RE-DELEGATION. Authority would spread transitively and the audit
    // chain would be unfollowable.
    if (principal && (options.existing || []).some(function (x) {
      return x.delegateEmail === principal && isInForce(x);
    })) {
      problems.push(principal + ' is currently acting under a delegation ' +
                    'themselves and cannot lend authority onward.');
    }

    var start = toDateString(del.startDate);
    var end = toDateString(del.endDate);

    if (!start) problems.push('Start date is required.');
    // AN END DATE IS REQUIRED, deliberately. An open-ended delegation is
    // indistinguishable from a permanent role grant, which is the thing this
    // design exists to avoid. Cover for leave has a last day.
    if (!end) {
      problems.push('End date is required. An open-ended delegation is a role ' +
                    'grant in disguise — if the cover is permanent, grant the ' +
                    'role instead.');
    }
    if (start && end && end < start) {
      problems.push('End date ' + end + ' is before the start date ' + start + '.');
    }
    if (start && end) {
      var days = Math.round((Date.parse(end + 'T12:00:00Z') -
                             Date.parse(start + 'T12:00:00Z')) / 86400000);
      if (days > 365) {
        problems.push('A delegation longer than a year should be a role grant, ' +
                      'not a delegation.');
      }
    }

    // A REASON IS REQUIRED. Six months from now this row is the only record
    // of why somebody else was approving travel.
    if (!_str_(del.reason)) {
      problems.push('A reason is required — "annual leave", "detail to FAS". ' +
                    'It is the only record of why someone else was approving.');
    }

    // An overlapping delegation to the SAME delegate from the SAME principal
    // is permitted (extending cover), but an exact duplicate is a mistake.
    if (principal && delegate && start && end) {
      var dupe = (options.existing || []).some(function (x) {
        return x.principalEmail === principal && x.delegateEmail === delegate &&
               x.startDate === start && x.endDate === end && x.status !== 'REVOKED';
      });
      if (dupe) problems.push('That exact delegation already exists.');
    }

    return problems;
  }

  return {
    readAll: readAll,
    availableTo: availableTo,
    canActAs: canActAs,
    isInForce: isInForce,
    effectiveStatus: effectiveStatus,
    validate: validate,
    toDateString: toDateString,
    today: today
  };
})();

// ============================================================================
// BROWSER ENTRY POINTS
// ============================================================================

/**
 * Delegations relevant to the signed-in user.
 *
 * Returns both directions: what they have lent out, and what they may act
 * under. A reviewer needs to see both — one to revoke, the other to use.
 *
 * NOT ADMIN-GATED, because a reviewer managing their own cover is the primary
 * use. An admin additionally sees everything.
 *
 * @returns {Object}
 * @client
 */
function getMyDelegations() {
  var who = '';
  try {
    who = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (e) {
    return errorResponse('Could not determine the active user.');
  }
  if (!who) return errorResponse('Could not determine the active user.');

  try {
    var db = new TravelDB();
    var all = Delegation.readAll(db);
    var isAdmin = false;
    try { isAdmin = isTravelAdmin(who); } catch (e) { isAdmin = false; }

    var decorate = function (d) {
      return {
        delegationId: d.delegationId,
        principalEmail: d.principalEmail,
        principalName: d.principalName,
        delegateEmail: d.delegateEmail,
        delegateName: d.delegateName,
        scope: d.scope,
        startDate: d.startDate,
        endDate: d.endDate,
        reason: d.reason,
        // The DERIVED status, which includes EXPIRED and SCHEDULED. The stored
        // Status is only ever ACTIVE or REVOKED.
        status: Delegation.effectiveStatus(d),
        inForce: Delegation.isInForce(d),
        createdBy: d.createdBy,
        createdAt: d.createdAt,
        revokedBy: d.revokedBy,
        revokeReason: d.revokeReason
      };
    };

    return successResponse({
      // What I have lent out.
      granted: all.filter(function (d) { return d.principalEmail === who; })
        .map(decorate),
      // What I may act under.
      received: all.filter(function (d) { return d.delegateEmail === who; })
        .map(decorate),
      // Only what is usable right now, for the act-as switch.
      canActAs: Delegation.availableTo(who).map(function (d) {
        return { delegationId: d.delegationId, principalEmail: d.principalEmail,
                 principalName: d.principalName, endDate: d.endDate,
                 scope: d.scope };
      }),
      all: isAdmin ? all.map(decorate) : [],
      isAdmin: isAdmin,
      today: Delegation.today()
    });
  } catch (e) {
    console.error('getMyDelegations failed: ' + e.message);
    return errorResponse('Could not read delegations: ' + e.message);
  }
}

/**
 * Creates a delegation.
 *
 * The PRINCIPAL may create their own; an admin may create any. A delegate
 * cannot create one, including re-delegating what they hold.
 *
 * @param {Object} delegation
 * @returns {Object}
 * @client
 */
function createDelegation(delegation) {
  var who = '';
  try {
    who = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (e) {
    return errorResponse('Could not determine the active user.');
  }
  if (!who) return errorResponse('Could not determine the active user.');

  var isAdmin = false;
  try { isAdmin = isTravelAdmin(who); } catch (e) { isAdmin = false; }

  var d = delegation || {};
  // Default the principal to the actor. The common case is a reviewer
  // arranging their own cover, and making them type their own address invites
  // a typo that silently lends somebody else's authority.
  if (!d.principalEmail) d.principalEmail = who;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
  } catch (e) {
    return errorResponse('Another delegation change is in progress. Try again shortly.');
  }

  try {
    var db = new TravelDB();
    var existing = Delegation.readAll(db);
    var problems = Delegation.validate(d, {
      actorEmail: who, isAdmin: isAdmin, existing: existing
    });
    if (problems.length) return { success: false, problems: problems };

    var sheet = db.sheet(SHEET_NAMES.REVIEW_DELEGATIONS);
    if (!sheet) {
      return errorResponse(SHEET_NAMES.REVIEW_DELEGATIONS + ' tab not found. ' +
                           'Run setupTravelDatabase() first.');
    }

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.REVIEW_DELEGATIONS];
    var now = new Date();
    var nameOf = function (email) {
      try {
        return (typeof formatUserName === 'function') ? formatUserName(email) : email;
      } catch (e) { return email; }
    };

    var rec = {
      'Delegation_ID': 'del_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      'Principal_Email': String(d.principalEmail).toLowerCase(),
      'Principal_Name': nameOf(d.principalEmail),
      'Delegate_Email': String(d.delegateEmail).toLowerCase(),
      'Delegate_Name': nameOf(d.delegateEmail),
      'Scope': String(d.scope || 'all'),
      'Start_Date': Delegation.toDateString(d.startDate),
      'End_Date': Delegation.toDateString(d.endDate),
      'Reason': String(d.reason).trim(),
      // Only ever ACTIVE or REVOKED in the sheet. EXPIRED is derived from the
      // dates, so there is no job to forget to run.
      'Status': 'ACTIVE',
      'Created_By': who,
      'Created_At': now
    };
    // Mapped over the schema headers, never built by hand: writes are
    // positional (docs/DATA_DICTIONARY.md §3.9).
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length)
      .setValues([headers.map(function (h) { return h in rec ? rec[h] : ''; })]);

    try { db.invalidate(SHEET_NAMES.REVIEW_DELEGATIONS); } catch (e) { /* non-fatal */ }

    // Logged to Access_Log because lending review authority is an
    // authorization change, and that is where authorization changes live.
    try {
      var logHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.ACCESS_LOG];
      var logRec = {
        'Log_ID': 'dlg_' + Date.now(),
        'Timestamp': now,
        'Email': who,
        'Decision': 'DELEGATION_CREATED',
        'Path': 'createDelegation',
        'Detail': rec.Principal_Email + ' -> ' + rec.Delegate_Email + ' (' +
                  rec.Start_Date + ' to ' + rec.End_Date + '): ' + rec.Reason
      };
      db.appendRow(SHEET_NAMES.ACCESS_LOG,
        logHeaders.map(function (h) { return h in logRec ? logRec[h] : ''; }));
    } catch (e) {
      console.warn('createDelegation: audit write failed: ' + e.message);
    }

    console.log('createDelegation: ' + who + ' granted ' + rec.Delegate_Email +
                ' authority from ' + rec.Principal_Email);

    return successResponse({ delegationId: rec.Delegation_ID },
      rec.Delegate_Name + ' can act on your behalf from ' + rec.Start_Date +
      ' to ' + rec.End_Date + '.');
  } catch (e) {
    console.error('createDelegation failed: ' + e.message);
    return errorResponse('Could not create the delegation: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Revokes a delegation.
 *
 * The PRINCIPAL may revoke their own, an admin may revoke any, and the
 * DELEGATE may decline one — somebody handed unexpected authority should be
 * able to give it back without chasing the principal.
 *
 * @param {string} delegationId
 * @param {string} reason
 * @returns {Object}
 * @client
 */
function revokeDelegation(delegationId, reason) {
  var who = '';
  try {
    who = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (e) {
    return errorResponse('Could not determine the active user.');
  }
  if (!who) return errorResponse('Could not determine the active user.');
  if (!_delegationReason_(reason)) {
    return errorResponse('A reason is required to revoke a delegation.');
  }

  try {
    var db = new TravelDB();
    var all = Delegation.readAll(db);
    var target = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].delegationId === delegationId) { target = all[i]; break; }
    }
    if (!target) return errorResponse('Delegation not found.');
    if (target.status === 'REVOKED') {
      return errorResponse('That delegation was already revoked.');
    }

    var isAdmin = false;
    try { isAdmin = isTravelAdmin(who); } catch (e) { isAdmin = false; }

    var mayRevoke = isAdmin ||
                    who === target.principalEmail ||
                    who === target.delegateEmail;
    if (!mayRevoke) {
      console.warn('revokeDelegation: refused ' + who + ' on ' + delegationId);
      return errorResponse('Only the principal, the delegate, or an ' +
                           'administrator can revoke this delegation.');
    }

    var data = db.readSheet(SHEET_NAMES.REVIEW_DELEGATIONS);
    var idx = data.headerIndex;
    var sheet = db.sheet(SHEET_NAMES.REVIEW_DELEGATIONS);
    var rowNum = -1;
    for (var j = 0; j < data.rows.length; j++) {
      if (String(data.rows[j][idx['Delegation_ID']]) === delegationId) {
        rowNum = j + 2;
        break;
      }
    }
    if (rowNum === -1 || !sheet) return errorResponse('Delegation row not found.');

    var now = new Date();
    var set = function (col, val) {
      if (col in idx) sheet.getRange(rowNum, idx[col] + 1).setValue(val);
    };
    // REVOKED, not deleted. Approvals already taken under this delegation
    // reference it, and deleting the row would orphan them.
    set('Status', 'REVOKED');
    set('Revoked_By', who);
    set('Revoked_At', now);
    set('Revoke_Reason', _delegationReason_(reason));

    try { db.invalidate(SHEET_NAMES.REVIEW_DELEGATIONS); } catch (e) { /* non-fatal */ }

    try {
      var logHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.ACCESS_LOG];
      var logRec = {
        'Log_ID': 'dlg_' + Date.now(),
        'Timestamp': now,
        'Email': who,
        'Decision': 'DELEGATION_REVOKED',
        'Path': 'revokeDelegation',
        'Detail': delegationId + ' (' + target.principalEmail + ' -> ' +
                  target.delegateEmail + '): ' + _delegationReason_(reason)
      };
      db.appendRow(SHEET_NAMES.ACCESS_LOG,
        logHeaders.map(function (h) { return h in logRec ? logRec[h] : ''; }));
    } catch (e) {
      console.warn('revokeDelegation: audit write failed: ' + e.message);
    }

    return successResponse({ delegationId: delegationId }, 'Delegation revoked.');
  } catch (e) {
    console.error('revokeDelegation failed: ' + e.message);
    return errorResponse('Could not revoke the delegation: ' + e.message);
  }
}

/** Trimmed reason, or ''. */
function _delegationReason_(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}
