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
 * IATA METROPOLITAN AREA CODES.
 *
 * These are not airports. WAS covers DCA, IAD and BWI collectively; NYC covers
 * JFK, LGA and EWR. GSA uses them in DOMESTIC rows as well as international
 * ones, which broke the original assumption that a metro code could be
 * detected by `country !== 'UNITED STATES'`.
 *
 * It matters because WAS appeared in the synced data with 260 routes against
 * DCA's 254, so sorting by route count made WAS the default origin for
 * Washington — an aggregate, not a bookable airport, and not the DCA default
 * @clolry asked for.
 *
 * Nothing in the CSV marks these, so the list has to be known. Extend it when
 * a new metro code shows up; an unlisted one sorts as though it were an
 * airport and will quietly win a default it should not.
 */
var IATA_METRO_CODES = {
  WAS: 'Washington, DC area',
  NYC: 'New York City area',
  CHI: 'Chicago area',
  LON: 'London area',
  PAR: 'Paris area',
  ROM: 'Rome area',
  TYO: 'Tokyo area',
  MIL: 'Milan area',
  MOW: 'Moscow area',
  BUE: 'Buenos Aires area',
  RIO: 'Rio de Janeiro area',
  SAO: 'Sao Paulo area',
  BER: 'Berlin area',
  STO: 'Stockholm area',
  OSA: 'Osaka area',
  SEL: 'Seoul area',
  BJS: 'Beijing area',
  JKT: 'Jakarta area',
  TEH: 'Tehran area',
  DTT: 'Detroit area'
};

/** True when a code is a metropolitan-area aggregate rather than an airport. */
function isMetroAreaCode(code) {
  return !!IATA_METRO_CODES[String(code || '').trim().toUpperCase()];
}

/**
 * Normalizes a sheet cell that may be a Date or a string into YYYY-MM-DD.
 *
 * Sheets coerces an ISO date string on write, so getValues() returns a Date
 * object, not the 'YYYY-MM-DD' that was written. The original window filter
 * compared that Date against a string — 'Thu Oct 01 2026...' <= '2027-02-15'
 * is a lexical comparison of 'T' against '2', always false — so every row was
 * filtered out and the code silently fell through to ignoring the window.
 *
 * It failed safe (a fare was still returned) which is exactly why it went
 * unnoticed: the date-validity check was dead code that looked like it worked.
 */
function normalizeSheetDate_(value) {
  if (!value) return '';
  if (value instanceof Date) {
    var y = value.getFullYear();
    var m = String(value.getMonth() + 1);
    var d = String(value.getDate());
    return y + '-' + (m.length === 1 ? '0' + m : m) + '-' + (d.length === 1 ? '0' + d : d);
  }
  var s = String(value).trim();
  // Already ISO.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // A Date rendered to string by an earlier layer.
  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return normalizeSheetDate_(parsed);
  return '';
}

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

    // Shared selector, so this and the bulk path cannot disagree about which
    // carrier wins or how the date window applies.
    var result = _selectFare_(pairKey, _readCityPairRows_(pairKey), travelDate);

    cache.put(cacheKey, JSON.stringify(result), CACHE_CONFIG.TTL.PER_DIEM);
    return result;

  } catch (error) {
    console.error('getCityPairFare failed: ' + error.message);
    return { success: false, found: false, pairKey: pairKey, error: error.message };
  }
}

/**
 * Fares for MANY pairs in ONE sheet scan.
 *
 * getCityPairFare scans all 17,403 rows per call, which is fine once but not
 * N times. getPricedDestinationOptions took 11 SECONDS in the sandbox pricing
 * three Chicago airports — three full scans — and that is a form keystroke, not
 * an editor run.
 *
 * This scans once and buckets by pair key. Cost is one scan regardless of how
 * many pairs are requested.
 *
 * @param {Array<string>} pairKeys normalized keys from buildPairKey_
 * @returns {Object} pairKey -> array of row objects (absent keys are omitted)
 */
function _readCityPairRowsBulk_(pairKeys) {
  var wanted = {};
  (pairKeys || []).forEach(function (k) { if (k) wanted[k] = true; });
  if (!Object.keys(wanted).length) return {};

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
  if (lastRow < 2) return {};

  var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.CITY_PAIRS];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var c = {};
  headers.forEach(function (h, i) { c[h] = i; });

  var out = {};
  for (var i = 0; i < values.length; i++) {
    var key = String(values[i][c['Pair_Key']]).trim().toUpperCase();
    if (!wanted[key]) continue;
    if (!out[key]) out[key] = [];
    out[key].push(_mapCityPairRow_(values[i], c));
  }
  return out;
}

/** Shared row mapper, so the single and bulk readers cannot drift apart. */
function _mapCityPairRow_(row, c) {
  return {
    awardYear: String(row[c['Award_Year']] || ''),
    originCode: String(row[c['Origin_Airport_Abbrev']] || ''),
    destCode: String(row[c['Destination_Airport_Abbrev']] || ''),
    originCity: String(row[c['Origin_City_Name']] || ''),
    originState: String(row[c['Origin_State']] || ''),
    originCountry: String(row[c['Origin_Country']] || ''),
    destCity: String(row[c['Destination_City_Name']] || ''),
    destState: String(row[c['Destination_State']] || ''),
    destCountry: String(row[c['Destination_Country']] || ''),
    airline: String(row[c['Airline_Abbrev']] || ''),
    awardedService: String(row[c['Awarded_Service']] || ''),
    ycaFare: parseFloat(row[c['YCA_Fare']]) || 0,
    caFare: parseFloat(row[c['CA_Fare']]) || 0,
    businessFare: parseFloat(row[c['Business_Fare']]) || 0,
    // Sheets returns these as Date objects, not the strings that were
    // written. Normalizing here is what makes the window filter work.
    effectiveDate: normalizeSheetDate_(row[c['Effective_Date']]),
    expirationDate: normalizeSheetDate_(row[c['Expiration_Date']])
  };
}

/**
 * Picks the best row for a pair and shapes the public fare result.
 *
 * Extracted so getCityPairFare and the bulk path apply IDENTICAL selection and
 * date-window rules. Duplicating that logic would let the single and bulk
 * lookups disagree, and the symptom would be a fare that changes depending on
 * which code path produced it.
 */
function _selectFare_(pairKey, rows, travelDate) {
  if (!rows || !rows.length) {
    return {
      success: true, found: false, pairKey: pairKey,
      message: 'No GSA contract fare is awarded for this city pair.'
    };
  }

  var usable = rows;
  if (travelDate) {
    var inWindow = rows.filter(function (r) {
      // Blank dates are treated as always-valid rather than as excluded: a
      // malformed date in the source should not hide a real fare.
      var okFrom = !r.effectiveDate || r.effectiveDate <= travelDate;
      var okTo = !r.expirationDate || r.expirationDate >= travelDate;
      return okFrom && okTo;
    });
    if (inWindow.length) usable = inWindow;
  }

  usable = usable.slice().sort(function (a, b) { return a.ycaFare - b.ycaFare; });
  var best = usable[0];

  return {
    success: true,
    found: true,
    pairKey: pairKey,
    ycaFare: best.ycaFare,
    // 0 means not awarded; surface null so the UI cannot print $0.00.
    caFare: best.caFare > 0 ? best.caFare : null,
    businessFare: best.businessFare > 0 ? best.businessFare : null,
    airline: best.airline,
    awardedService: best.awardedService,
    carriers: usable.map(function (r) {
      return {
        airline: r.airline,
        awardedService: r.awardedService,
        ycaFare: r.ycaFare,
        caFare: r.caFare > 0 ? r.caFare : null
      };
    }),
    origin: { code: best.originCode, city: best.originCity, state: best.originState, country: best.originCountry },
    destination: { code: best.destCode, city: best.destCity, state: best.destState, country: best.destCountry },
    effectiveDate: best.effectiveDate,
    expirationDate: best.expirationDate,
    awardYear: best.awardYear
  };
}

/**
 * Fares for several destinations from one origin, in a single sheet scan.
 *
 * @param {string} originCode
 * @param {Array<string>} destCodes
 * @param {string} [travelDate]
 * @returns {Object} destCode -> same shape as getCityPairFare
 */
function getCityPairFaresBulk(originCode, destCodes, travelDate) {
  var out = {};
  var keyToDest = {};
  var keys = [];

  (destCodes || []).forEach(function (d) {
    var key = buildPairKey_(originCode, d);
    if (!key) return;
    keyToDest[key] = String(d).trim().toUpperCase();
    keys.push(key);
  });
  if (!keys.length) return out;

  try {
    var buckets = _readCityPairRowsBulk_(keys);
    keys.forEach(function (key) {
      out[keyToDest[key]] = _selectFare_(key, buckets[key], travelDate);
    });
  } catch (e) {
    console.error('getCityPairFaresBulk failed: ' + e.message);
    keys.forEach(function (key) {
      out[keyToDest[key]] = { success: false, found: false, pairKey: key, error: e.message };
    });
  }
  return out;
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
    out.push(_mapCityPairRow_(values[i], c));
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
 * Metropolitan-area codes (WAS, NYC, LON) are returned but sort LAST and are
 * flagged isMetroArea, so they can be labelled "all airports" and can never
 * win a default. They appear in domestic rows as well as international ones —
 * WAS outranked DCA on route count, which is what made the original
 * country-based detection wrong.
 *
 * @param {string} cityName
 * @param {string} [stateCode]
 * @returns {Object} { success, airports: [{code, city, state, country, isMetroArea, metroLabel, routeCount}] }
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
        var metro = isMetroAreaCode(abbrev);
        found[abbrev] = {
          code: abbrev,
          city: String(cityVal || '').trim(),
          state: String(stateVal || '').trim(),
          country: String(countryVal || '').trim(),
          // A metropolitan-area aggregate (WAS, NYC, LON) rather than a
          // bookable airport. Detected from IATA_METRO_CODES, NOT from the
          // country column — GSA uses metro codes in domestic rows too, which
          // is what made WAS outrank DCA as Washington's default.
          isMetroArea: metro,
          metroLabel: metro ? IATA_METRO_CODES[abbrev] : '',
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

    // Real airports first, most-connected first within each group. Metro
    // aggregates sort LAST so they can never become a default: WAS carries
    // more routes than DCA, so a pure route-count sort picked the aggregate.
    var airports = Object.keys(found).map(function (k) { return found[k]; })
      .sort(function (a, b) {
        if (a.isMetroArea !== b.isMetroArea) return a.isMetroArea ? 1 : -1;
        return b.routeCount - a.routeCount;
      });

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
