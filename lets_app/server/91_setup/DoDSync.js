/**
 * DoDPerDiemSync.js
 * Automated sync service for DoD OCONUS Per Diem rates from Federal Register
 *
 * Data source: Federal Register API
 * Search: "Civilian Personnel Per Diem Bulletin" from Defense Department
 * Covers: Alaska, Hawaii, Puerto Rico, U.S. Virgin Islands, Guam, and other territories
 *
 * XML Structure:
 * <ROW>
 *   <ENT I="01">ALASKA</ENT>     <!-- Territory -->
 *   <ENT>ANCHORAGE</ENT>         <!-- Locality -->
 *   <ENT>04/01</ENT>             <!-- Season Start -->
 *   <ENT>09/30</ENT>             <!-- Season End -->
 *   <ENT>329</ENT>               <!-- Lodging -->
 *   <ENT>148</ENT>               <!-- M&IE -->
 *   <ENT>477</ENT>               <!-- Total Per Diem -->
 *   <ENT>01/01/2026</ENT>        <!-- Effective Date -->
 * </ROW>
 */

// =============================================================================
// CONSTANTS
// =============================================================================

const DOD_PERDIEM_SHEET_NAME = 'DoD_Per_Diem';
const DOD_SYNC_LOG_SHEET_NAME = 'DoD_Sync_Log';

// Federal Register API endpoints
const FEDERAL_REGISTER_API_BASE = 'https://www.federalregister.gov/api/v1';
const FEDERAL_REGISTER_SEARCH_TERM = '"Civilian Personnel Per Diem Bulletin"';

// Territory keywords to identify relevant bulletins
const OCONUS_TERRITORIES = ['alaska', 'hawaii', 'puerto rico', 'virgin islands', 'guam', 'american samoa', 'midway', 'northern mariana', 'wake island'];

// =============================================================================
// DATA CLEANUP FUNCTIONS (Applied at sync time for clean storage)
// =============================================================================

/**
 * Convert string to proper case (Title Case)
 * @param {string} str - Input string (often ALL CAPS from DoD data)
 * @returns {string} Proper case string
 */
function toDoDProperCase_(str) {
  if (!str) return '';

  const smallWords = ['of', 'the', 'and', 'in', 'on', 'at', 'to', 'for', 'a', 'an'];

  return str.toLowerCase()
    .split(' ')
    .map((word, index) => {
      if (index === 0 || !smallWords.includes(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word;
    })
    .join(' ');
}

// Territory name normalization mapping
const TERRITORY_DISPLAY_NAMES = {
  'ALASKA': 'Alaska',
  'HAWAII': 'Hawaii',
  'PUERTO RICO': 'Puerto Rico',
  'VIRGIN ISLANDS': 'U.S. Virgin Islands',
  'U.S. VIRGIN ISLANDS': 'U.S. Virgin Islands',
  'US VIRGIN ISLANDS': 'U.S. Virgin Islands',
  'VIRGIN ISLANDS (U.S.)': 'U.S. Virgin Islands',
  'GUAM': 'Guam',
  'AMERICAN SAMOA': 'American Samoa',
  'NORTHERN MARIANA ISLANDS': 'Northern Mariana Islands',
  'CNMI': 'Northern Mariana Islands',
  'MIDWAY ISLANDS': 'Midway Islands',
  'MIDWAY': 'Midway Islands',
  'WAKE ISLAND': 'Wake Island',
  'WAKE': 'Wake Island'
};

/**
 * Normalize territory name - converts to proper display name
 * Applied at sync time so data is stored clean
 * @param {string} rawTerritory - Raw territory name from DoD XML (often ALL CAPS)
 * @returns {string} Normalized territory name
 */
function normalizeTerritoryName_(rawTerritory) {
  if (!rawTerritory) return '';

  const territory = rawTerritory.toString().trim().toUpperCase();

  // Check explicit mapping first
  if (TERRITORY_DISPLAY_NAMES[territory]) {
    return TERRITORY_DISPLAY_NAMES[territory];
  }

  // Fallback to proper case conversion
  return toDoDProperCase_(rawTerritory);
}

/**
 * Normalize locality name - converts to proper case
 * Applied at sync time so data is stored clean
 * @param {string} rawLocality - Raw locality name from DoD XML
 * @returns {string} Normalized locality name
 */
function normalizeLocalityName_(rawLocality) {
  if (!rawLocality) return '';

  let locality = rawLocality.toString().trim();

  // Handle special patterns
  const upperLocality = locality.toUpperCase();

  // Standard rate keywords
  if (upperLocality === 'STANDARD RATE' || upperLocality === 'STANDARD') {
    return 'Standard Rate';
  }

  // "Other" patterns - match Foreign_Per_Diem behavior
  if (upperLocality === 'OTHER' || upperLocality === '[OTHER]') {
    return 'Other locations';
  }

  // Convert ALL CAPS to proper case
  if (locality === locality.toUpperCase() && locality.length > 2) {
    return toDoDProperCase_(locality);
  }

  return locality;
}

// Column indices for DoD_Per_Diem sheet (0-based)
const DOD_COL = {
  TERRITORY: 0,
  LOCALITY: 1,
  SEASON_START: 2,
  SEASON_END: 3,
  LODGING: 4,
  MIE: 5,
  PERDIEM: 6,
  EFFECTIVE_DATE: 7,
  DOCUMENT_NUMBER: 8
};

// =============================================================================
// SHEET ACCESS
// =============================================================================

/**
 * Get the DoD Per Diem sheet
 */
function getDoDPerDiemSheet_() {
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(DOD_PERDIEM_SHEET_NAME);

    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(DOD_PERDIEM_SHEET_NAME);
      // Add headers
      sheet.getRange(1, 1, 1, 9).setValues([[
        'Territory', 'Locality', 'Season Start', 'Season End',
        'Lodging', 'MIE', 'Per Diem', 'Effective Date', 'Document Number'
      ]]);
      sheet.setFrozenRows(1);
      console.log('Created DoD_Per_Diem sheet with headers');
    }

    return sheet;
  } catch (error) {
    console.error('Error accessing DoD Per Diem sheet:', error);
    return null;
  }
}

/**
 * Get or create sync log sheet
 */
function getSyncLogSheet_() {
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(DOD_SYNC_LOG_SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(DOD_SYNC_LOG_SHEET_NAME);
      sheet.getRange(1, 1, 1, 5).setValues([[
        'Timestamp', 'Document Number', 'Territory', 'Rows Added', 'Status'
      ]]);
      sheet.setFrozenRows(1);
    }

    return sheet;
  } catch (error) {
    console.error('Error accessing sync log sheet:', error);
    return null;
  }
}

// =============================================================================
// FEDERAL REGISTER API
// =============================================================================

/**
 * Search Federal Register for latest per diem bulletins
 * @returns {Array} Array of bulletin metadata
 */
function searchLatestBulletins_() {
  const url = `${FEDERAL_REGISTER_API_BASE}/documents.json?` +
    `conditions[term]=${encodeURIComponent(FEDERAL_REGISTER_SEARCH_TERM)}` +
    `&conditions[agencies][]=defense-department` +
    `&per_page=20&order=newest`;

  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'Accept': 'application/json' }
    });

    if (response.getResponseCode() !== 200) {
      console.error('Federal Register API error:', response.getResponseCode());
      return [];
    }

    const data = JSON.parse(response.getContentText());
    return data.results || [];
  } catch (error) {
    console.error('Error searching Federal Register:', error);
    return [];
  }
}

/**
 * Fetch XML content for a specific document
 * @param {string} documentNumber - e.g., "2025-24066"
 * @param {string} publicationDate - e.g., "2025-12-31"
 * @returns {string} XML content
 */
function fetchDocumentXML_(documentNumber, publicationDate) {
  // Parse date to build URL path
  const dateParts = publicationDate.split('-');
  const year = dateParts[0];
  const month = dateParts[1];
  const day = dateParts[2];

  const url = `https://www.federalregister.gov/documents/full_text/xml/${year}/${month}/${day}/${documentNumber}.xml`;

  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      console.error('Failed to fetch XML:', response.getResponseCode(), url);
      return null;
    }

    return response.getContentText();
  } catch (error) {
    console.error('Error fetching document XML:', error);
    return null;
  }
}

// =============================================================================
// XML PARSING
// =============================================================================

/**
 * Parse per diem rates from Federal Register XML
 * @param {string} xmlContent - Raw XML content
 * @param {string} documentNumber - Document number for tracking
 * @returns {Array} Array of rate objects
 */
function parsePerDiemXML_(xmlContent, documentNumber) {
  const rates = [];

  try {
    const document = XmlService.parse(xmlContent);
    const root = document.getRootElement();

    // Find all GPOTABLE elements (rate tables)
    const tables = findElementsByName_(root, 'GPOTABLE');

    for (const table of tables) {
      const rows = findElementsByName_(table, 'ROW');
      let currentTerritory = '';

      for (const row of rows) {
        const cells = findElementsByName_(row, 'ENT');

        if (cells.length >= 8) {
          // Extract cell values
          const cellValues = cells.map(cell => cell.getText().trim());

          // First cell might have territory or be continuation
          const firstCell = cellValues[0];
          const hasAttribute = cells[0].getAttribute('I');

          // If first cell has I="01" attribute, it's a territory header
          if (hasAttribute && hasAttribute.getValue() === '01' && firstCell) {
            currentTerritory = firstCell.toUpperCase();
          }

          // Skip header rows or rows without proper data
          if (!currentTerritory || isHeaderRow_(cellValues)) {
            continue;
          }

          // Parse the rate row
          const rate = parseRateRow_(cellValues, currentTerritory, documentNumber);
          if (rate) {
            rates.push(rate);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error parsing XML:', error);
  }

  return rates;
}

/**
 * Recursively find elements by tag name
 */
function findElementsByName_(element, tagName) {
  const results = [];

  if (element.getName() === tagName) {
    results.push(element);
  }

  const children = element.getChildren();
  for (const child of children) {
    results.push(...findElementsByName_(child, tagName));
  }

  return results;
}

/**
 * Check if row is a header row
 */
function isHeaderRow_(cellValues) {
  const headerKeywords = ['locality', 'lodging', 'season', 'effective', 'm&ie', 'maximum'];
  const firstCell = (cellValues[0] || '').toLowerCase();
  return headerKeywords.some(kw => firstCell.includes(kw));
}

/**
 * Parse a single rate row
 * @param {Array} cellValues - Array of cell text values
 * @param {string} territory - Current territory name
 * @param {string} documentNumber - Source document number
 * @returns {Object} Rate object or null
 */
function parseRateRow_(cellValues, territory, documentNumber) {
  try {
    // Cell order: [Territory/Locality, Locality/SeasonStart, SeasonStart/SeasonEnd, ...]
    // The first cell might be territory (already captured) or locality

    let locality, seasonStart, seasonEnd, lodging, mie, perDiem, effectiveDate;

    // Determine offset based on whether first cell is territory or locality
    const firstCellIsTerritory = cellValues[0].toUpperCase() === territory;
    const offset = firstCellIsTerritory ? 1 : 0;

    locality = cellValues[offset] || '';
    seasonStart = cellValues[offset + 1] || '';
    seasonEnd = cellValues[offset + 2] || '';
    lodging = cleanNumericValue_(cellValues[offset + 3]);
    mie = cleanNumericValue_(cellValues[offset + 4]);
    perDiem = cleanNumericValue_(cellValues[offset + 5]);
    effectiveDate = cellValues[offset + 6] || '';

    // Validate we have required data
    if (!locality || lodging === null || mie === null) {
      return null;
    }

    // Skip if locality looks like a header or is empty
    if (locality.toLowerCase().includes('locality') || locality === '') {
      return null;
    }

    // Apply cleanup at sync time - data stored clean in sheet
    const cleanTerritory = normalizeTerritoryName_(territory);
    const cleanLocality = normalizeLocalityName_(locality);

    return {
      territory: cleanTerritory,
      locality: cleanLocality,
      seasonStart: seasonStart,
      seasonEnd: seasonEnd,
      lodging: lodging,
      mie: mie,
      perDiem: perDiem,
      effectiveDate: effectiveDate,
      documentNumber: documentNumber
    };
  } catch (error) {
    console.error('Error parsing rate row:', error, cellValues);
    return null;
  }
}

/**
 * Clean numeric value, removing $ and * markers
 */
function cleanNumericValue_(value) {
  if (!value) return null;
  const cleaned = value.replace(/[$*,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// =============================================================================
// SYNC FUNCTIONS
// =============================================================================

/**
 * Get currently synced document numbers from sheet
 * @returns {Set} Set of document numbers
 */
function getSyncedDocumentNumbers_() {
  const sheet = getDoDPerDiemSheet_();
  if (!sheet) return new Set();

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return new Set();

  const docNumbers = sheet.getRange(2, DOD_COL.DOCUMENT_NUMBER + 1, lastRow - 1, 1).getValues();
  return new Set(docNumbers.flat().filter(n => n));
}

/**
 * Identify territory from bulletin abstract/title
 * @param {Object} bulletin - Bulletin metadata from API
 * @returns {string} Territory name or null
 */
function identifyTerritory_(bulletin) {
  const searchText = ((bulletin.title || '') + ' ' + (bulletin.abstract || '')).toLowerCase();

  for (const territory of OCONUS_TERRITORIES) {
    if (searchText.includes(territory)) {
      return territory;
    }
  }

  return null;
}

/**
 * Sync a single bulletin to the sheet
 * @param {Object} bulletin - Bulletin metadata
 * @returns {Object} Sync result
 */
function syncBulletin_(bulletin) {
  const documentNumber = bulletin.document_number;
  const publicationDate = bulletin.publication_date;
  const territory = identifyTerritory_(bulletin);

  console.log(`Syncing bulletin ${documentNumber} for ${territory || 'unknown territory'}`);

  // Fetch XML
  const xml = fetchDocumentXML_(documentNumber, publicationDate);
  if (!xml) {
    return { success: false, error: 'Failed to fetch XML', documentNumber };
  }

  // Parse rates
  const rates = parsePerDiemXML_(xml, documentNumber);
  if (!rates.length) {
    return { success: false, error: 'No rates parsed from XML', documentNumber };
  }

  // Write to sheet
  const sheet = getDoDPerDiemSheet_();
  if (!sheet) {
    return { success: false, error: 'Sheet not accessible', documentNumber };
  }

  // Convert rates to row format
  const rows = rates.map(r => [
    r.territory,
    r.locality,
    r.seasonStart,
    r.seasonEnd,
    r.lodging,
    r.mie,
    r.perDiem,
    r.effectiveDate,
    r.documentNumber
  ]);

  // Append to sheet
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, 9).setValues(rows);

  console.log(`Added ${rows.length} rates from bulletin ${documentNumber}`);

  return {
    success: true,
    documentNumber: documentNumber,
    territory: territory,
    rowsAdded: rows.length
  };
}

/**
 * Log sync activity and update version timestamp
 */
function logSyncActivity_(result) {
  const logSheet = getSyncLogSheet_();
  if (!logSheet) return;

  const syncTimestamp = new Date().toISOString();

  logSheet.appendRow([
    new Date(),
    result.documentNumber || '',
    result.territory || '',
    result.rowsAdded || 0,
    result.success ? 'Success' : `Error: ${result.error}`
  ]);

  // Update version timestamp in Script Properties for client cache invalidation
  if (result.success) {
    setDoDLastSync(syncTimestamp);
    console.log(`DoD sync version updated: ${syncTimestamp}`);
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Check for and sync new DoD per diem bulletins
 * Call this from a time-based trigger (e.g., daily or weekly)
 *
 * Each bulletin contains the COMPLETE rate list for all OCONUS territories,
 * so we only need the single most recent bulletin.
 *
 * @returns {Object} Sync summary
 */
function syncDoDPerDiem() {
  console.log('Starting DoD per diem sync...');

  const bulletins = searchLatestBulletins_();

  if (!bulletins.length) {
    console.log('No bulletins found');
    return { success: false, error: 'No bulletins found' };
  }

  // Get the most recent bulletin (first in list since ordered by newest)
  const latestBulletin = bulletins[0];
  const latestDocNum = latestBulletin.document_number;

  // Check if we already have this bulletin synced
  const syncedDocs = getSyncedDocumentNumbers_();
  if (syncedDocs.has(latestDocNum)) {
    console.log(`Already synced latest bulletin: ${latestDocNum}`);
    return {
      success: true,
      message: 'Already up to date',
      currentBulletin: latestDocNum
    };
  }

  console.log(`New bulletin found: ${latestDocNum}, syncing...`);

  // Clear existing data and sync the new bulletin
  const sheet = getDoDPerDiemSheet_();
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).clearContent();
    console.log('Cleared old data');
  }

  // Sync the latest bulletin
  const syncResult = syncBulletin_(latestBulletin);
  logSyncActivity_(syncResult);

  if (syncResult.success) {
    console.log(`Sync complete: ${syncResult.rowsAdded} rates from bulletin ${latestDocNum}`);
  } else {
    console.error('Sync failed:', syncResult.error);
  }

  return syncResult;
}

/**
 * Force sync the latest bulletin (clears existing data first)
 * Use for initial setup or to refresh all data
 *
 * Since each bulletin contains ALL territories, we only need the latest one.
 *
 * @returns {Object} Sync summary
 */
function forceSyncAllDoDPerDiem() {
  console.log('Force syncing latest DoD per diem bulletin...');

  // Clear existing data (keep headers)
  const sheet = getDoDPerDiemSheet_();
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).clearContent();
    console.log('Cleared existing data');
  }

  // Fetch bulletins
  const bulletins = searchLatestBulletins_();

  if (!bulletins.length) {
    console.log('No bulletins found');
    return { success: false, error: 'No bulletins found from Federal Register' };
  }

  // Get the most recent bulletin
  const latestBulletin = bulletins[0];
  console.log(`Syncing bulletin ${latestBulletin.document_number} (${latestBulletin.publication_date})`);

  // Sync it
  const syncResult = syncBulletin_(latestBulletin);
  logSyncActivity_(syncResult);

  if (syncResult.success) {
    console.log(`Force sync complete: ${syncResult.rowsAdded} rates from bulletin ${latestBulletin.document_number}`);
  } else {
    console.error('Force sync failed:', syncResult.error);
  }

  return syncResult;
}

/**
 * Get the last sync status
 * @returns {Object} Last sync info
 */
function getDoDSyncStatus() {
  const logSheet = getSyncLogSheet_();
  if (!logSheet || logSheet.getLastRow() <= 1) {
    return { lastSync: null, message: 'No sync history' };
  }

  const lastRow = logSheet.getLastRow();
  const lastEntry = logSheet.getRange(lastRow, 1, 1, 5).getValues()[0];

  return {
    lastSync: lastEntry[0],
    documentNumber: lastEntry[1],
    territory: lastEntry[2],
    rowsAdded: lastEntry[3],
    status: lastEntry[4]
  };
}
