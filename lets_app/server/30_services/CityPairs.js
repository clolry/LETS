/**
 * CityPairs.js
 * Lookup service for GSA City Pair Program contract airfares.
 *
 * Reads the City_Pairs tab that 91_setup/CityPairSync.js populates daily.
 * Nothing here fetches from GSA; a form keystroke must never depend on an
 * external service being up.
 *
 * POLICY DECISIONS ENCODED HERE
 * -----------------------------
 * 1. YCA is the pre-fill basis. Confirmed with @clolry on 2026-10-30.
 *
 *    YCA_FARE is the unrestricted, always-available, refundable coach fare.
 *    _CA_FARE is capacity-controlled: cheaper, but limited seats. The spread
 *    is large — a single sample row showed 710 vs 355, a 2x difference.
 *
 *    This is a budget-governance system, so under-estimating is the worse
 *    failure: if the _CA seats are gone the traveler books YCA and the request
 *    is suddenly double its approved estimate. The CA fare is still RETURNED
 *    so the UI can show it as the likely-lower actual, but it is not the
 *    number the field is populated with.
 *
 * 2. Zero means NOT AWARDED, not free. Business_Fare is 0 on most routes.
 *    Any fare of 0 is reported as unavailable rather than as $0.00, which
 *    would look like a valid estimate.
 *
 * 3. Multiple carriers per pair are normal — each is its own row at its own
 *    fare. The LOWEST YCA is used, because the traveler is expected to book
 *    the cheapest contract option on the route.
 *
 * CACHING
 * -------
 * 17,403 rows is well past the 100KB single-entry CacheService limit; a
 * compact key->fare index is roughly 255KB. Rather than chunk it, lookups read
 * the sheet and cache the RESULT per pair. A trip touches a handful of pairs,
 * not seventeen thousand, so per-pair caching is both smaller and warmer than
 * caching the whole index. CACHE_CONFIG.CHUNK_SIZE exists if a full index is
 * ever needed.
 */

/**
 * Contract fares for one origin/destination pair.
 *
 * Direction-insensitive: GSA stores each pair alphabetically, so DCA->ORD and
 * ORD->DCA are the same row. buildPairKey_() normalizes both.
 *
 * @param {string} originCode airport code (domestic) or city code (intl)
 * @param {string} destCode
 * @param {string} [travelDate] YYYY-MM-DD; when given, rows whose
 *        effective/expiration window excludes it are ignored
 * @returns {Object} { success, found, pairKey, ycaFare, caFare, businessFare,
 *                     airline, carriers[], origin{}, destination{}, error? }
 * @server
 */
function getCityPairFare(originCode, destCode, travelDate) {
  var pairKey = buildPairKey_(originCode, destCode);
  if (!pairKey) {
    return { success: false, found: false, error: 'Both an origin and a destination code are required.' };
  }

  try {
    var cacheKey = 'cp_fare_' + pairKey + (travelDate ? '_' + travelDate : '');
    var cache = CacheService.getScriptCache();
    var hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);

    var rows = _readCityPairRows_(pairKey);
    var result;

    if (!rows.length) {
      result = {
        success: true, found: false, pairKey: pairKey,
        message: 'No GSA contract fare is awarded for this city pair.'
      };
    } else {
      var usable = rows;
      if (travelDate) {
        var inWindow = rows.filter(function (r) {
          // Blank dates are treated as always-valid rather than as excluded:
          // a malformed date in the source should not hide a real fare.
          var okFrom = !r.effectiveDate || r.effectiveDate <= travelDate;
          var okTo = !r.expirationDate || r.expirationDate >= travelDate;
          return okFrom && okTo;
        });
        if (inWindow.length) usable = inWindow;
      }

      // Lowest YCA across carriers.
      usable.sort(function (a, b) { return a.ycaFare - b.ycaFare; });
      var best = usable[0];

      result = {
        success: true,
        found: true,
        pairKey: pairKey,
        ycaFare: best.ycaFare,
        // 0 means not awarded; surface null so the UI cannot print $0.00.
        caFare: best.caFare > 0 ? best.caFare : null,
        businessFare: best.businessFare > 0 ? best.businessFare : null,
        airline: best.airline,
        carriers: usable.map(function (r) {
          return { airline: r.airline, ycaFare: r.ycaFare, caFare: r.caFare > 0 ? r.caFare : null };
        }),
        origin: { code: best.originCode, city: best.originCity, state: best.originState, country: best.originCountry },
        destination: { code: best.destCode, city: best.destCity, state: best.destState, country: best.destCountry },
        effectiveDate: best.effectiveDate,
        expirationDate: best.expirationDate,
        awardYear: best.awardYear
      };
    }

    cache.put(cacheKey, JSON.stringify(result), CACHE_CONFIG.TTL.PER_DIEM);
    return result;

  } catch (error) {
    console.error('getCityPairFare failed: ' + error.message);
    return { success: false, found: false, pairKey: pairKey, error: error.message };
  }
}

/** Every City_Pairs row matching a normalized pair key. */
function _readCityPairRows_(pairKey) {
  if (!TRAVEL_DB_SPREADSHEET_ID) {
    throw new Error('TRAVEL_DB_SPREADSHEET_ID is not set in Script Properties.');
  }
  var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAMES.CITY_PAIRS);
  if (!sheet) {
    throw new Error('Tab "' + SHEET_NAMES.CITY_PAIRS + '" not found. Run ' +
      'setupTravelDatabase() then syncCityPairs().');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.CITY_PAIRS];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  var c = {};
  headers.forEach(function (h, i) { c[h] = i; });

  var out = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][c['Pair_Key']]).trim().toUpperCase() !== pairKey) continue;
    out.push({
      awardYear: String(values[i][c['Award_Year']] || ''),
      originCode: String(values[i][c['Origin_Airport_Abbrev']] || ''),
      destCode: String(values[i][c['Destination_Airport_Abbrev']] || ''),
      originCity: String(values[i][c['Origin_City_Name']] || ''),
      originState: String(values[i][c['Origin_State']] || ''),
      originCountry: String(values[i][c['Origin_Country']] || ''),
      destCity: String(values[i][c['Destination_City_Name']] || ''),
      destState: String(values[i][c['Destination_State']] || ''),
      destCountry: String(values[i][c['Destination_Country']] || ''),
      airline: String(values[i][c['Airline_Abbrev']] || ''),
      ycaFare: parseFloat(values[i][c['YCA_Fare']]) || 0,
      caFare: parseFloat(values[i][c['CA_Fare']]) || 0,
      businessFare: parseFloat(values[i][c['Business_Fare']]) || 0,
      effectiveDate: String(values[i][c['Effective_Date']] || ''),
      expirationDate: String(values[i][c['Expiration_Date']] || '')
    });
  }
  return out;
}

/**
 * Airports serving a city, derived from the synced data rather than a
 * hardcoded table.
 *
 * Both ORIGIN_* and DESTINATION_* columns are scanned because a given city
 * appears on whichever side of the pair sorts first alphabetically — searching
 * only one side would miss roughly half the routes.
 *
 * Deriving this from the CSV means it stays correct as GSA adds or retires
 * routes. A hardcoded city->airport map would drift silently.
 *
 * Note the domestic/international split: domestic rows carry AIRPORT codes
 * (DCA, IAD, BWI) while international rows carry CITY codes (WAS, LON). Both
 * are returned, flagged by `isCityCode`, so the UI can explain why an
 * international trip offers one option where a domestic trip offers three.
 *
 * @param {string} cityName
 * @param {string} [stateCode]
 * @returns {Object} { success, airports: [{code, city, state, country, isCityCode, routeCount}] }
 * @server
 */
function getAirportsForCity(cityName, stateCode) {
  var city = String(cityName || '').trim().toUpperCase();
  if (!city) return { success: false, airports: [], error: 'A city name is required.' };
  var state = String(stateCode || '').trim().toUpperCase();

  try {
    var cacheKey = 'cp_airports_' + city + '_' + state;
    var cache = CacheService.getScriptCache();
    var hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);

    if (!TRAVEL_DB_SPREADSHEET_ID) {
      throw new Error('TRAVEL_DB_SPREADSHEET_ID is not set in Script Properties.');
    }
    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.CITY_PAIRS);
    if (!sheet) {
      throw new Error('Tab "' + SHEET_NAMES.CITY_PAIRS + '" not found. Run ' +
        'setupTravelDatabase() then syncCityPairs().');
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: true, airports: [], message: 'City_Pairs is empty. Run syncCityPairs().' };
    }

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.CITY_PAIRS];
    var c = {};
    headers.forEach(function (h, i) { c[h] = i; });
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

    var found = {};
    function consider(code, cityVal, stateVal, countryVal) {
      var rowCity = String(cityVal || '').trim().toUpperCase();
      if (rowCity !== city) return;
      var rowState = String(stateVal || '').trim().toUpperCase();
      if (state && rowState && rowState !== state) return;
      var abbrev = String(code || '').trim().toUpperCase();
      if (!abbrev) return;
      if (!found[abbrev]) {
        found[abbrev] = {
          code: abbrev,
          city: String(cityVal || '').trim(),
          state: String(stateVal || '').trim(),
          country: String(countryVal || '').trim(),
          // International rows use city codes, not airport codes.
          isCityCode: String(countryVal || '').trim().toUpperCase() !== 'UNITED STATES',
          routeCount: 0
        };
      }
      found[abbrev].routeCount++;
    }

    for (var i = 0; i < values.length; i++) {
      consider(values[i][c['Origin_Airport_Abbrev']], values[i][c['Origin_City_Name']],
               values[i][c['Origin_State']], values[i][c['Origin_Country']]);
      consider(values[i][c['Destination_Airport_Abbrev']], values[i][c['Destination_City_Name']],
               values[i][c['Destination_State']], values[i][c['Destination_Country']]);
    }

    // Most-connected airport first: it is the most likely choice and makes a
    // sensible default without hardcoding one.
    var airports = Object.keys(found).map(function (k) { return found[k]; })
      .sort(function (a, b) { return b.routeCount - a.routeCount; });

    var result = { success: true, airports: airports };
    cache.put(cacheKey, JSON.stringify(result), CACHE_CONFIG.TTL.PER_DIEM);
    return result;

  } catch (error) {
    console.error('getAirportsForCity failed: ' + error.message);
    return { success: false, airports: [], error: error.message };
  }
}

/**
 * Round-trip or multi-segment itinerary estimate.
 *
 * TRANSPARENCY IS THE POINT. @clolry asked that the summed amount be
 * explainable, so this returns a `segments` array naming every priced leg and
 * its fare. The UI shows that breakdown rather than only a total — a single
 * number a user cannot decompose is one they cannot check.
 *
 * Segments are built duty station -> leg 1 -> leg 2 -> ... -> duty station,
 * because the form carries ONE ticketCost per traveler while the itinerary
 * supports multiple legs.
 *
 * `complete` is false when any segment has no contract fare. The caller must
 * not present a partial sum as a full estimate; a missing segment silently
 * omitted is exactly how an under-estimate reaches an approver.
 *
 * @param {Array<string>} airportCodes ordered, e.g. ['DCA','ORD','DCA']
 * @param {string} [travelDate] YYYY-MM-DD
 * @returns {Object} { success, complete, total, segments[], missingSegments[] }
 * @server
 */
function getItineraryAirfare(airportCodes, travelDate) {
  var codes = (airportCodes || []).map(function (x) {
    return String(x || '').trim().toUpperCase();
  }).filter(Boolean);

  if (codes.length < 2) {
    return {
      success: false, complete: false, total: 0, segments: [], missingSegments: [],
      error: 'At least two airport codes are required to price a segment.'
    };
  }

  try {
    var segments = [];
    var missing = [];
    var total = 0;

    for (var i = 0; i < codes.length - 1; i++) {
      var from = codes[i];
      var to = codes[i + 1];
      if (from === to) continue;   // same-airport hop is not a flight

      var fare = getCityPairFare(from, to, travelDate);
      if (fare.success && fare.found) {
        total += fare.ycaFare;
        segments.push({
          from: from, to: to, ycaFare: fare.ycaFare, caFare: fare.caFare,
          airline: fare.airline, found: true
        });
      } else {
        missing.push({ from: from, to: to });
        segments.push({ from: from, to: to, ycaFare: null, caFare: null, airline: '', found: false });
      }
    }

    return {
      success: true,
      complete: missing.length === 0 && segments.length > 0,
      total: total,
      segments: segments,
      missingSegments: missing,
      fareBasis: 'YCA'
    };

  } catch (error) {
    console.error('getItineraryAirfare failed: ' + error.message);
    return { success: false, complete: false, total: 0, segments: [], missingSegments: [], error: error.message };
  }
}

/** Clears cached fares and airport lists. Called by syncCityPairs. */
function invalidateCityPairCache() {
  try {
    // CacheService cannot enumerate keys, so per-pair entries cannot be
    // removed wholesale. They carry CACHE_CONFIG.TTL.PER_DIEM (24h) and the
    // sync runs daily, so the window of staleness is bounded and small —
    // fares are fixed for the fiscal year with only occasional amendments.
    console.log('invalidateCityPairCache: per-pair entries expire within ' +
      CACHE_CONFIG.TTL.PER_DIEM + 's');
    return true;
  } catch (e) {
    console.warn('invalidateCityPairCache failed: ' + e.message);
    return false;
  }
}

/**
 * Client-facing wrapper for the itinerary estimate.
 * @returns {Object} same shape as getItineraryAirfare
 * @client
 */
function getItineraryAirfareForClient(airportCodes, travelDate) {
  return getItineraryAirfare(airportCodes, travelDate);
}

/**
 * Client-facing wrapper for the airport picker.
 * @returns {Object} same shape as getAirportsForCity
 * @client
 */
function getAirportsForCityForClient(cityName, stateCode) {
  return getAirportsForCity(cityName, stateCode);
}
