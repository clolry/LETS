/**
 * CityPairSync.js
 * Daily sync of GSA City Pair Program contract airfares.
 *
 * WHY A CSV SYNC AND NOT AN API
 * -----------------------------
 * GSA published a prototype City Pairs API at
 * api.gsa.gov/travel/citypairs/v0. It is nine years old, still at v0, and a
 * live probe on 2026-10-30 returned 404. It was a reference project to
 * demonstrate open-government standards, not a supported service.
 *
 * The authoritative artifact is the CSV behind the public Fare Finder, which
 * GSA rewrites each business day after 23:59 ET. Syncing it to a sheet also
 * means lookups do not depend on an external service being up while a user is
 * filling in a form, and it reuses the pattern 91_setup/DoDSync.js and
 * 91_setup/ForeignSync.js already establish for external reference data.
 *
 * THE ALPHABETICAL-ORDER TRAP
 * ---------------------------
 * GSA stores each pair with origin and destination in ALPHABETICAL order
 * regardless of travel direction. Washington to London is stored as LON|WAS,
 * because LON sorts before WAS. So a lookup of 'WAS -> LON' finds nothing
 * unless the pair is normalized first, and so does 'DCA -> ORD' for a row
 * stored as DCA|ATL.
 *
 * That failure is silent and misleading: it returns "no contract fare" for a
 * route that genuinely has one, which a user reads as missing data rather than
 * a bug. Pair_Key is computed at sync time so both directions resolve to the
 * same row, and buildPairKey_() is the single place that ordering is decided.
 *
 * FISCAL YEAR
 * -----------
 * The URL embeds the fiscal year (awards_2027.csv). The template lives in the
 * CITY_PAIR_CSV_URL_TEMPLATE Script Property so a GSA path change is a config
 * edit rather than a deploy, and {FY} is substituted at runtime from
 * getFiscalYear() — which already rolls over on 1 October (PerDiemGSA.js:487).
 */

// Default URL template. Overridden by the CITY_PAIR_CSV_URL_TEMPLATE Script
// Property; {FY} is replaced with the four-digit fiscal year.
var CITY_PAIR_CSV_URL_DEFAULT = 'https://www.gsa.gov/system/files/awards_{FY}.csv';

// Source CSV column names, used to resolve indices by NAME rather than
// position. GSA could append a column; reading by name survives that, reading
// by position would silently shift every field.
var CITY_PAIR_CSV_COLUMNS = {
  AWARD_YEAR: 'AWARD_YEAR',
  ORIGIN_ABBREV: 'ORIGIN_AIRPORT_ABBREV',
  DEST_ABBREV: 'DESTINATION_AIRPORT_ABBREV',
  ORIGIN_CITY: 'ORIGIN_CITY_NAME',
  ORIGIN_STATE: 'ORIGIN_STATE',
  ORIGIN_COUNTRY: 'ORIGIN_COUNTRY',
  DEST_CITY: 'DESTINATION_CITY_NAME',
  DEST_STATE: 'DESTINATION_STATE',
  DEST_COUNTRY: 'DESTINATION_COUNTRY',
  AIRLINE: 'AIRLINE_ABBREV',
  YCA_FARE: 'YCA_FARE',
  CA_FARE: '_CA_FARE',
  BUSINESS_FARE: 'BUSINESS_FARE',
  EFFECTIVE_DATE: 'EFFECTIVE_DATE',
  EXPIRATION_DATE: 'EXPIRATION_DATE'
};

/**
 * Normalized lookup key for an airport/city pair.
 *
 * THE ONLY PLACE PAIR ORDERING IS DECIDED. Both sync and lookup call this, so
 * they cannot disagree — which is the entire point, since a mismatch produces
 * a silent empty result rather than an error.
 *
 * @param {string} a airport or city code
 * @param {string} b airport or city code
 * @returns {string} e.g. buildPairKey_('ORD','DCA') -> 'DCA|ORD'
 */
function buildPairKey_(a, b) {
  var x = String(a || '').trim().toUpperCase();
  var y = String(b || '').trim().toUpperCase();
  if (!x || !y) return '';
  return x <= y ? (x + '|' + y) : (y + '|' + x);
}

/** Resolved CSV URL for the current fiscal year. */
function getCityPairCsvUrl_() {
  var template;
  try {
    template = PropertiesService.getScriptProperties()
      .getProperty('CITY_PAIR_CSV_URL_TEMPLATE');
  } catch (e) {
    template = null;
  }
  template = template || CITY_PAIR_CSV_URL_DEFAULT;

  var now = new Date();
  // Oct-Dec belong to the NEXT fiscal year. Mirrors getFiscalYear()
  // (PerDiemGSA.js:487); inlined because that helper takes a date string.
  var fy = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
  return template.replace('{FY}', String(fy));
}

/**
 * Parses MM/DD/YYYY, the format GSA uses in this CSV.
 *
 * Not ISO, and not what parseDateString() in 30_services/Costs.js expects.
 * Returns '' rather than an Invalid Date so a malformed row is skipped instead
 * of writing a value that silently fails every later comparison.
 *
 * @returns {string} YYYY-MM-DD, or '' when unparseable
 */
function parseCityPairDate_(value) {
  var s = String(value || '').trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  var mm = m[1].length === 1 ? '0' + m[1] : m[1];
  var dd = m[2].length === 1 ? '0' + m[2] : m[2];
  return m[3] + '-' + mm + '-' + dd;
}

/**
 * Fare value as a number, with 0 and blank both meaning NOT AWARDED.
 *
 * In the source data a 0 in BUSINESS_FARE means that cabin was not awarded on
 * the route — not that it is free. Returning 0 here is correct, but every
 * consumer must treat 0 as "unavailable"; pre-filling $0.00 would look like a
 * valid estimate. CityPairs.js is responsible for that distinction.
 */
function parseFare_(value) {
  var n = parseFloat(String(value || '').replace(/[$,]/g, ''));
  return isNaN(n) || n < 0 ? 0 : n;
}

/**
 * Downloads the current fiscal year's CSV and replaces the City_Pairs tab.
 *
 * REPLACE, not merge. GSA rewrites the whole file daily and rows can be
 * withdrawn; merging would leave retired routes in place forever, quoting
 * fares that no longer exist.
 *
 * @returns {Object} { success, rowsParsed, rowsWritten, rowsSkipped, fiscalYear, durationMs, error? }
 * @editor
 * @trigger
 */
function syncCityPairs() {
  var started = Date.now();
  var url = getCityPairCsvUrl_();
  var fy = (url.match(/awards_(\d{4})/) || [])[1] || '';
  var summary = {
    success: false, rowsParsed: 0, rowsWritten: 0, rowsSkipped: 0,
    fiscalYear: fy, sourceUrl: url, durationMs: 0
  };

  try {
    if (!TRAVEL_DB_SPREADSHEET_ID) {
      throw new Error('TRAVEL_DB_SPREADSHEET_ID is not set in Script Properties.');
    }

    console.log('syncCityPairs: fetching ' + url);
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = response.getResponseCode();
    if (code !== 200) {
      throw new Error('GSA returned HTTP ' + code + ' for ' + url +
        '. If the fiscal year rolled over, confirm the file exists; if GSA ' +
        'moved it, update the CITY_PAIR_CSV_URL_TEMPLATE Script Property.');
    }

    var rows = Utilities.parseCsv(response.getContentText());
    if (!rows || rows.length < 2) {
      throw new Error('CSV had no data rows (got ' + (rows ? rows.length : 0) + ').');
    }

    // Resolve every index by header name. A missing column is fatal rather
    // than silently blank, because a blank YCA_Fare would read as $0 and look
    // like a free flight.
    var headers = rows[0].map(function (h) { return String(h || '').trim(); });
    var idx = {};
    Object.keys(CITY_PAIR_CSV_COLUMNS).forEach(function (k) {
      var col = CITY_PAIR_CSV_COLUMNS[k];
      var at = headers.indexOf(col);
      if (at === -1) {
        throw new Error('Expected column "' + col + '" not found in the GSA CSV. ' +
          'Headers were: ' + headers.join(', '));
      }
      idx[k] = at;
    });

    summary.rowsParsed = rows.length - 1;

    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var origin = String(row[idx.ORIGIN_ABBREV] || '').trim().toUpperCase();
      var dest = String(row[idx.DEST_ABBREV] || '').trim().toUpperCase();
      var yca = parseFare_(row[idx.YCA_FARE]);

      // Skip rows that cannot be looked up or priced. A row with no YCA fare
      // is unusable for the pre-fill, which is YCA-based by policy.
      if (!origin || !dest || yca <= 0) {
        summary.rowsSkipped++;
        continue;
      }

      out.push([
        buildPairKey_(origin, dest),
        String(row[idx.AWARD_YEAR] || '').trim(),
        origin,
        dest,
        String(row[idx.ORIGIN_CITY] || '').trim(),
        String(row[idx.ORIGIN_STATE] || '').trim(),
        String(row[idx.ORIGIN_COUNTRY] || '').trim(),
        String(row[idx.DEST_CITY] || '').trim(),
        String(row[idx.DEST_STATE] || '').trim(),
        String(row[idx.DEST_COUNTRY] || '').trim(),
        String(row[idx.AIRLINE] || '').trim().toUpperCase(),
        yca,
        parseFare_(row[idx.CA_FARE]),
        parseFare_(row[idx.BUSINESS_FARE]),
        parseCityPairDate_(row[idx.EFFECTIVE_DATE]),
        parseCityPairDate_(row[idx.EXPIRATION_DATE])
      ]);
    }

    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.CITY_PAIRS);
    if (!sheet) {
      throw new Error('Tab "' + SHEET_NAMES.CITY_PAIRS +
        '" not found. Run setupTravelDatabase() first.');
    }

    var headerRow = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.CITY_PAIRS];
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, headerRow.length).clearContent();
    }

    // One setValues for ~17k rows. Writing row-by-row would exceed the
    // 6-minute execution cap by a wide margin.
    if (out.length) {
      sheet.getRange(2, 1, out.length, headerRow.length).setValues(out);
    }
    summary.rowsWritten = out.length;

    // Any cached index is now stale.
    invalidateCityPairCache();

    summary.success = true;
    summary.durationMs = Date.now() - started;
    console.log('syncCityPairs: wrote ' + summary.rowsWritten + ' rows, skipped ' +
      summary.rowsSkipped + ' in ' + summary.durationMs + 'ms');

  } catch (error) {
    summary.error = error.message;
    summary.durationMs = Date.now() - started;
    console.error('syncCityPairs failed: ' + error.message);
  }

  logCityPairSync_(summary);
  return summary;
}

/** Appends one row to City_Pair_Sync_Log. Never throws. */
function logCityPairSync_(summary) {
  try {
    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.CITY_PAIR_SYNC_LOG);
    if (!sheet) return;
    sheet.appendRow([
      'CPS-' + Date.now(),
      new Date(),
      summary.fiscalYear || '',
      summary.sourceUrl || '',
      summary.rowsParsed || 0,
      summary.rowsWritten || 0,
      summary.rowsSkipped || 0,
      summary.success ? 'SUCCESS' : 'FAILED',
      summary.error || '',
      summary.durationMs || 0
    ]);
  } catch (e) {
    console.warn('logCityPairSync_ failed: ' + e.message);
  }
}

/**
 * Installs the daily sync trigger at 05:00 project time.
 *
 * GSA rewrites the file after 23:59 ET; 05:00 leaves margin without being so
 * late that a weekday user hits stale data. Removes any existing trigger for
 * this handler first, so running it twice does not produce two syncs a day.
 *
 * @editor
 */
function installCityPairSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncCityPairs') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncCityPairs').timeBased().atHour(5).everyDays(1).create();
  console.log('installCityPairSyncTrigger: daily at ~05:00 project time');
  return { success: true };
}
