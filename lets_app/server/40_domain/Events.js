/**
 * Events.js
 * The event catalog, traveler proposals, and DAC set-asides.
 *
 * WHAT THIS SOLVES
 * ----------------
 * @clolry, two requirements that turned out to be one feature:
 *
 *   "there are at least 4 highly attended conferences that I know the DACs
 *    will want to send people to so we need a way to setaside budget for
 *    those events so 'routine' travel doesn't eat up all the funds first."
 *
 *   "perhaps we build a way for the admin to define events on the back end
 *    first and then people select the event from a list - it could pre-fill
 *    dates, location, etc."
 *
 * A set-aside has to reserve money for a specific thing. Without a catalog
 * that thing is a string a DAC typed, and matching requests against it is
 * fuzzy name comparison — the same problem the Go.gov reconciliation has, for
 * the same reason. With a catalog the link is an ID and the draw-down is
 * exact.
 *
 * THE THREE-WAY RELATIONSHIP
 * --------------------------
 *   Events            a cataloged occurrence: NCMA World Congress, Jul 2027
 *   Event_Set_Asides  a DAC reserves $40,000 of IDV's budget for it
 *   Requests          a traveler selects it; their estimate draws the
 *                     reservation down
 *
 * WHY A SET-ASIDE MAY STILL NAME A BARE STRING
 * --------------------------------------------
 * Requiring a catalog entry first would mean a DAC cannot reserve money at
 * the moment they are doing annual planning — which is the moment it matters.
 * So Event_Set_Asides accepts either an Event_ID or a free-text name, and the
 * ID is the better path rather than the only one.
 *
 * WHY A TRAVELER CANNOT WRITE TO THE CATALOG
 * ---------------------------------------------
 * @clolry: "We need a way for a traveler to define an 'other' and then let
 * the back-end coordinator add that event."
 *
 * A traveler's "Other" lands in Event_Proposals, a separate tab. Not a
 * PROPOSED row in Events — if proposals lived there, every picker query would
 * have to remember to filter them, and one forgotten filter would show
 * unvetted free text to every other traveler. A separate tab means the
 * picker CANNOT see a proposal.
 *
 * The request is submittable immediately, carrying the proposal ID. Blocking
 * submission until a coordinator acts would be the obvious alternative and
 * would be wrong: nobody should wait on a coordinator to file a request with
 * a deadline.
 */

var Events = (function () {

  function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
  function _str_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

  /** Lowercase alphanumeric slug, for a stable series key. */
  function slugify(name) {
    return _str_(name).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  /**
   * Fiscal year for a YYYY-MM-DD date. October through September.
   *
   * @clolry, repeatedly: "our fiscal year is 10/1 through 9/30 so budgeting
   * all resets on 10/1." An event on 2 October 2026 consumes FY2027 money, so
   * a set-aside for it belongs to FY2027.
   */
  function fiscalYearOf(dateStr) {
    var s = _str_(dateStr);
    if (!/^\d{4}-\d{2}/.test(s)) return '';
    var y = parseInt(s.slice(0, 4), 10);
    var mo = parseInt(s.slice(5, 7), 10);
    if (mo < 1 || mo > 12) return '';
    return 'FY' + (mo >= 10 ? y + 1 : y);
  }

  function monthOf(dateStr) {
    var s = _str_(dateStr);
    return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '';
  }

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

  /** Sheets checkbox or typed word, defaulting as given. */
  function _bool_(v, dflt) {
    if (v === '' || v === null || v === undefined) return dflt === true;
    if (typeof v === 'boolean') return v;
    var s = String(v).trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === 'y' || s === '1';
  }

  // ==========================================================================
  // READS
  // ==========================================================================

  /**
   * Every catalog event.
   *
   * Reads BY HEADER NAME. Eighteen places in LETS read positionally and a
   * column insertion silently misfiles them (finding G-014); this is not a
   * nineteenth.
   */
  function readEvents(db) {
    var data;
    try {
      data = db.readSheet(SHEET_NAMES.EVENTS);
    } catch (e) {
      console.warn('Events: could not read ' + SHEET_NAMES.EVENTS + ': ' + e.message);
      return [];
    }
    if (!data || !data.headers.length) return [];
    var i = data.headerIndex;
    var col = function (n) { return (n in i) ? i[n] : -1; };
    var g = function (row, n) { var c = col(n); return c > -1 ? row[c] : ''; };

    var out = [];
    data.rows.forEach(function (row) {
      var id = _str_(g(row, 'Event_ID'));
      if (!id) return;
      if (!_bool_(g(row, 'Is_Active'), true)) return;
      out.push({
        eventId: id,
        seriesKey: _str_(g(row, 'Series_Key')),
        eventName: _str_(g(row, 'Event_Name')),
        eventMonth: _str_(g(row, 'Event_Month')),
        startDate: toDateString(g(row, 'Start_Date')),
        endDate: toDateString(g(row, 'End_Date')),
        fiscalYear: _str_(g(row, 'Fiscal_Year')),
        locationCity: _str_(g(row, 'Location_City')),
        locationState: _str_(g(row, 'Location_State')),
        locationVenue: _str_(g(row, 'Location_Venue')),
        isVirtual: _bool_(g(row, 'Is_Virtual'), false),
        isLocal: _bool_(g(row, 'Is_Local'), false),
        defaultPurpose: _str_(g(row, 'Default_Purpose')),
        registrationCost: round2(g(row, 'Registration_Cost')),
        registrationWaivedFor: _str_(g(row, 'Registration_Waived_For')),
        mealsProvided: _str_(g(row, 'Meals_Provided')),
        requiresSpecialForm: _bool_(g(row, 'Requires_Special_Form'), false),
        specialFormNotes: _str_(g(row, 'Special_Form_Notes')),
        sponsorOrg: _str_(g(row, 'Sponsor_Org')),
        expectedAttendees: parseInt(g(row, 'Expected_Attendees'), 10) || 0,
        status: _str_(g(row, 'Status')) || 'OPEN',
        historicalEventName: _str_(g(row, 'Historical_Event_Name')),
        proposedBy: _str_(g(row, 'Proposed_By')),
        proposalId: _str_(g(row, 'Proposal_ID')),
        notes: _str_(g(row, 'Notes'))
      });
    });

    // Soonest first. A picker ordered by insertion would put last year's
    // events above next month's.
    out.sort(function (a, b) {
      if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
      return a.eventName.localeCompare(b.eventName);
    });
    return out;
  }

  /** Every set-aside row. */
  function readSetAsides(db) {
    var data;
    try {
      data = db.readSheet(SHEET_NAMES.EVENT_SET_ASIDES);
    } catch (e) {
      console.warn('Events: could not read set-asides: ' + e.message);
      return [];
    }
    if (!data || !data.headers.length) return [];
    var i = data.headerIndex;
    var g = function (row, n) { return (n in i) ? row[i[n]] : ''; };

    var out = [];
    data.rows.forEach(function (row) {
      var id = _str_(g(row, 'Set_Aside_ID'));
      if (!id) return;
      var status = _str_(g(row, 'Status')) || 'PLANNED';
      out.push({
        setAsideId: id,
        eventId: _str_(g(row, 'Event_ID')),
        eventName: _str_(g(row, 'Event_Name')),
        eventMonth: _str_(g(row, 'Event_Month')),
        fiscalYear: _str_(g(row, 'Fiscal_Year')),
        orgCode: _str_(g(row, 'Org_Code')).toUpperCase(),
        officeCode: _str_(g(row, 'Office_Code')).toUpperCase(),
        plannedTravelers: parseInt(g(row, 'Planned_Travelers'), 10) || 0,
        amount: round2(g(row, 'Amount')),
        basis: _str_(g(row, 'Basis')),
        status: status,
        consumedAmount: round2(g(row, 'Consumed_Amount')),
        linkedRequestIds: _str_(g(row, 'Linked_Request_IDs'))
          .split(',').map(_str_).filter(Boolean),
        notes: _str_(g(row, 'Notes')),
        createdBy: _str_(g(row, 'Created_By'))
      });
    });
    return out;
  }

  /** Pending traveler proposals. */
  function readProposals(db, includeResolved) {
    var data;
    try {
      data = db.readSheet(SHEET_NAMES.EVENT_PROPOSALS);
    } catch (e) {
      console.warn('Events: could not read proposals: ' + e.message);
      return [];
    }
    if (!data || !data.headers.length) return [];
    var i = data.headerIndex;
    var g = function (row, n) { return (n in i) ? row[i[n]] : ''; };

    var out = [];
    data.rows.forEach(function (row) {
      var id = _str_(g(row, 'Proposal_ID'));
      if (!id) return;
      var status = _str_(g(row, 'Status')) || 'PENDING';
      if (!includeResolved && status !== 'PENDING') return;
      out.push({
        proposalId: id,
        proposedEventName: _str_(g(row, 'Proposed_Event_Name')),
        proposedStartDate: toDateString(g(row, 'Proposed_Start_Date')),
        proposedEndDate: toDateString(g(row, 'Proposed_End_Date')),
        proposedLocation: _str_(g(row, 'Proposed_Location')),
        proposedPurpose: _str_(g(row, 'Proposed_Purpose')),
        notes: _str_(g(row, 'Notes')),
        requestId: _str_(g(row, 'Request_ID')),
        proposedBy: _str_(g(row, 'Proposed_By')),
        proposedAt: toDateString(g(row, 'Proposed_At')),
        status: status,
        resolvedEventId: _str_(g(row, 'Resolved_Event_ID')),
        resolutionNotes: _str_(g(row, 'Resolution_Notes'))
      });
    });
    return out;
  }

  // ==========================================================================
  // DRAW-DOWN
  // ==========================================================================

  /**
   * How much of each set-aside has been consumed by approved requests.
   *
   * COMPUTED, NOT STORED. The schema has a Consumed_Amount column, and it is
   * deliberately NOT the source of truth here.
   *
   * A stored running total has to be updated on every approval, denial,
   * cancellation and amendment. Miss one and the figure drifts, silently and
   * permanently — and a drifted reservation is worse than none, because a DAC
   * trusts it. Recomputing from the requests is slower and cannot drift.
   *
   * WHICH REQUESTS COUNT
   * --------------------
   * Anything not denied or cancelled. A pending request has not been approved,
   * but the money is promised — and a reservation that only counts approvals
   * would let a DAC reserve for ten people, raise twelve requests, and see
   * the reservation as untouched until the first approval landed.
   *
   * @param {Object} db
   * @param {Array<Object>} setAsides
   * @returns {Object} setAsideId -> { consumed, requestIds, travelerCount }
   */
  function computeDrawdown(db, setAsides) {
    var out = {};
    (setAsides || []).forEach(function (sa) {
      out[sa.setAsideId] = { consumed: 0, requestIds: [], travelerCount: 0 };
    });
    if (!setAsides || !setAsides.length) return out;

    var data;
    try {
      data = db.readSheet(SHEET_NAMES.REQUESTS);
    } catch (e) {
      console.warn('Events: could not read Requests for drawdown: ' + e.message);
      return out;
    }
    if (!data || !data.headers.length) return out;

    var i = data.headerIndex;
    var g = function (row, n) { return (n in i) ? row[i[n]] : ''; };

    // Statuses that consume nothing. Everything else does — see above.
    var DEAD = ['DENIED', 'CANCELLED', 'SUBMITTER_CANCELLED', 'DRAFT', 'WITHDRAWN'];

    data.rows.forEach(function (row) {
      var status = _str_(g(row, 'Status')).toUpperCase();
      if (DEAD.indexOf(status) > -1) return;

      var reqId = _str_(g(row, 'Request_ID'));
      var eventId = _str_(g(row, 'Event_ID'));
      var office = _str_(g(row, 'Owning_Office')).toUpperCase();
      var total = round2(g(row, 'Grand_Total'));
      var travelers = parseInt(g(row, 'Traveler_Count'), 10) || 0;
      var tripName = _str_(g(row, 'Trip_Name'));
      var startMonth = monthOf(toDateString(g(row, 'Event_Start_Date')));

      setAsides.forEach(function (sa) {
        if (sa.status === 'RELEASED' || sa.status === 'EXPIRED') return;
        // The office must match: a reservation belongs to one DAC's budget.
        if (sa.officeCode && office && sa.officeCode !== office) return;

        var hit = false;
        if (sa.eventId && eventId && sa.eventId === eventId) {
          // EXACT. This is why the catalog exists.
          hit = true;
        } else if (!sa.eventId && sa.eventName && tripName) {
          // Free-text fallback: same name, same month. Deliberately strict —
          // a looser rule would draw down the wrong reservation, and an
          // over-consumed reservation reads as "no money left" to a DAC.
          hit = _str_(sa.eventName).toLowerCase() === tripName.toLowerCase() &&
                (!sa.eventMonth || sa.eventMonth === startMonth);
        }
        if (!hit) return;

        out[sa.setAsideId].consumed = round2(out[sa.setAsideId].consumed + total);
        out[sa.setAsideId].travelerCount += travelers;
        if (reqId) out[sa.setAsideId].requestIds.push(reqId);
      });
    });

    return out;
  }

  // ==========================================================================
  // PUBLIC READ
  // ==========================================================================

  /**
   * The catalog, the set-asides with live draw-down, and pending proposals.
   *
   * @param {Object} [options] { fiscalYear, includePast }
   * @returns {Object}
   */
  function getEventPlanning(options) {
    options = options || {};
    try {
      var db = new TravelDB();
      var events = readEvents(db);
      var setAsides = readSetAsides(db);
      var drawdown = computeDrawdown(db, setAsides);

      var fy = options.fiscalYear || '';
      if (fy) {
        events = events.filter(function (e) { return !e.fiscalYear || e.fiscalYear === fy; });
        setAsides = setAsides.filter(function (s) { return !s.fiscalYear || s.fiscalYear === fy; });
      }

      var byId = {};
      events.forEach(function (e) { byId[e.eventId] = e; });

      var enriched = setAsides.map(function (sa) {
        var d = drawdown[sa.setAsideId] || { consumed: 0, requestIds: [], travelerCount: 0 };
        var remaining = round2(sa.amount - d.consumed);
        return {
          setAsideId: sa.setAsideId,
          eventId: sa.eventId,
          // The catalog name wins when linked, so renaming an event does
          // not leave a stale label on the reservation.
          eventName: (sa.eventId && byId[sa.eventId])
            ? byId[sa.eventId].eventName : sa.eventName,
          eventMonth: (sa.eventId && byId[sa.eventId])
            ? byId[sa.eventId].eventMonth : sa.eventMonth,
          isCataloged: !!(sa.eventId && byId[sa.eventId]),
          fiscalYear: sa.fiscalYear,
          orgCode: sa.orgCode,
          officeCode: sa.officeCode,
          plannedTravelers: sa.plannedTravelers,
          amount: sa.amount,
          basis: sa.basis,
          status: sa.status,
          notes: sa.notes,
          createdBy: sa.createdBy,

          // Live figures, recomputed every read.
          consumed: d.consumed,
          remaining: remaining,
          actualTravelers: d.travelerCount,
          linkedRequestIds: d.requestIds,
          utilizationPct: sa.amount > 0
            ? Math.round((d.consumed / sa.amount) * 1000) / 10 : null,
          // Flagged rather than clamped. A reservation consumed beyond its
          // amount is a real condition a DAC needs to see, and clamping it to
          // zero remaining would hide the overrun.
          isOverCommitted: remaining < 0,
          // Said explicitly: a DAC reserved for 10 and 14 are going.
          travelerVariance: sa.plannedTravelers
            ? d.travelerCount - sa.plannedTravelers : null
        };
      });

      var totals = {
        reserved: round2(enriched.reduce(function (s, x) { return s + x.amount; }, 0)),
        consumed: round2(enriched.reduce(function (s, x) { return s + x.consumed; }, 0)),
        remaining: round2(enriched.reduce(function (s, x) { return s + x.remaining; }, 0)),
        overCommittedCount: enriched.filter(function (x) { return x.isOverCommitted; }).length
      };

      var byOffice = {};
      enriched.forEach(function (x) {
        if (!x.officeCode) return;
        if (!byOffice[x.officeCode]) {
          byOffice[x.officeCode] = { reserved: 0, consumed: 0, remaining: 0, count: 0 };
        }
        byOffice[x.officeCode].reserved = round2(byOffice[x.officeCode].reserved + x.amount);
        byOffice[x.officeCode].consumed = round2(byOffice[x.officeCode].consumed + x.consumed);
        byOffice[x.officeCode].remaining = round2(byOffice[x.officeCode].remaining + x.remaining);
        byOffice[x.officeCode].count++;
      });

      return successResponse({
        events: events,
        setAsides: enriched,
        proposals: readProposals(db, false),
        totals: totals,
        byOffice: byOffice,
        meta: {
          fiscalYear: fy,
          // Stated so the UI does not imply a stored figure.
          drawdownNote: 'Consumed figures are recomputed from live requests on ' +
                        'every read, not stored. A stored running total would ' +
                        'drift silently on a missed cancellation.',
          countsNote: 'A reservation is consumed by any request that is not ' +
                      'denied, cancelled or draft — pending travel is promised ' +
                      'money, not available money.'
        }
      });
    } catch (e) {
      console.error('getEventPlanning failed: ' + e.message);
      return errorResponse('Could not load event planning: ' + e.message);
    }
  }

  /**
   * Catalog events a traveler may select, newest-relevant first.
   *
   * Excludes CLOSED and CANCELLED, and anything that has already finished —
   * a picker offering last year's conference invites a misfiled request.
   *
   * @param {Object} [options] { asOf }
   */
  function getSelectableEvents(options) {
    options = options || {};
    try {
      var db = new TravelDB();
      var today = options.asOf || toDateString(new Date());
      var events = readEvents(db).filter(function (e) {
        if (e.status === 'CLOSED' || e.status === 'CANCELLED') return false;
        // An event with no end date stays selectable: a half-entered
        // catalog row should not vanish from the picker without explanation.
        if (e.endDate && e.endDate < today) return false;
        return true;
      });
      return successResponse({ events: events, asOf: today });
    } catch (e) {
      console.error('getSelectableEvents failed: ' + e.message);
      return errorResponse('Could not load events: ' + e.message);
    }
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  function validateEvent(ev) {
    var problems = [];
    var e = ev || {};

    if (!_str_(e.eventName)) problems.push('Event name is required.');
    if (_str_(e.eventName).length > 120) problems.push('Event name is too long.');

    var start = toDateString(e.startDate);
    var end = toDateString(e.endDate);
    if (!start) problems.push('Start date is required and must be a real date.');
    if (!end) problems.push('End date is required and must be a real date.');
    if (start && end && end < start) {
      problems.push('End date ' + end + ' is before the start date ' + start + '.');
    }

    // A virtual event with a city is contradictory, and the city would flow
    // into per-diem logic.
    if (_bool_(e.isVirtual, false) && _str_(e.locationCity)) {
      problems.push('A virtual event should not have a location city.');
    }
    if (!_bool_(e.isVirtual, false) && !_str_(e.locationCity)) {
      problems.push('Location city is required for an in-person event — ' +
                    'per-diem rates depend on it.');
    }

    var reg = Number(e.registrationCost);
    if (e.registrationCost !== '' && e.registrationCost !== null &&
        e.registrationCost !== undefined) {
      if (isNaN(reg)) problems.push('Registration cost is not a number.');
      else if (reg < 0) problems.push('Registration cost cannot be negative.');
      else if (reg > 50000) problems.push('Registration cost $' +
        reg.toLocaleString() + ' looks like a typo.');
    }

    return problems;
  }

  function validateSetAside(sa, events) {
    var problems = [];
    var s = sa || {};

    // EITHER an event or a name. Both blank means the reservation reserves
    // money for nothing identifiable, and nothing could ever draw it down.
    var hasEvent = !!_str_(s.eventId);
    var hasName = !!_str_(s.eventName);
    if (!hasEvent && !hasName) {
      problems.push('Choose a cataloged event, or type an event name.');
    }
    if (hasEvent && events) {
      var found = events.some(function (e) { return e.eventId === _str_(s.eventId); });
      if (!found) problems.push('Event "' + s.eventId + '" is not in the catalog.');
    }
    // A free-text reservation needs a month, or the draw-down has nothing to
    // disambiguate a recurring conference by.
    if (!hasEvent && hasName && !/^\d{4}-\d{2}$/.test(_str_(s.eventMonth))) {
      problems.push('A typed event name needs a month (YYYY-MM) so the right ' +
                    'trips draw it down.');
    }

    var office = _str_(s.officeCode).toUpperCase();
    var known = ['FO', 'OMD', 'IDV', 'CM'];
    if (!office) problems.push('Office is required — a reservation belongs to one budget.');
    else if (known.indexOf(office) === -1) {
      problems.push('Office "' + office + '" is not one of ' + known.join(', ') + '.');
    }

    // A blank amount is not zero. Reserving nothing is a real but deliberate
    // act.
    if (s.amount === '' || s.amount === null || s.amount === undefined) {
      problems.push('Amount is required. To reserve nothing, enter 0.');
    } else {
      var amt = Number(s.amount);
      if (isNaN(amt)) problems.push('Amount "' + s.amount + '" is not a number.');
      else if (amt < 0) problems.push('Amount cannot be negative.');
      else if (amt > 10000000) problems.push('Amount $' + amt.toLocaleString() +
        ' looks like a typo.');
    }

    var fy = _str_(s.fiscalYear);
    if (!fy) problems.push('Fiscal year is required.');
    else if (!/^FY\d{4}$/.test(fy)) problems.push('Fiscal year must look like FY2027.');

    var n = parseInt(s.plannedTravelers, 10);
    if (s.plannedTravelers !== '' && s.plannedTravelers !== null &&
        s.plannedTravelers !== undefined) {
      if (isNaN(n) || n < 0) problems.push('Planned travelers must be a whole number.');
      else if (n > 500) problems.push(n + ' travelers looks like a typo.');
    }

    // The basis is how the amount was arrived at. Required for the same
    // reason a budget change needs a reason: in six months this row is the
    // only record of the reasoning.
    if (!_str_(s.basis)) {
      problems.push('Record how you arrived at the amount — e.g. "10 travelers ' +
                    'x $2,400 + $500 registration".');
    }

    return problems;
  }

  return {
    getEventPlanning: getEventPlanning,
    getSelectableEvents: getSelectableEvents,
    readEvents: readEvents,
    readSetAsides: readSetAsides,
    readProposals: readProposals,
    computeDrawdown: computeDrawdown,
    validateEvent: validateEvent,
    validateSetAside: validateSetAside,
    fiscalYearOf: fiscalYearOf,
    monthOf: monthOf,
    toDateString: toDateString,
    slugify: slugify,
    round2: round2
  };
})();

// ============================================================================
// BROWSER ENTRY POINTS
// ============================================================================
//
// Top-level declarations: Apps Script exposes only these to google.script.run.
// Finding G-016 is this trap — the whole LETS budget layer is an IIFE
// assigning to `root`, and is therefore unreachable.

/**
 * Catalog events a traveler may pick from.
 *
 * OPEN to any signed-in user, because the travel form needs it. An event name,
 * its dates and its venue are not sensitive — they are published by the
 * conference organizer.
 *
 * @returns {Object}
 * @client
 */
function getTravelEvents() {
  return Events.getSelectableEvents();
}

/**
 * The planning view: catalog, set-asides with live draw-down, and pending
 * proposals.
 *
 * OPEN, consistent with the rest of the budget surface. @clolry: "budgeting
 * info can be available to users at this point - no secrets to hide there -
 * we're trying to develop transparency."
 *
 * NAMED getTravelEventPlanning, not getEventPlanning. The IIFE already has an
 * internal getEventPlanning, and a global of the same name reads as infinite
 * recursion to anyone skimming it — it is not, because the closure wins
 * inside, but a reader should not have to work that out.
 *
 * @param {string} [fiscalYear]
 * @returns {Object}
 * @client
 */
function getTravelEventPlanning(fiscalYear) {
  return Events.getEventPlanning({ fiscalYear: fiscalYear || '' });
}

/**
 * Records a traveler's "Other" event.
 *
 * OPEN to any signed-in user, deliberately. @clolry: "We need a way for a
 * traveler to define an 'other'."
 *
 * It writes to Event_Proposals, NOT to the catalog — so a traveler cannot
 * put unvetted text in front of every other traveler. A coordinator promotes
 * it later.
 *
 * @param {Object} proposal
 * @returns {Object} successResponse({ proposalId })
 * @client
 */
function proposeTravelEvent(proposal) {
  var p = proposal || {};
  var who = '';
  try {
    who = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return errorResponse('Could not determine the active user.');
  }
  if (!who) return errorResponse('Could not determine the active user.');

  var name = String(p.proposedEventName || '').trim();
  if (!name) return errorResponse('An event name is required.');
  if (name.length > 160) return errorResponse('That event name is too long.');

  try {
    var db = new TravelDB();
    var sheet = db.sheet(SHEET_NAMES.EVENT_PROPOSALS);
    if (!sheet) {
      return errorResponse(SHEET_NAMES.EVENT_PROPOSALS + ' tab not found. ' +
                           'Run setupTravelDatabase() first.');
    }

    // Duplicate proposals are EXPECTED, not an error: twelve people wanting
    // the same conference is exactly @clolry's scenario. Reported so the
    // coordinator can merge rather than create twelve events, and so the
    // traveler is not told they did something wrong.
    var existing = Events.readProposals(db, true);
    var nameLower = name.toLowerCase();
    var similar = existing.filter(function (x) {
      return String(x.proposedEventName || '').toLowerCase() === nameLower;
    });

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.EVENT_PROPOSALS];
    var id = 'prop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    var rec = {
      'Proposal_ID': id,
      'Proposed_Event_Name': name,
      'Proposed_Start_Date': Events.toDateString(p.proposedStartDate),
      'Proposed_End_Date': Events.toDateString(p.proposedEndDate),
      'Proposed_Location': String(p.proposedLocation || '').trim(),
      'Proposed_Purpose': String(p.proposedPurpose || '').trim(),
      'Notes': String(p.notes || '').trim(),
      'Request_ID': String(p.requestId || '').trim(),
      'Proposed_By': who,
      'Proposed_At': new Date(),
      'Status': 'PENDING'
    };
    // Mapped over the schema headers, never built by hand: writes are
    // positional (docs/DATA_DICTIONARY.md §3.9).
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length)
      .setValues([headers.map(function (h) { return h in rec ? rec[h] : ''; })]);

    try { db.invalidate(SHEET_NAMES.EVENT_PROPOSALS); } catch (e) { /* non-fatal */ }

    return successResponse({
      proposalId: id,
      alreadyProposedCount: similar.length,
      // The traveler sees this, so it has to read as information rather than
      // a rejection.
      message: similar.length
        ? 'Recorded. ' + similar.length + ' other request(s) have already ' +
          'proposed this event, so a coordinator will link them together.'
        : 'Recorded. A coordinator will add this event and link your request to it.'
    });
  } catch (e) {
    console.error('proposeTravelEvent failed: ' + e.message);
    return errorResponse('Could not record the event: ' + e.message);
  }
}

/**
 * Creates or updates a catalog event. ADMIN ONLY.
 *
 * A traveler cannot reach this — the catalog is what every other traveler
 * picks from, so unvetted text in it is a problem for everyone. Travelers use
 * proposeTravelEvent instead.
 *
 * @param {Object} ev
 * @returns {Object}
 * @client
 */
function saveTravelEvent(ev) {
  var who = '';
  try {
    who = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return errorResponse('Could not determine the active user.');
  }
  // COORDINATOR OR ADMIN. Defining an event is workflow, not money: it
  // creates something travelers can pick from and reserves nothing. The
  // set-aside editor below stays admin-only because that commits budget.
  if (!who || !isTravelCoordinator(who)) {
    console.warn('saveTravelEvent: refused caller ' + (who || '(none)'));
    return errorResponse('Coordinator or administrator access is required to define events.');
  }

  var e = ev || {};
  var problems = Events.validateEvent(e);
  if (problems.length) return { success: false, problems: problems };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
  } catch (lockErr) {
    return errorResponse('Another event edit is in progress. Try again in a moment.');
  }

  try {
    var db = new TravelDB();
    var sheet = db.sheet(SHEET_NAMES.EVENTS);
    if (!sheet) {
      return errorResponse(SHEET_NAMES.EVENTS + ' tab not found. ' +
                           'Run setupTravelDatabase() first.');
    }

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.EVENTS];
    var start = Events.toDateString(e.startDate);
    var now = new Date();
    var existingId = String(e.eventId || '').trim();

    // Derived, not supplied. A caller-supplied fiscal year or month could
    // disagree with the dates, and the set-aside draw-down matches on month.
    var month = Events.monthOf(start);
    var fy = Events.fiscalYearOf(start);
    var series = Events.slugify(e.seriesKey || e.eventName);

    var rec = {
      'Event_ID': existingId ||
        ('evt_' + series + '_' + month.replace('-', '') + '_' +
         Math.random().toString(36).substr(2, 4)),
      'Series_Key': series,
      'Event_Name': String(e.eventName).trim(),
      'Event_Month': month,
      'Start_Date': start,
      'End_Date': Events.toDateString(e.endDate),
      'Fiscal_Year': fy,
      'Location_City': String(e.locationCity || '').trim(),
      'Location_State': String(e.locationState || '').trim().toUpperCase(),
      'Location_Venue': String(e.locationVenue || '').trim(),
      'Is_Virtual': !!e.isVirtual,
      'Is_Local': !!e.isLocal,
      'Default_Purpose': String(e.defaultPurpose || '').trim(),
      'Registration_Cost': Events.round2(e.registrationCost),
      // Free text rather than a flag. @clolry raised speakers getting
      // attendance waived; "speakers" is one case and there will be others
      // (sponsors, hosts, panel chairs) that a boolean cannot express.
      'Registration_Waived_For': String(e.registrationWaivedFor || '').trim(),
      // Likewise. "Lunch days 1-2, breakfast day 3" is the real shape of
      // this, and it drives an M&IE deduction a reviewer has to check.
      'Meals_Provided': String(e.mealsProvided || '').trim(),
      'Requires_Special_Form': !!e.requiresSpecialForm,
      'Special_Form_Notes': String(e.specialFormNotes || '').trim(),
      'Sponsor_Org': String(e.sponsorOrg || '').trim(),
      'Expected_Attendees': parseInt(e.expectedAttendees, 10) || 0,
      'Status': String(e.status || 'OPEN').toUpperCase(),
      'Historical_Event_Name': String(e.historicalEventName || '').trim(),
      'Proposed_By': String(e.proposedBy || '').trim(),
      'Proposal_ID': String(e.proposalId || '').trim(),
      'Notes': String(e.notes || '').trim(),
      'Is_Active': e.isActive === false ? false : true,
      'Created_By': String(e.createdBy || who),
      'Created_At': e.createdAt ? new Date(e.createdAt) : now,
      'Updated_By': who,
      'Updated_At': now
    };
    var row = headers.map(function (h) { return h in rec ? rec[h] : ''; });

    // Update in place when the ID exists; append otherwise. An event is
    // edited rather than versioned, unlike a budget allocation — nothing
    // downstream depends on what an event's venue USED to be.
    var target = -1;
    if (existingId) {
      var data = db.readSheet(SHEET_NAMES.EVENTS);
      var idx = data.headerIndex['Event_ID'];
      for (var i = 0; i < data.rows.length; i++) {
        if (String(data.rows[i][idx]) === existingId) { target = i + 2; break; }
      }
      if (target === -1) {
        return errorResponse('Event ' + existingId + ' not found.');
      }
    }

    if (target > -1) {
      sheet.getRange(target, 1, 1, headers.length).setValues([row]);
    } else {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
    }

    try { db.invalidate(SHEET_NAMES.EVENTS); } catch (ce) { /* non-fatal */ }

    return successResponse({ eventId: rec.Event_ID, updated: target > -1 },
      target > -1 ? 'Event updated.' : 'Event created.');
  } catch (err) {
    console.error('saveTravelEvent failed: ' + err.message);
    return errorResponse('Could not save the event: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Creates or updates a DAC set-aside. ADMIN ONLY.
 *
 * @clolry: "if the FCB DAC knows that they want to send 10 people to a
 * conference next May then I want to give her a way to setaside the funds so
 * they don't get spent on something else or forgotten."
 *
 * Consumed_Amount is NOT written here. It is recomputed from live requests on
 * every read — a stored running total drifts on a missed cancellation, and a
 * drifted reservation is worse than none because a DAC trusts it.
 *
 * @param {Object} sa
 * @returns {Object}
 * @client
 */
function saveEventSetAside(sa) {
  var who = '';
  try {
    who = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return errorResponse('Could not determine the active user.');
  }
  // ADMIN ONLY, deliberately — NOT coordinator.
  //
  // This commits money. A coordinator may define the event and link requests
  // to it, but reserving a DAC's budget against it is a budget decision, and
  // the whole point of the coordinator role is that it carries workflow
  // powers without money powers.
  if (!who || !isTravelAdmin(who)) {
    console.warn('saveEventSetAside: refused non-admin caller ' + (who || '(none)'));
    return errorResponse('Administrator access is required to reserve budget.');
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
  } catch (lockErr) {
    return errorResponse('Another budget edit is in progress. Try again in a moment.');
  }

  try {
    var db = new TravelDB();
    var events = Events.readEvents(db);
    var problems = Events.validateSetAside(sa || {}, events);
    if (problems.length) return { success: false, problems: problems };

    var sheet = db.sheet(SHEET_NAMES.EVENT_SET_ASIDES);
    if (!sheet) {
      return errorResponse(SHEET_NAMES.EVENT_SET_ASIDES + ' tab not found. ' +
                           'Run setupTravelDatabase() first.');
    }

    var s = sa;
    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.EVENT_SET_ASIDES];
    var now = new Date();
    var existingId = String(s.setAsideId || '').trim();

    // When linked to a catalog event, the month and fiscal year come FROM
    // the event. A caller-supplied month that disagreed with it would break
    // the draw-down match silently.
    var linked = null;
    if (s.eventId) {
      for (var i = 0; i < events.length; i++) {
        if (events[i].eventId === String(s.eventId).trim()) { linked = events[i]; break; }
      }
    }

    var ORG_FOR_OFFICE = { FO: 'FC', OMD: 'FCA', IDV: 'FCB', CM: 'FCC' };
    var office = String(s.officeCode).toUpperCase();

    var rec = {
      'Set_Aside_ID': existingId ||
        ('esa_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
      'Event_ID': linked ? linked.eventId : '',
      'Event_Name': linked ? linked.eventName : String(s.eventName || '').trim(),
      'Event_Month': linked ? linked.eventMonth : String(s.eventMonth || '').trim(),
      'Fiscal_Year': linked ? linked.fiscalYear : String(s.fiscalYear || '').trim(),
      'Org_Code': ORG_FOR_OFFICE[office] || '',
      'Office_Code': office,
      'Planned_Travelers': parseInt(s.plannedTravelers, 10) || 0,
      'Amount': Events.round2(s.amount),
      'Basis': String(s.basis || '').trim(),
      'Status': String(s.status || 'PLANNED').toUpperCase(),
      // Deliberately blank. See the note above and Events.computeDrawdown.
      'Consumed_Amount': '',
      'Linked_Request_IDs': '',
      'Notes': String(s.notes || '').trim(),
      'Created_By': String(s.createdBy || who),
      'Created_At': s.createdAt ? new Date(s.createdAt) : now,
      'Updated_By': who,
      'Updated_At': now
    };
    var row = headers.map(function (h) { return h in rec ? rec[h] : ''; });

    var target = -1;
    if (existingId) {
      var data = db.readSheet(SHEET_NAMES.EVENT_SET_ASIDES);
      var idx = data.headerIndex['Set_Aside_ID'];
      for (var j = 0; j < data.rows.length; j++) {
        if (String(data.rows[j][idx]) === existingId) { target = j + 2; break; }
      }
      if (target === -1) return errorResponse('Set-aside ' + existingId + ' not found.');
    }

    if (target > -1) {
      sheet.getRange(target, 1, 1, headers.length).setValues([row]);
    } else {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
    }

    try { db.invalidate(SHEET_NAMES.EVENT_SET_ASIDES); } catch (ce) { /* non-fatal */ }

    console.log('saveEventSetAside: ' + who + ' reserved $' + rec.Amount +
                ' of ' + office + ' for ' + rec.Event_Name);

    return successResponse({ setAsideId: rec.Set_Aside_ID, updated: target > -1 },
      target > -1 ? 'Reservation updated.' : 'Budget reserved.');
  } catch (err) {
    console.error('saveEventSetAside failed: ' + err.message);
    return errorResponse('Could not save the reservation: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Resolves a traveler's event proposal. ADMIN ONLY.
 *
 * @clolry: the coordinator "add[s] that event and then associate[s] the
 * request with that new event (and then allow[s] future travelers to select
 * that event)."
 *
 * Two outcomes, and the difference matters:
 *
 *   PROMOTE  creates a new catalog event from the proposal
 *   MERGE    links the proposal to an event that already exists
 *
 * MERGE is the common case for @clolry's twelve-people-one-conference
 * scenario: the first proposal is promoted and the other eleven are merged
 * into it. Without a distinct MERGE outcome a coordinator would either create
 * twelve duplicate events or reject eleven travelers' proposals, and
 * "rejected" is the wrong word for "someone else already asked".
 *
 * Either way the originating REQUEST is linked to the resulting event, which
 * is what makes the set-aside draw-down work.
 *
 * @param {string} proposalId
 * @param {Object} resolution { action, eventId, event, notes }
 * @returns {Object}
 * @client
 */
function resolveEventProposal(proposalId, resolution) {
  var who = '';
  try {
    who = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return errorResponse('Could not determine the active user.');
  }
  // COORDINATOR OR ADMIN. @clolry: the coordinator "add[s] that event and
  // then associate[s] the request with that new event". This is the function
  // that does it, and it was the main thing a coordinator could not reach.
  if (!who || !isTravelCoordinator(who)) {
    console.warn('resolveEventProposal: refused caller ' + (who || '(none)'));
    return errorResponse('Coordinator or administrator access is required to resolve proposals.');
  }

  var r = resolution || {};
  var action = String(r.action || '').toUpperCase();
  if (['PROMOTE', 'MERGE', 'REJECT'].indexOf(action) === -1) {
    return errorResponse('Action must be PROMOTE, MERGE or REJECT.');
  }
  if (action === 'REJECT' && !String(r.notes || '').trim()) {
    // A traveler asked for something and is being told no. They are owed a
    // reason, and the proposal row is where it lives.
    return errorResponse('A reason is required when rejecting a proposal.');
  }

  try {
    var db = new TravelDB();
    var proposals = Events.readProposals(db, true);
    var prop = null;
    for (var i = 0; i < proposals.length; i++) {
      if (proposals[i].proposalId === proposalId) { prop = proposals[i]; break; }
    }
    if (!prop) return errorResponse('Proposal ' + proposalId + ' not found.');
    if (prop.status !== 'PENDING') {
      return errorResponse('That proposal was already resolved as ' + prop.status + '.');
    }

    var eventId = '';

    if (action === 'PROMOTE') {
      // Build the event from the proposal, with coordinator overrides. The
      // traveler supplied free text; the coordinator supplies the structure.
      var draft = Object.assign({
        eventName: prop.proposedEventName,
        startDate: prop.proposedStartDate,
        endDate: prop.proposedEndDate,
        locationCity: prop.proposedLocation,
        defaultPurpose: prop.proposedPurpose,
        proposedBy: prop.proposedBy,
        proposalId: prop.proposalId
      }, r.event || {});
      var created = saveTravelEvent(draft);
      if (!created.success) return created;
      eventId = created.data.eventId;
    } else if (action === 'MERGE') {
      eventId = String(r.eventId || '').trim();
      if (!eventId) return errorResponse('An event to merge into is required.');
      var events = Events.readEvents(db);
      var exists = events.some(function (e) { return e.eventId === eventId; });
      if (!exists) return errorResponse('Event ' + eventId + ' is not in the catalog.');
    }

    // Stamp the proposal.
    var pdata = db.readSheet(SHEET_NAMES.EVENT_PROPOSALS);
    var pIdx = pdata.headerIndex;
    var pSheet = db.sheet(SHEET_NAMES.EVENT_PROPOSALS);
    var pRow = -1;
    for (var j = 0; j < pdata.rows.length; j++) {
      if (String(pdata.rows[j][pIdx['Proposal_ID']]) === proposalId) { pRow = j + 2; break; }
    }
    if (pRow > -1 && pSheet) {
      var set = function (col, val) {
        if (col in pIdx) pSheet.getRange(pRow, pIdx[col] + 1).setValue(val);
      };
      set('Status', action === 'REJECT' ? 'REJECTED'
            : (action === 'MERGE' ? 'MERGED' : 'PROMOTED'));
      set('Resolved_Event_ID', eventId);
      set('Resolution_Notes', String(r.notes || '').trim());
      set('Resolved_By', who);
      set('Resolved_At', new Date());
    }

    // LINK THE ORIGINATING REQUEST. This is the step that makes the whole
    // thing work: without it the request stays unlinked and never draws down
    // the set-aside, so a DAC's reservation looks untouched while the money
    // is being spent.
    var linkedRequest = false;
    if (eventId && prop.requestId) {
      try {
        var rdata = db.readSheet(SHEET_NAMES.REQUESTS);
        var rIdx = rdata.headerIndex;
        var rSheet = db.sheet(SHEET_NAMES.REQUESTS);
        for (var k = 0; k < rdata.rows.length; k++) {
          if (String(rdata.rows[k][rIdx['Request_ID']]) !== prop.requestId) continue;
          if ('Event_ID' in rIdx && rSheet) {
            rSheet.getRange(k + 2, rIdx['Event_ID'] + 1).setValue(eventId);
            linkedRequest = true;
          }
          break;
        }
        if (linkedRequest) db.invalidate(SHEET_NAMES.REQUESTS);
      } catch (le) {
        // Reported, not swallowed. An unlinked request is the failure mode
        // that makes a reservation silently wrong.
        console.error('resolveEventProposal: could not link request ' +
                      prop.requestId + ': ' + le.message);
      }
    }

    try {
      db.invalidate(SHEET_NAMES.EVENT_PROPOSALS);
      db.invalidate(SHEET_NAMES.EVENTS);
    } catch (ce) { /* non-fatal */ }

    return successResponse({
      proposalId: proposalId,
      action: action,
      eventId: eventId,
      requestLinked: linkedRequest,
      // Surfaced so a coordinator knows to link it by hand rather than
      // assuming it worked.
      requestLinkWarning: (eventId && prop.requestId && !linkedRequest)
        ? 'The event was saved but request ' + prop.requestId +
          ' could not be linked to it. Link it manually, or the reservation ' +
          'will not draw down.'
        : ''
    }, action === 'REJECT' ? 'Proposal rejected.'
        : (action === 'MERGE' ? 'Proposal merged into an existing event.'
                              : 'Event created from the proposal.'));
  } catch (err) {
    console.error('resolveEventProposal failed: ' + err.message);
    return errorResponse('Could not resolve the proposal: ' + err.message);
  }
}
