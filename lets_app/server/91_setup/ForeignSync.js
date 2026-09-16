/**
 * ForeignPerDiemSync.js
 * Automated sync of State Department Foreign Per Diem rates
 *
 * Data source: https://aoprals.state.gov/content/Documents/{Month}{Year}PD.xls
 * Updated monthly on the 1st of each month
 *
 * Usage:
 * - syncForeignPerDiem() - Sync current month's data (checks if already synced)
 * - forceSyncForeignPerDiem() - Force re-sync current month
 * - syncForeignPerDiemForMonth(month, year) - Sync specific month
 * - setupForeignPerDiemTrigger() - Set up monthly auto-sync
 */

// =============================================================================
// CONSTANTS
// =============================================================================

const DOS_PERDIEM_SHEET_NAME = 'Foreign_Per_Diem';
const DOS_SYNC_TRACKER_SHEET = 'DOS_Sync_Tracker';

const DOS_BASE_URL = 'https://aoprals.state.gov/content/Documents';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// =============================================================================
// DATA CLEANUP FUNCTIONS (Applied at sync time for clean storage)
// =============================================================================

/**
 * Convert string to proper case (Title Case)
 * Handles special cases like "of", "the", "and" staying lowercase mid-string
 * @param {string} str - Input string (often ALL CAPS from DOS data)
 * @returns {string} Proper case string
 */
function toProperCase_(str) {
  if (!str) return '';

  const smallWords = ['of', 'the', 'and', 'in', 'on', 'at', 'to', 'for', 'a', 'an'];

  return str.toLowerCase()
    .split(' ')
    .map((word, index) => {
      // Always capitalize first word, otherwise check if it's a small word
      if (index === 0 || !smallWords.includes(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word;
    })
    .join(' ');
}

/**
 * Normalize country name - fixes inverted names and converts to proper case
 * Applied at sync time so data is stored clean
 * @param {string} rawName - Raw country name from DOS Excel (often ALL CAPS)
 * @returns {string} Normalized country name
 */
function normalizeCountryName_(rawName) {
  if (!rawName) return '';

  let name = rawName.toString().trim();

  // Special case mappings for DOS naming conventions
  const specialMappings = {
    'KOREA, SOUTH': 'South Korea',
    'KOREA, REPUBLIC OF': 'South Korea',
    'KOREA, DEMOCRATIC PEOPLE\'S REPUBLIC OF': 'North Korea',
    'KOREA, NORTH': 'North Korea',
    'CONGO, DEMOCRATIC REPUBLIC OF THE': 'Democratic Republic of the Congo',
    'CONGO, REPUBLIC OF THE': 'Republic of the Congo',
    'MICRONESIA, FEDERATED STATES OF': 'Federated States of Micronesia',
    'VIRGIN ISLANDS, BRITISH': 'British Virgin Islands',
    'VIRGIN ISLANDS, U.S.': 'U.S. Virgin Islands',
    'TAIWAN (UNOFFICIAL)': 'Taiwan',
    'HOLY SEE': 'Vatican City',
    'RUSSIAN FEDERATION': 'Russia',
    'IRAN, ISLAMIC REPUBLIC OF': 'Iran',
    'SYRIAN ARAB REPUBLIC': 'Syria',
    'LAO PEOPLE\'S DEMOCRATIC REPUBLIC': 'Laos',
    'VIET NAM': 'Vietnam',
    'BRUNEI DARUSSALAM': 'Brunei',
    'COTE D\'IVOIRE': 'Ivory Coast',
    'TIMOR-LESTE': 'East Timor',
    'ESWATINI': 'Eswatini',
    'CABO VERDE': 'Cape Verde',
    'TÜRKIYE': 'Turkey',
    'TANZANIA, UNITED REPUBLIC OF': 'Tanzania',
    'BOLIVIA, PLURINATIONAL STATE OF': 'Bolivia',
    'VENEZUELA, BOLIVARIAN REPUBLIC OF': 'Venezuela',
    'MOLDOVA, REPUBLIC OF': 'Moldova',
    'MACEDONIA, NORTH': 'North Macedonia',
    'PALESTINE, STATE OF': 'Palestine'
  };

  // Check special mappings first (case-insensitive)
  // These are for names that need specific wording, not just flipping
  const upperName = name.toUpperCase();
  if (specialMappings[upperName]) {
    return specialMappings[upperName];
  }

  // Handle inverted names with ", THE" suffix
  // e.g., "BAHAMAS, THE" → "The Bahamas"
  if (upperName.endsWith(', THE')) {
    name = 'The ' + name.slice(0, -5);
    return toProperCase_(name);
  }

  // Handle other inverted patterns like "COUNTRY, REPUBLIC OF"
  const invertedPatterns = [
    { pattern: /^(.+),\s*(REPUBLIC OF)$/i, format: (m) => `Republic of ${m[1]}` },
    { pattern: /^(.+),\s*(KINGDOM OF)$/i, format: (m) => `Kingdom of ${m[1]}` },
    { pattern: /^(.+),\s*(STATE OF)$/i, format: (m) => `State of ${m[1]}` },
    { pattern: /^(.+),\s*(FEDERATION OF)$/i, format: (m) => `Federation of ${m[1]}` },
    { pattern: /^(.+),\s*(EMIRATE OF)$/i, format: (m) => `Emirate of ${m[1]}` },
    { pattern: /^(.+),\s*(SULTANATE OF)$/i, format: (m) => `Sultanate of ${m[1]}` }
  ];

  for (const { pattern, format } of invertedPatterns) {
    const match = name.match(pattern);
    if (match) {
      return toProperCase_(format(match));
    }
  }

  // General rule: If there's exactly one comma, flip the parts
  // e.g., "KOREA, SOUTH" → "South Korea"
  // e.g., "SAMOA, WESTERN" → "Western Samoa"
  const commaCount = (name.match(/,/g) || []).length;
  if (commaCount === 1) {
    const parts = name.split(',').map(p => p.trim());
    if (parts.length === 2 && parts[0] && parts[1]) {
      name = parts[1] + ' ' + parts[0];
      return toProperCase_(name);
    }
  }

  // Convert to proper case if ALL CAPS
  if (name === name.toUpperCase() && name.length > 2) {
    return toProperCase_(name);
  }

  return name;
}

/**
 * Normalize location name - cleans up [Other] and converts to proper case
 * Applied at sync time so data is stored clean
 * @param {string} rawLocation - Raw location name from DOS Excel
 * @returns {string} Normalized location name
 */
function normalizeLocationName_(rawLocation) {
  if (!rawLocation) return '';

  let location = rawLocation.toString().trim();

  // Clean up [Other] to something nicer
  if (location === '[Other]' || location.toUpperCase() === '[OTHER]') {
    return 'Other locations';
  }

  // Convert to proper case if ALL CAPS
  if (location === location.toUpperCase() && location.length > 2) {
    return toProperCase_(location);
  }

  return location;
}

// Column mapping from Excel to our sheet format
// Excel columns (first tab): Country, Post Name, Season, Begin Date, End Date, Lodging, M&IE, Local Meals, Prop Meals, Footnote, Location Code, Eff Date
// Our columns: Country (A), Location (B), Season Code (C), Season Start (D), Season End (E), Lodging (F), M&IE (G), Per Diem (H), Effective Date (I), Footnote (J), Location Code (K)

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Sync current month's foreign per diem data
 * Checks if already synced to avoid duplicate work
 * @returns {Object} Result with success status and message
 */
function syncForeignPerDiem() {
  const now = new Date();
  const month = now.getMonth(); // 0-based
  const year = now.getFullYear();
  const monthName = MONTH_NAMES[month];

  console.log(`Checking for ${monthName} ${year} DOS per diem update...`);

  // Check if already synced this month
  if (isDOSAlreadySynced_(monthName, year)) {
    console.log(`Already synced ${monthName} ${year} data`);
    return {
      success: true,
      message: `Already synced ${monthName} ${year} data`,
      alreadySynced: true
    };
  }

  return syncForeignPerDiemForMonth(month, year);
}

/**
 * Force re-sync current month (bypasses sync check)
 * @returns {Object} Result with success status
 */
function forceSyncForeignPerDiem() {
  const now = new Date();
  return syncForeignPerDiemForMonth(now.getMonth(), now.getFullYear());
}

/**
 * Sync foreign per diem data for a specific month
 * @param {number} month - 0-based month (0=January, 11=December)
 * @param {number} year - 4-digit year
 * @returns {Object} Result with success status
 */
function syncForeignPerDiemForMonth(month, year) {
  const monthName = MONTH_NAMES[month];
  const fileName = `${monthName}${year}PD.xls`;
  const url = `${DOS_BASE_URL}/${fileName}`;

  console.log(`Fetching DOS per diem from: ${url}`);

  try {
    // Fetch the Excel file
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true
    });

    const responseCode = response.getResponseCode();
    if (responseCode !== 200) {
      console.error(`Failed to fetch ${fileName}: HTTP ${responseCode}`);
      return {
        success: false,
        error: `Failed to fetch ${fileName}: HTTP ${responseCode}`
      };
    }

    const blob = response.getBlob();
    console.log(`Downloaded ${fileName} (${blob.getBytes().length} bytes)`);

    // Parse the Excel file
    const perDiemData = parseExcelBlob_(blob, fileName);

    if (!perDiemData || perDiemData.length === 0) {
      return {
        success: false,
        error: 'No data parsed from Excel file'
      };
    }

    console.log(`Parsed ${perDiemData.length} per diem records`);

    // Write to sheet
    const writeResult = writeDOSPerDiemToSheet_(perDiemData, monthName, year);

    if (writeResult.success) {
      // Record successful sync
      recordDOSSync_(monthName, year, perDiemData.length);
    }

    return writeResult;

  } catch (error) {
    console.error('Error syncing DOS per diem:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
// =============================================================================
// EXCEL PARSING
// =============================================================================

/**
 * Parse Excel blob by converting to Google Sheet temporarily
 * @param {Blob} blob - Excel file blob
 * @param {string} fileName - Original filename for logging
 * @returns {Array} Array of per diem records
 */
function parseExcelBlob_(blob, fileName) {
  let tempFile = null;
  let tempSpreadsheet = null;

  try {
    // Upload Excel file to Drive and convert to Google Sheet
    tempFile = Drive.Files.create(
      {
        name: `TEMP_DOS_PerDiem_${Date.now()}`,
        mimeType: 'application/vnd.google-apps.spreadsheet'
      },
      blob
    );

    console.log(`Created temp spreadsheet: ${tempFile.id}`);

    // Open the converted spreadsheet
    tempSpreadsheet = SpreadsheetApp.openById(tempFile.id);
    const sheets = tempSpreadsheet.getSheets();

    if (sheets.length === 0) {
      throw new Error('No sheets found in Excel file');
    }

    // Get first sheet only (as user specified)
    const firstSheet = sheets[0];
    console.log(`Reading first sheet: "${firstSheet.getName()}"`);

    const data = firstSheet.getDataRange().getValues();
    console.log(`Found ${data.length} rows in first sheet`);

    // Parse the data
    const records = parsePerDiemRows_(data);

    return records;

  } finally {
    // Clean up temp file
    if (tempFile && tempFile.id) {
      try {
        Drive.Files.remove(tempFile.id);
        console.log('Cleaned up temp spreadsheet');
      } catch (e) {
        console.warn('Could not delete temp file:', e);
      }
    }
  }
}

/**
 * Parse per diem rows from Excel data
 * @param {Array} data - 2D array of sheet data
 * @returns {Array} Array of per diem record objects
 */
function parsePerDiemRows_(data) {
  const records = [];

  // Find header row (look for "Country" in first column)
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const firstCell = (data[i][0] || '').toString().trim().toUpperCase();
    if (firstCell === 'COUNTRY' || firstCell.includes('COUNTRY')) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    console.warn('Could not find header row, assuming row 0 is header');
    headerRowIndex = 0;
  }

  const headers = data[headerRowIndex].map(h => (h || '').toString().trim().toUpperCase());
  console.log('Headers found:', headers.slice(0, 12).join(', '));

  // Map column indices based on headers
  const colMap = {
    country: findColumnIndex_(headers, ['COUNTRY']),
    location: findColumnIndex_(headers, ['POST NAME', 'POST', 'LOCATION', 'CITY']),
    season: findColumnIndex_(headers, ['SEASON', 'SEASON CODE', 'SEA']),
    seasonStart: findColumnIndex_(headers, ['BEGIN DATE', 'BEGIN', 'START DATE', 'SEASON BEGIN']),
    seasonEnd: findColumnIndex_(headers, ['END DATE', 'END', 'SEASON END']),
    lodging: findColumnIndex_(headers, ['LODGING', 'MAX LODGING']),
    mie: findColumnIndex_(headers, ['M&IE', 'MIE', 'MEALS', 'M & IE']),
    localMeals: findColumnIndex_(headers, ['LOCAL MEALS', 'LOCAL']),
    propMeals: findColumnIndex_(headers, ['PROP MEALS', 'PROPORTIONAL', 'PROP']),
    footnote: findColumnIndex_(headers, ['FOOTNOTE', 'NOTE', 'NOTES', 'FN']),
    locationCode: findColumnIndex_(headers, ['LOCATION CODE', 'LOC CODE', 'CODE']),
    effectiveDate: findColumnIndex_(headers, ['EFF DATE', 'EFFECTIVE', 'EFFECTIVE DATE'])
  };

  console.log('Column mapping:', JSON.stringify(colMap));

  // Process data rows
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];

    // Skip empty rows
    const country = (row[colMap.country] || '').toString().trim();
    if (!country) continue;

    // Skip rows that look like headers or totals
    if (country.toUpperCase() === 'COUNTRY' || country.toUpperCase().includes('TOTAL')) continue;

    const rawLocation = (row[colMap.location] || '').toString().trim() || '[Other]';
    const lodging = parseNumber_(row[colMap.lodging]);
    const mie = parseNumber_(row[colMap.mie]);

    // Calculate per diem (lodging + M&IE)
    const perDiem = lodging + mie;

    // Apply cleanup at sync time - data stored clean in sheet
    const cleanCountry = normalizeCountryName_(country);
    const cleanLocation = normalizeLocationName_(rawLocation);

    records.push({
      country: cleanCountry,
      location: cleanLocation,
      seasonCode: (row[colMap.season] || 'S1').toString().trim(),
      seasonStart: formatDateValue_(row[colMap.seasonStart]),
      seasonEnd: formatDateValue_(row[colMap.seasonEnd]),
      lodging: lodging,
      mie: mie,
      perDiem: perDiem,
      effectiveDate: formatDateValue_(row[colMap.effectiveDate]),
      footnote: (row[colMap.footnote] || '').toString().trim(),
      locationCode: (row[colMap.locationCode] || '').toString().trim()
    });
  }

  console.log(`Parsed ${records.length} per diem records`);
  return records;
}

/**
 * Find column index by possible header names
 */
function findColumnIndex_(headers, possibleNames) {
  for (const name of possibleNames) {
    const index = headers.findIndex(h => h === name || h.includes(name));
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Parse a number from various formats
 */
function parseNumber_(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;

  const str = value.toString().replace(/[$,\s]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Format date value for storage
 */
function formatDateValue_(value) {
  if (!value) return '';

  if (value instanceof Date) {
    const month = value.getMonth() + 1;
    const day = value.getDate();
    return `${month}/${day}`;
  }

  // If it's already a string like "01/15", return as-is
  const str = value.toString().trim();
  if (/^\d{1,2}\/\d{1,2}/.test(str)) {
    // Extract just MM/DD part
    const match = str.match(/^(\d{1,2})\/(\d{1,2})/);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  }

  return str;
}

// =============================================================================
// SHEET OPERATIONS
// =============================================================================

/**
 * Write per diem data to the Foreign_Per_Diem sheet
 */
function writeDOSPerDiemToSheet_(records, monthName, year) {
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(DOS_PERDIEM_SHEET_NAME);

    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(DOS_PERDIEM_SHEET_NAME);
      console.log(`Created new sheet: ${DOS_PERDIEM_SHEET_NAME}`);
    }

    // Clear existing data (keep header)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 11).clearContent();
    }

    // Set headers if sheet is empty
    if (sheet.getLastRow() === 0) {
      const headers = [
        'Country', 'Location', 'Season Code', 'Season Start', 'Season End',
        'Lodging', 'M&IE', 'Per Diem', 'Effective Date', 'Footnote', 'Location Code'
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }

    // Prepare data rows
    const rows = records.map(r => [
      r.country,
      r.location,
      r.seasonCode,
      r.seasonStart,
      r.seasonEnd,
      r.lodging,
      r.mie,
      r.perDiem,
      r.effectiveDate,
      r.footnote,
      r.locationCode
    ]);

    // Write data
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, 11).setValues(rows);
    }

    // Clear cache so fresh data is used
    try {
      const cache = CacheService.getScriptCache();
      cache.remove('foreign_perdiem_all_data');
      cache.remove('foreign_perdiem_countries');
    } catch (e) {
      console.warn('Could not clear cache:', e);
    }

    console.log(`Wrote ${rows.length} records to ${DOS_PERDIEM_SHEET_NAME}`);

    return {
      success: true,
      message: `Synced ${rows.length} DOS per diem records for ${monthName} ${year}`,
      recordCount: rows.length
    };

  } catch (error) {
    console.error('Error writing DOS per diem to sheet:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Check if already synced for given month/year
 */
function isDOSAlreadySynced_(monthName, year) {
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    let trackerSheet = ss.getSheetByName(DOS_SYNC_TRACKER_SHEET);

    if (!trackerSheet) return false;

    const data = trackerSheet.getDataRange().getValues();
    const syncKey = `${monthName}${year}`;

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === syncKey) {
        return true;
      }
    }

    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Record successful sync and update version timestamp
 */
function recordDOSSync_(monthName, year, recordCount) {
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    let trackerSheet = ss.getSheetByName(DOS_SYNC_TRACKER_SHEET);

    // Create tracker sheet if it doesn't exist
    if (!trackerSheet) {
      trackerSheet = ss.insertSheet(DOS_SYNC_TRACKER_SHEET);
      trackerSheet.getRange(1, 1, 1, 4).setValues([['Sync Key', 'Synced At', 'Record Count', 'Source URL']]);
      trackerSheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    }

    const syncKey = `${monthName}${year}`;
    const sourceUrl = `${DOS_BASE_URL}/${monthName}${year}PD.xls`;
    const syncTimestamp = new Date().toISOString();

    trackerSheet.appendRow([syncKey, new Date(), recordCount, sourceUrl]);

    // Update version timestamp in Script Properties for client cache invalidation
    setDOSLastSync(syncTimestamp);

    console.log(`Recorded sync: ${syncKey}, version: ${syncTimestamp}`);
  } catch (e) {
    console.warn('Could not record sync:', e);
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get sync status - useful for checking what's been synced
 */
function getDOSSyncStatus() {
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    const trackerSheet = ss.getSheetByName(DOS_SYNC_TRACKER_SHEET);

    if (!trackerSheet) {
      return { success: true, syncs: [], message: 'No syncs recorded yet' };
    }

    const data = trackerSheet.getDataRange().getValues();
    const syncs = [];

    for (let i = 1; i < data.length; i++) {
      syncs.push({
        syncKey: data[i][0],
        syncedAt: data[i][1],
        recordCount: data[i][2],
        sourceUrl: data[i][3]
      });
    }

    return {
      success: true,
      syncs: syncs,
      latestSync: syncs.length > 0 ? syncs[syncs.length - 1] : null
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Clear sync tracker (for testing/reset)
 */
function clearDOSSyncTracker() {
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    const trackerSheet = ss.getSheetByName(DOS_SYNC_TRACKER_SHEET);

    if (trackerSheet) {
      ss.deleteSheet(trackerSheet);
      console.log('Deleted DOS sync tracker sheet');
    }

    return { success: true, message: 'Sync tracker cleared' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
