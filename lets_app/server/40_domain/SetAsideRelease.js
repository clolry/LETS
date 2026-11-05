/**
 * SetAsideRelease.js
 * Releasing a reserved set-aside so the money can fund something else.
 *
 * WHY THIS EXISTS
 * ---------------
 * The FC senior advisor needs about $48,000 of DC travel. It was briefly
 * charged to the three DACs as a shared set-aside, which cut ASD discretionary
 * from $444,500 to $396,500. The Chief of Staff rejected that.
 *
 * @clolry: "he does not want to take additional funds from the orgs to fund
 * the FC senior advisor's $48k of travel - there are some events that we
 * set-aside funds in Q1 that did not happen so we think that we should be able
 * to pull from those set-aside funds for his travel."
 *
 * So money already reserved for Q1 events that did not happen gets released
 * and redirected. Q1 holds $50,000 of event-plan reservations — Exec Team
 * Atlanta $15,000, DC $15,000, KC/FW $20,000 — which is where the $48,000
 * comes from.
 *
 * WHY A RELEASE IS A RECORD AND NOT A CONFIG EDIT
 * ----------------------------------------------
 * The obvious implementation is to change the Q1 amounts in BudgetConfig and
 * put $48,000 on the advisor line. That would produce the right totals and
 * destroy the information that matters:
 *
 *   - WHICH event was cancelled, and therefore whether cancelling it was the
 *     right call;
 *   - WHO authorized moving its money, which is the control an auditor asks
 *     for first;
 *   - WHAT the money went to, so the advisor's travel can be traced to its
 *     funding decision rather than appearing as an unfunded charge;
 *   - WHEN, so a mid-year release does not retroactively rewrite what the
 *     DACs were told in October.
 *
 * A release is therefore an append-only row in Event_Set_Asides with
 * Status RELEASED, carrying its source, destination, amount, actor and date.
 * The config stays as the agreed FY27 plan; the data records what happened to
 * it. That split is the same one BudgetAdmin already uses for allocations —
 * config holds the baseline, the sheet holds what an admin actually did.
 *
 * WHY THE ADVISOR LINE IS $0 IN CONFIG
 * ------------------------------------
 * Because the advisor is not funded by a charge at all now. Its config entry
 * is type FUNDED_FROM_RELEASES with amount 0 and expectedAnnualCost 48000, so:
 *
 *   officeSetAsides      adds nothing to any DAC — discretionary stays
 *                        $444,500, which is the point of the whole change
 *   this module          reports how much has been RELEASED toward it, which
 *                        is the money that actually exists
 *   the dashboard        can show committed-against-released and flag a
 *                        shortfall, instead of presenting a $0 reservation as
 *                        if it were unlimited
 *
 * THE FAILURE MODE THIS IS BUILT TO PREVENT
 * -----------------------------------------
 * Releasing the same reservation twice. $20,000 released to the advisor on
 * Monday and $20,000 released again on Tuesday from the same cancelled event
 * is $40,000 of spending authority from $20,000 of money, and every total
 * still reconciles because each release looks individually correct.
 *
 * So a source reservation's releasable amount is its amount MINUS everything
 * already released from it and MINUS anything already consumed by approved
 * travel. Asserted in test_set_aside_release.js §3, with a negative control
 * that removes the check and confirms the double release goes through.
 */

var SetAsideRelease = (function () {

  function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

  function _str_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  /**
   * Status values a release touches.
   *
   * The Event_Set_Asides schema already declares
   * PLANNED | COMMITTED | RELEASED | EXPIRED, so RELEASED is not a new state —
   * it was declared and never used. EXPIRED is distinct and deliberately not
   * written here: an expired reservation is one whose month has passed with
   * nothing spent, which is an automatic consequence of time. A RELEASE is a
   * decision someone made, and conflating the two would lose exactly the
   * accountability this module exists to keep.
   */
  var RELEASABLE_FROM = ['PLANNED', 'COMMITTED'];

  /**
   * How much of a reservation can still be released.
   *
   * amount - already released - already consumed.
   *
   * CONSUMED MATTERS AS MUCH AS RELEASED. A reservation that held $20,000 and
   * has $6,000 of approved travel drawn against it has $14,000 to give away,
   * not $20,000. Releasing the full amount would promise money that is already
   * spoken for by trips someone has been told are approved.
   *
   * @param {Object} reservation enriched set-aside from Events.listEvents
   * @param {Array} releases     prior releases from this reservation
   * @returns {{amount: number, released: number, consumed: number,
   *            releasable: number, blocked: string}}
   */
  function releasableAmount(reservation, releases) {
    var amount = round2(reservation && reservation.amount);
    var consumed = round2(reservation && reservation.consumedAmount);
    var released = 0;

    (releases || []).forEach(function (r) {
      if (_str_(r.sourceSetAsideId) === _str_(reservation.setAsideId)) {
        released = round2(released + round2(r.amount));
      }
    });

    var releasable = round2(amount - released - consumed);
    var blocked = '';

    var status = _str_(reservation && reservation.status).toUpperCase() || 'PLANNED';
    if (RELEASABLE_FROM.indexOf(status) === -1) {
      blocked = 'This reservation is ' + status + ', so there is nothing to release.';
    } else if (releasable <= 0) {
      blocked = amount
        ? ('All $' + amount.toFixed(2) + ' is already released or consumed.')
        : 'This reservation holds no money.';
    }

    return {
      amount: amount,
      released: released,
      consumed: consumed,
      releasable: releasable < 0 ? 0 : releasable,
      blocked: blocked
    };
  }

  /**
   * Checks a release before it is written.
   *
   * Returns problems rather than throwing, so the UI shows all of them at once.
   *
   * @param {Object} entry      { sourceSetAsideId, amount, destination, reason }
   * @param {Object} reservation the source, enriched
   * @param {Array} releases    prior releases
   * @returns {Array<string>}
   */
  function validateRelease(entry, reservation, releases) {
    var problems = [];
    var e = entry || {};

    if (!_str_(e.sourceSetAsideId)) {
      problems.push('A source reservation is required — a release has to come ' +
                    'from somewhere specific.');
    }
    if (!reservation) {
      problems.push('Reservation ' + _str_(e.sourceSetAsideId) + ' was not found.');
      return problems;   // nothing below can be checked without it
    }

    // THE DESTINATION IS MANDATORY. A release with no destination is money
    // leaving a reservation and going nowhere recorded, which is
    // indistinguishable from a reservation being quietly deleted.
    if (!_str_(e.destination)) {
      problems.push('What the money is being released FOR is required. ' +
                    'Without it the release is a deletion with extra steps.');
    }

    // And a reason, because "the event did not happen" is the fact that
    // justifies the whole transaction and nobody will remember it in March.
    if (!_str_(e.reason)) {
      problems.push('A reason is required — why is this reservation no longer ' +
                    'needed?');
    }

    var amount = Number(e.amount);
    if (e.amount === '' || e.amount === null || e.amount === undefined) {
      problems.push('An amount is required. To release the whole reservation, ' +
                    'enter its full value.');
    } else if (isNaN(amount)) {
      problems.push('Amount "' + e.amount + '" is not a number.');
    } else if (amount <= 0) {
      // A zero release is a no-op that looks like an action; a negative one
      // would ADD money to a reservation, which is not a release at all.
      problems.push('Amount must be greater than zero.');
    } else {
      var avail = releasableAmount(reservation, releases);
      if (avail.blocked) {
        problems.push(avail.blocked);
      } else if (round2(amount) > avail.releasable) {
        // THE DOUBLE-RELEASE GUARD. See the file header.
        problems.push(
          'Cannot release $' + round2(amount).toFixed(2) + ': only $' +
          avail.releasable.toFixed(2) + ' of this $' + avail.amount.toFixed(2) +
          ' reservation is still available' +
          (avail.released ? (', $' + avail.released.toFixed(2) + ' already released') : '') +
          (avail.consumed ? (', $' + avail.consumed.toFixed(2) + ' already spent') : '') +
          '.');
      }
    }

    return problems;
  }

  /**
   * Reads release rows out of Event_Set_Asides.
   *
   * A release is a row with Status RELEASED. Its Notes field carries the
   * structured payload — source, destination, reason — because adding four
   * columns to Event_Set_Asides for a temporary funding mechanism would widen
   * a schema that eleven positional readers index into. Encoded with an
   * explicit prefix so it is parseable rather than guessed at.
   *
   * @param {Array} setAsides all set-asides, enriched
   * @returns {Array<Object>}
   */
  function readReleases(setAsides) {
    var out = [];
    (setAsides || []).forEach(function (sa) {
      if (_str_(sa.status).toUpperCase() !== 'RELEASED') return;
      var parsed = parseReleaseNotes(sa.notes);
      out.push({
        releaseId: sa.setAsideId,
        sourceSetAsideId: parsed.source,
        destination: parsed.destination,
        reason: parsed.reason,
        amount: round2(sa.amount),
        officeCode: _str_(sa.officeCode).toUpperCase(),
        orgCode: _str_(sa.orgCode).toUpperCase(),
        fiscalYear: _str_(sa.fiscalYear),
        releasedBy: _str_(sa.createdBy),
        eventName: _str_(sa.eventName)
      });
    });
    return out;
  }

  /** Encodes a release's structured fields into the Notes column. */
  function formatReleaseNotes(entry) {
    return 'RELEASE|source=' + _str_(entry.sourceSetAsideId) +
           '|to=' + _str_(entry.destination).replace(/\|/g, '/') +
           '|why=' + _str_(entry.reason).replace(/\|/g, '/');
  }

  /**
   * Decodes it again.
   *
   * Tolerant by design: a human may well edit this cell in the sheet, and a
   * release whose notes have been mangled must still be visible as a release
   * with its amount intact rather than vanishing from the totals. An
   * unparseable payload yields empty strings, not an exception.
   */
  function parseReleaseNotes(notes) {
    var out = { source: '', destination: '', reason: '' };
    var s = _str_(notes);
    if (s.indexOf('RELEASE|') !== 0) return out;
    s.split('|').forEach(function (part) {
      var at = part.indexOf('=');
      if (at === -1) return;
      var k = part.slice(0, at);
      var v = part.slice(at + 1);
      if (k === 'source') out.source = v;
      else if (k === 'to') out.destination = v;
      else if (k === 'why') out.reason = v;
    });
    return out;
  }

  /**
   * What has been released toward a given destination, and whether it covers
   * the expected cost.
   *
   * This is what lets the dashboard say "the advisor's $48,000 is funded by
   * $48,000 of released Q1 reservations" — or, more usefully, "only $35,000
   * has been released, so $13,000 is unfunded".
   *
   * UNFUNDED IS REPORTED, NOT HIDDEN. The config carries expectedAnnualCost so
   * there is something to compare against; without it a $0 set-aside would
   * read as "no money needed" rather than "no money found yet".
   *
   * @param {string} destination    e.g. 'SETASIDE_FC_SENIOR_ADVISOR'
   * @param {Array} releases        from readReleases
   * @param {number} expectedCost   from config
   * @returns {Object}
   */
  function fundingFor(destination, releases, expectedCost) {
    var target = _str_(destination);
    var funded = 0;
    var lines = [];

    (releases || []).forEach(function (r) {
      if (_str_(r.destination) !== target) return;
      funded = round2(funded + r.amount);
      lines.push({
        releaseId: r.releaseId,
        amount: r.amount,
        fromEvent: r.eventName,
        fromSetAsideId: r.sourceSetAsideId,
        reason: r.reason,
        releasedBy: r.releasedBy
      });
    });

    var expected = round2(expectedCost);
    return {
      destination: target,
      expectedCost: expected,
      releasedTotal: funded,
      shortfall: round2(expected - funded) > 0 ? round2(expected - funded) : 0,
      isFullyFunded: funded >= expected,
      releases: lines
    };
  }

  return {
    RELEASABLE_FROM: RELEASABLE_FROM,
    releasableAmount: releasableAmount,
    validateRelease: validateRelease,
    readReleases: readReleases,
    formatReleaseNotes: formatReleaseNotes,
    parseReleaseNotes: parseReleaseNotes,
    fundingFor: fundingFor,
    round2: round2
  };
})();

// Node/CommonJS export for the test suite. Inert in Apps Script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SetAsideRelease;
}

/**
 * Releases money from a reservation and records where it went.
 *
 * ADMIN ONLY. This moves spending authority between budget lines, which is the
 * same class of power as editing an allocation — BudgetAdmin.saveAllocations
 * is gated identically.
 *
 * WRITES A NEW ROW, never edits the source. The source reservation keeps its
 * original amount and its history; the release is a separate record pointing
 * back at it. Reducing the source's Amount in place would make the October
 * plan unrecoverable and leave no trace that a decision was taken.
 *
 * @param {Object} entry { sourceSetAsideId, amount, destination, reason }
 * @returns {Object} successResponse({ releaseId }) | errorResponse
 * @client
 * @editor  Needs an entry object, so call it from a one-line wrapper.
 */
function releaseSetAside(entry) {
  var who = '';
  try {
    who = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return errorResponse('Could not determine the active user.');
  }
  if (!who || !isTravelAdmin(who)) {
    console.warn('releaseSetAside: refused non-admin caller ' + (who || '(none)'));
    return errorResponse('Administrator access is required to release reserved funds.');
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
  } catch (e) {
    // THE LOCK IS LOAD-BEARING HERE, not boilerplate. Two admins releasing
    // from the same reservation at once would both read the same releasable
    // amount, both pass validation, and both write — the exact double-release
    // the validator exists to prevent, defeated by timing.
    return errorResponse('Another budget edit is in progress. Try again in a moment.');
  }

  try {
    var db = new TravelDB();
    var all = Events.readSetAsides(db);
    var drawdown = Events.computeDrawdown(db, all);

    // Enrich with consumption, so releasableAmount can subtract travel that
    // has already drawn on the reservation.
    var enriched = all.map(function (sa) {
      var d = drawdown[sa.setAsideId] || { consumed: 0 };
      var copy = {};
      Object.keys(sa).forEach(function (k) { copy[k] = sa[k]; });
      copy.consumedAmount = SetAsideRelease.round2(d.consumed);
      return copy;
    });

    var source = null;
    var wanted = String((entry && entry.sourceSetAsideId) || '').trim();
    for (var i = 0; i < enriched.length; i++) {
      if (enriched[i].setAsideId === wanted) { source = enriched[i]; break; }
    }

    var releases = SetAsideRelease.readReleases(enriched);
    var problems = SetAsideRelease.validateRelease(entry || {}, source, releases);
    if (problems.length) return { success: false, problems: problems };

    var sheet = db.sheet(SHEET_NAMES.EVENT_SET_ASIDES);
    if (!sheet) {
      return errorResponse(SHEET_NAMES.EVENT_SET_ASIDES + ' tab not found. ' +
                           'Run setupTravelDatabase() first.');
    }

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.EVENT_SET_ASIDES];
    var now = new Date();
    var amount = SetAsideRelease.round2(entry.amount);

    var rec = {
      'Set_Aside_ID': 'rel_' + Date.now() + '_' +
                      Math.random().toString(36).substr(2, 4),
      // The release inherits the SOURCE's event identity, so the row reads as
      // "money that was reserved for this event" rather than as a reservation
      // for a new one.
      'Event_ID': source.eventId,
      'Event_Name': source.eventName,
      'Event_Month': source.eventMonth,
      'Fiscal_Year': source.fiscalYear,
      'Org_Code': source.orgCode,
      'Office_Code': source.officeCode,
      'Planned_Travelers': 0,
      'Amount': amount,
      'Basis': 'Released from ' + source.setAsideId,
      'Status': 'RELEASED',
      // Blank for the same reason saveEventSetAside leaves them blank:
      // consumption is COMPUTED from approved requests by
      // Events.computeDrawdown. A stored copy would drift.
      'Consumed_Amount': '',
      'Linked_Request_IDs': '',
      'Notes': SetAsideRelease.formatReleaseNotes({
        sourceSetAsideId: source.setAsideId,
        destination: entry.destination,
        reason: entry.reason
      }),
      'Created_By': who,
      'Created_At': now,
      'Updated_By': who,
      'Updated_At': now
    };

    // Mapped over the schema headers, never built by hand: writes are
    // positional (docs/DATA_DICTIONARY.md §3.9).
    var row = headers.map(function (h) { return h in rec ? rec[h] : ''; });
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);

    try { db.invalidate(SHEET_NAMES.EVENT_SET_ASIDES); } catch (ce) { /* non-fatal */ }

    console.log('releaseSetAside: ' + who + ' released $' + amount.toFixed(2) +
                ' from ' + source.setAsideId + ' (' + source.eventName +
                ') to ' + entry.destination);

    return successResponse(
      { releaseId: rec.Set_Aside_ID, amount: amount },
      'Released $' + amount.toFixed(2) + ' from ' + source.eventName + '.');
  } catch (err) {
    console.error('releaseSetAside failed: ' + err.message);
    return errorResponse('Could not release the reservation: ' + err.message);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* already released */ }
  }
}
