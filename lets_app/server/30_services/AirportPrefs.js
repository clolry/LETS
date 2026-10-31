/**
 * AirportPrefs.js
 * Learned per-traveler airport preferences.
 *
 * WHY THIS EXISTS
 * ---------------
 * Which airport a traveler uses is a LOGISTICAL constraint, not a cost
 * optimization. @clolry's case: he will only fly into DCA, because Metro
 * access to the office makes the cheaper BWI fare useless to him. Offering the
 * cheapest airport as a default presents options nobody would accept, and
 * invites an approver to ask why the saving was not taken.
 *
 * Much executive travel is repeatable — the same person to the same hub
 * offices — so the airport chosen last time is the best available prediction.
 *
 * HYBRID LEARNING
 * ---------------
 * Confirmed with @clolry. Every selection is RECORDED, but a preference is
 * only promoted to "your usual" after the same airport has been chosen
 * PROMOTION_THRESHOLD times.
 *
 * Pure learning (use whatever was picked last) makes one accidental mis-click
 * a sticky default and changes behaviour with no explanation. Pure explicit
 * preferences (a checkbox or a settings screen) are predictable but nobody
 * fills them in, so the feature goes unused. The threshold gets the
 * no-friction benefit without a single stray click becoming permanent, and
 * promoted preferences are LABELLED in the UI rather than silently
 * pre-selected — the user can always see why something was chosen for them.
 *
 * KEYED ON USER_ID
 * ----------------
 * Not on Position_Number, and not stored on HC_Positions. These rows must
 * survive an HC roster re-import — the admin GUI replaces that tab wholesale —
 * and they follow the person rather than the seat, so someone changing jobs
 * keeps their own preferences instead of inheriting the previous occupant's.
 */

// A preference is suggested as "your usual" only at or above this many uses.
// Two means a one-off mis-click never becomes a default, while a genuine
// pattern is picked up on the second trip.
var AIRPORT_PREF_PROMOTION_THRESHOLD = 2;

/**
 * Records that a traveler selected an airport.
 *
 * Idempotent per (user, type, city): increments Use_Count on an existing row
 * rather than appending a duplicate, so Use_Count is a real count of trips and
 * not a count of form interactions.
 *
 * Writing a DIFFERENT airport for the same city replaces the code and RESETS
 * Use_Count to 1. That is deliberate: if someone switches from ORD to MDW, the
 * old count should not keep the stale airport promoted. The switch starts
 * earning its own history.
 *
 * TWO THINGS THIS HAS TO GET RIGHT, BOTH LEARNED THE HARD WAY
 *
 * 1. SpreadsheetApp.flush() after every write. Apps Script BUFFERS sheet
 *    writes, so a read later in the same execution sees stale data. Without
 *    the flush, calling this twice in one execution made both calls behave as
 *    "first use": the second _openPrefsSheet_() saw a stale getLastRow(),
 *    found no existing row, and appended again onto the SAME physical row —
 *    overwriting the first. Use_Count could never pass 1, so promotion never
 *    happened and the whole hybrid-learning feature was inert. Confirmed in
 *    the sandbox: one row, Use_Count 1, after two calls.
 *
 * 2. LockService around the read-modify-write. The same clobbering happens
 *    across concurrent executions — two travelers submitting at once both read
 *    the pre-write state and the later append wins. The lock makes the
 *    increment atomic. LOCK_TIMEOUT_MS is the repo-wide 30s (Costs.js:26),
 *    matching Users.js:1512.
 *
 * Never throws, and a lock timeout is NOT an error: a failure to record a
 * preference must not block a submission. The cost of losing one increment is
 * a default airport that takes one more trip to learn.
 *
 * @param {string} userId Travel_Users.User_ID
 * @param {string} prefType HOME_ORIGIN | DESTINATION
 * @param {string} airportCode
 * @param {string} [cityName] required for DESTINATION, ignored for HOME_ORIGIN
 * @param {string} [state]
 * @returns {Object} { success, promoted, useCount, error? }
 * @server
 */
function recordAirportPreference(userId, prefType, airportCode, cityName, state) {
  try {
    var uid = String(userId || '').trim();
    var type = String(prefType || '').trim().toUpperCase();
    var code = String(airportCode || '').trim().toUpperCase();
    if (!uid || !code) return { success: false, error: 'userId and airportCode are required.' };
    if (type !== 'HOME_ORIGIN' && type !== 'DESTINATION') {
      return { success: false, error: 'prefType must be HOME_ORIGIN or DESTINATION.' };
    }

    // A metro aggregate is not a bookable airport, so it must never become
    // someone's remembered preference.
    if (typeof isMetroAreaCode === 'function' && isMetroAreaCode(code)) {
      return { success: false, error: 'Metropolitan area codes cannot be saved as a preference.' };
    }

    var city = type === 'DESTINATION' ? String(cityName || '').trim().toUpperCase() : '';
    var st = type === 'DESTINATION' ? String(state || '').trim().toUpperCase() : '';
    if (type === 'DESTINATION' && !city) {
      return { success: false, error: 'cityName is required for a DESTINATION preference.' };
    }

    // Serialize the read-modify-write. Two concurrent submissions would
    // otherwise both read the pre-write state and clobber each other's row.
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(LOCK_TIMEOUT_MS);
    } catch (le) {
      // Not an error. Losing one increment costs a default that takes one more
      // trip to learn; blocking the caller would cost a submission.
      console.warn('recordAirportPreference: lock timed out, skipping record');
      return { success: false, lockTimeout: true, error: 'Could not acquire lock.' };
    }

    try {
      var ctx = _openPrefsSheet_();
      if (!ctx) return { success: false, error: 'Traveler_Airport_Prefs tab not found.' };

      var now = new Date();
      var existing = _findPrefRow_(ctx, uid, type, city, st);

      if (existing) {
        var sameAirport = existing.airportCode === code;
        var newCount = sameAirport ? existing.useCount + 1 : 1;
        // One batched setValues rather than four setValue round-trips. The
        // four target columns are not contiguous, so write the whole row.
        var updated = ctx.rows[existing.rowNumber - 2].slice();
        updated[ctx.col.Airport_Code] = code;
        updated[ctx.col.Use_Count] = newCount;
        updated[ctx.col.Last_Used_At] = now;
        updated[ctx.col.Updated_By] = _prefActor_();
        ctx.sheet.getRange(existing.rowNumber, 1, 1, ctx.headers.length)
          .setValues([updated]);

        // Commit before returning, so a caller that reads back in the same
        // execution sees this write. See note 1 in the contract above.
        SpreadsheetApp.flush();

        return {
          success: true,
          useCount: newCount,
          promoted: newCount >= AIRPORT_PREF_PROMOTION_THRESHOLD
        };
      }

      var row = ctx.headers.map(function () { return ''; });
      row[ctx.col.Pref_ID] = 'APF-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      row[ctx.col.User_ID] = uid;
      row[ctx.col.Pref_Type] = type;
      row[ctx.col.City_Name] = city;
      row[ctx.col.State] = st;
      row[ctx.col.Airport_Code] = code;
      row[ctx.col.Use_Count] = 1;
      row[ctx.col.First_Used_At] = now;
      row[ctx.col.Last_Used_At] = now;
      row[ctx.col.Updated_By] = _prefActor_();
      ctx.sheet.appendRow(row);

      // Without this, a second call in the same execution reads a stale
      // getLastRow(), finds no existing row, and appends onto the same
      // physical row — silently overwriting this one.
      SpreadsheetApp.flush();

      return { success: true, useCount: 1, promoted: 1 >= AIRPORT_PREF_PROMOTION_THRESHOLD };

    } finally {
      lock.releaseLock();
    }

  } catch (error) {
    console.warn('recordAirportPreference failed (submission unaffected): ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * A traveler's preferences, split into the home origin and a city-keyed
 * destination map.
 *
 * `promoted` on each entry is what the UI should act on. An unpromoted
 * preference is still returned, so a caller can show "last time you used MDW"
 * without pre-selecting it.
 *
 * @param {string} userId
 * @returns {Object} { success, homeOrigin: {...}|null, destinations: {'CITY|ST': {...}}, error? }
 * @server
 */
function getAirportPreferences(userId) {
  try {
    var uid = String(userId || '').trim();
    if (!uid) return { success: false, error: 'userId is required.', homeOrigin: null, destinations: {} };

    var ctx = _openPrefsSheet_();
    if (!ctx) {
      // Absent tab is a setup state, not an error: callers degrade to no
      // preferences and the picker falls back to the busiest airport.
      return { success: true, homeOrigin: null, destinations: {} };
    }

    var out = { success: true, homeOrigin: null, destinations: {} };
    for (var i = 0; i < ctx.rows.length; i++) {
      var r = ctx.rows[i];
      if (String(r[ctx.col.User_ID] || '').trim() !== uid) continue;

      var entry = {
        airportCode: String(r[ctx.col.Airport_Code] || '').trim().toUpperCase(),
        useCount: parseInt(r[ctx.col.Use_Count], 10) || 0,
        lastUsedAt: r[ctx.col.Last_Used_At] || '',
        promoted: (parseInt(r[ctx.col.Use_Count], 10) || 0) >= AIRPORT_PREF_PROMOTION_THRESHOLD
      };
      if (!entry.airportCode) continue;

      var type = String(r[ctx.col.Pref_Type] || '').trim().toUpperCase();
      if (type === 'HOME_ORIGIN') {
        out.homeOrigin = entry;
      } else if (type === 'DESTINATION') {
        var city = String(r[ctx.col.City_Name] || '').trim().toUpperCase();
        var st = String(r[ctx.col.State] || '').trim().toUpperCase();
        if (city) out.destinations[city + '|' + st] = entry;
      }
    }
    return out;

  } catch (error) {
    console.error('getAirportPreferences failed: ' + error.message);
    return { success: false, error: error.message, homeOrigin: null, destinations: {} };
  }
}

/**
 * The airport options for a city, ordered so the right default comes first.
 *
 * Precedence:
 *   1. a PROMOTED preference for this traveler and city
 *   2. the busiest real airport
 *   3. metro aggregates, always last and never a default
 *
 * Fares are NOT priced here. @clolry's flow is: confirm the origin first, then
 * price destinations from that origin only. Pricing every airport eagerly
 * would mean 8 sheet scans for a DC-to-Chicago leg and would surface options
 * the traveler would never accept.
 *
 * @param {string} cityName
 * @param {string} stateCode
 * @param {string} [userId] when given, applies that traveler's preference
 * @param {string} [prefType=DESTINATION] HOME_ORIGIN | DESTINATION
 * @returns {Object} { success, airports[], defaultCode, preferredCode, error? }
 * @server
 */
function getAirportOptionsForCity(cityName, stateCode, userId, prefType) {
  try {
    var listing = getAirportsForCity(cityName, stateCode);
    if (!listing.success) return { success: false, error: listing.error, airports: [], defaultCode: '' };

    // Carry the resolution tier through, so the UI can say "no airports listed
    // for Fort Worth, TX — showing Texas airports" instead of presenting a
    // state-wide list as though every one of them served the requested city.
    var airports = (listing.airports || []).map(function (a) {
      return {
        code: a.code,
        city: a.city,
        state: a.state,
        country: a.country,
        isMetroArea: !!a.isMetroArea,
        metroLabel: a.metroLabel || '',
        routeCount: a.routeCount || 0,
        isPreferred: false,
        useCount: 0
      };
    });

    var preferredCode = '';
    if (userId) {
      var prefs = getAirportPreferences(userId);
      if (prefs.success) {
        var type = String(prefType || 'DESTINATION').toUpperCase();
        var entry = null;
        if (type === 'HOME_ORIGIN') {
          entry = prefs.homeOrigin;
        } else {
          var key = String(cityName || '').trim().toUpperCase() + '|' +
                    String(stateCode || '').trim().toUpperCase();
          entry = prefs.destinations[key] || null;
        }
        // Only a PROMOTED preference is allowed to change the default. An
        // unpromoted one is still annotated so the UI can mention it.
        if (entry) {
          for (var i = 0; i < airports.length; i++) {
            if (airports[i].code === entry.airportCode) {
              airports[i].useCount = entry.useCount;
              airports[i].isPreferred = entry.promoted;
              if (entry.promoted) preferredCode = entry.airportCode;
              break;
            }
          }
        }
      }
    }

    airports.sort(function (a, b) {
      if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
      if (a.isMetroArea !== b.isMetroArea) return a.isMetroArea ? 1 : -1;
      return b.routeCount - a.routeCount;
    });

    return {
      success: true,
      airports: airports,
      defaultCode: airports.length ? airports[0].code : '',
      preferredCode: preferredCode,
      matchType: listing.matchType || 'none',
      matchedCity: listing.matchedCity || '',
      requestedCity: listing.requestedCity || '',
      // True when the UI should offer a choice at all. A single-airport city
      // (Honolulu is only HNL) should not make anyone pick.
      hasChoice: airports.filter(function (a) { return !a.isMetroArea; }).length > 1
    };

  } catch (error) {
    console.error('getAirportOptionsForCity failed: ' + error.message);
    return { success: false, error: error.message, airports: [], defaultCode: '' };
  }
}

/**
 * Destination airports for a city, each priced from a FIXED origin.
 *
 * This is step 2 of the flow: the origin is already settled, so only the
 * destinations need pricing. For DC to Chicago from DCA that is ORD at $112
 * non-stop and MDW at $304 non-stop — a real decision, which is why the fares
 * are shown rather than the cheapest being silently chosen.
 *
 * Unpriced options are returned with ycaFare null and are sorted after priced
 * ones. A route with no contract fare is not an error; it means the traveler
 * must supply their own estimate.
 *
 * @param {string} originCode
 * @param {string} destCityName
 * @param {string} destState
 * @param {string} [userId]
 * @param {string} [travelDate] YYYY-MM-DD
 * @returns {Object} { success, options[], defaultCode, hasChoice }
 * @server
 */
function getPricedDestinationOptions(originCode, destCityName, destState, userId, travelDate) {
  try {
    var origin = String(originCode || '').trim().toUpperCase();
    if (!origin) return { success: false, error: 'originCode is required.', options: [] };

    var listing = getAirportOptionsForCity(destCityName, destState, userId, 'DESTINATION');
    if (!listing.success) return { success: false, error: listing.error, options: [] };

    // ONE sheet scan for every candidate, not one per candidate. Pricing three
    // Chicago airports with getCityPairFare took 11 SECONDS in the sandbox —
    // three full 17,403-row scans. This is reached from a form keystroke.
    var fares = getCityPairFaresBulk(
      origin,
      listing.airports.map(function (a) { return a.code; }),
      travelDate
    );

    var options = listing.airports.map(function (a) {
      var fare = fares[a.code] || { success: true, found: false };
      return {
        code: a.code,
        city: a.city,
        state: a.state,
        isMetroArea: a.isMetroArea,
        metroLabel: a.metroLabel,
        isPreferred: a.isPreferred,
        useCount: a.useCount,
        routeCount: a.routeCount,
        found: !!(fare.success && fare.found),
        ycaFare: (fare.success && fare.found) ? fare.ycaFare : null,
        caFare: (fare.success && fare.found) ? fare.caFare : null,
        airline: (fare.success && fare.found) ? fare.airline : '',
        awardedService: (fare.success && fare.found) ? fare.awardedService : ''
      };
    });

    // Preference first, then priced before unpriced, then cheapest. Price is
    // the tiebreak rather than the primary sort: a $108 fare into the wrong
    // airport is not a saving.
    options.sort(function (a, b) {
      if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
      if (a.isMetroArea !== b.isMetroArea) return a.isMetroArea ? 1 : -1;
      if (a.found !== b.found) return a.found ? -1 : 1;
      if (a.found && b.found) return a.ycaFare - b.ycaFare;
      return b.routeCount - a.routeCount;
    });

    return {
      success: true,
      origin: origin,
      options: options,
      defaultCode: options.length ? options[0].code : '',
      matchType: listing.matchType || 'none',
      matchedCity: listing.matchedCity || '',
      requestedCity: listing.requestedCity || '',
      hasChoice: options.filter(function (o) { return !o.isMetroArea; }).length > 1
    };

  } catch (error) {
    console.error('getPricedDestinationOptions failed: ' + error.message);
    return { success: false, error: error.message, options: [] };
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function _prefActor_() {
  try {
    return Session.getActiveUser().getEmail() || 'system';
  } catch (e) {
    return 'system';
  }
}

/** Opens Traveler_Airport_Prefs and returns header indices plus data rows. */
function _openPrefsSheet_() {
  if (!TRAVEL_DB_SPREADSHEET_ID) return null;
  var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAMES.TRAVELER_AIRPORT_PREFS);
  if (!sheet) return null;

  var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.TRAVELER_AIRPORT_PREFS];
  var col = {};
  headers.forEach(function (h, i) { col[h] = i; });

  var lastRow = sheet.getLastRow();
  var rows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
    : [];

  return { sheet: sheet, headers: headers, col: col, rows: rows };
}

/** Locates an existing preference row. Returns null when absent. */
function _findPrefRow_(ctx, userId, prefType, city, state) {
  for (var i = 0; i < ctx.rows.length; i++) {
    var r = ctx.rows[i];
    if (String(r[ctx.col.User_ID] || '').trim() !== userId) continue;
    if (String(r[ctx.col.Pref_Type] || '').trim().toUpperCase() !== prefType) continue;
    if (prefType === 'DESTINATION') {
      if (String(r[ctx.col.City_Name] || '').trim().toUpperCase() !== city) continue;
      if (String(r[ctx.col.State] || '').trim().toUpperCase() !== state) continue;
    }
    return {
      rowNumber: i + 2,   // +1 header, +1 one-based
      airportCode: String(r[ctx.col.Airport_Code] || '').trim().toUpperCase(),
      useCount: parseInt(r[ctx.col.Use_Count], 10) || 0
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// client wrappers
// ---------------------------------------------------------------------------

/** @client */
function getAirportOptionsForCityForClient(cityName, stateCode, userId, prefType) {
  return getAirportOptionsForCity(cityName, stateCode, userId, prefType);
}

/** @client */
function getPricedDestinationOptionsForClient(originCode, destCityName, destState, userId, travelDate) {
  return getPricedDestinationOptions(originCode, destCityName, destState, userId, travelDate);
}

/** @client */
function recordAirportPreferenceForClient(userId, prefType, airportCode, cityName, state) {
  return recordAirportPreference(userId, prefType, airportCode, cityName, state);
}
