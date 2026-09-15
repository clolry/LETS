/**
 * DoDPerDiemService.js
 * Server-side service for DoD OCONUS Per Diem rate lookups
 *
 * Covers: Alaska, Hawaii, Puerto Rico, U.S. Virgin Islands, Guam, and other territories
 * Data source: DoD_Per_Diem sheet (synced from Federal Register via DoDPerDiemSync.js)
 *
 * Required:
 * - Sheet named 'DoD_Per_Diem' in the travel data spreadsheet
 * - Columns: Territory (A), Locality (B), Season Start (C), Season End (D),
 *            Lodging (E), MIE (F), Per Diem (G), Effective Date (H), Document Number (I)
 */

// =============================================================================
// CONSTANTS
// =============================================================================

const DOD_SHEET_NAME = 'DoD_Per_Diem';
const DOD_CACHE_DURATION = 3600; // 1 hour cache

// Column indices (0-based)
const DOD_PERDIEM_COL = {
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

// Map state abbreviations to territory names (must match cleaned data in sheet)
const STATE_TO_TERRITORY = {
  'AK': 'Alaska',
  'HI': 'Hawaii',
  'PR': 'Puerto Rico',
  'VI': 'U.S. Virgin Islands',
  'GU': 'Guam',
  'AS': 'American Samoa',
  'MP': 'Northern Mariana Islands'
};

// =============================================================================
// STRICT DATE PARSING (avoids timezone issues)
// =============================================================================

/**
 * Parse a date string (YYYY-MM-DD) into month/day components
 * Avoids timezone issues by not using Date object methods for extraction
 */
function parseDoDDateString(dateValue) {
  if (!dateValue) {
    const now = new Date();
    return { month: now.getMonth() + 1, day: now.getDate() };
  }

  // If it's a string in YYYY-MM-DD format, parse directly
  if (typeof dateValue === 'string') {
    const isoMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return {
        month: parseInt(isoMatch[2], 10),
        day: parseInt(isoMatch[3], 10)
      };
    }
    // Handle MM/DD/YYYY format
    const usMatch = dateValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usMatch) {
      return {
        month: parseInt(usMatch[1], 10),
        day: parseInt(usMatch[2], 10)
      };
    }
  }

  // Fallback for Date objects: convert to ISO string first
  const dateObj = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const isoStr = dateObj.toISOString().split('T')[0];
  const parts = isoStr.split('-');
  return {
    month: parseInt(parts[1], 10),
    day: parseInt(parts[2], 10)
  };
}

/**
 * Add days to a date string, returns new date string (YYYY-MM-DD)
 * Uses noon UTC to avoid DST issues
 */
function addDoDDaysToDateString(dateStr, days) {
  // Ensure we have YYYY-MM-DD format
  const str = typeof dateStr === 'string' ? dateStr : new Date(dateStr).toISOString().split('T')[0];
  const d = new Date(str + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// =============================================================================
// DATA ACCESS
// =============================================================================
// NOTE: Data cleanup (proper case, territory normalization) is now done at sync
// time in DoDPerDiemSync.js. Data in the sheet is already clean.

/**
 * Get the DoD Per Diem sheet
 */
function getDoDSheet_() {
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(DOD_SHEET_NAME);

    if (!sheet) {
      console.error(`Sheet '${DOD_SHEET_NAME}' not found`);
      return null;
    }

    return sheet;
  } catch (error) {
    console.error('Error accessing DoD Per Diem sheet:', error);
    return null;
  }
}

/**
 * Get all DoD per diem data (cached)
 */
function getDoDPerDiemData_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'dod_perdiem_all_data';
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    return JSON.parse(cachedData);
  }

  const sheet = getDoDSheet_();
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  // Skip header row
  const rows = data.slice(1);

  // Cache the data
  try {
    cache.put(cacheKey, JSON.stringify(rows), DOD_CACHE_DURATION);
  } catch (e) {
    console.log('DoD per diem data too large to cache');
  }

  return rows;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get list of OCONUS territories with per diem rates
 * Data is already cleaned at sync time (proper case)
 * @returns {Object} Result with success status and territories array
 */
function getDoDTerritories() {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'dod_perdiem_territories_v3'; // v3: data cleaned at sync time
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return { success: true, territories: JSON.parse(cachedData) };
    }

    const data = getDoDPerDiemData_();
    if (!data.length) {
      return { success: false, error: 'No DoD per diem data available' };
    }

    // Get unique territories (already clean from sync)
    const territoriesSet = new Set();
    data.forEach(row => {
      const territory = row[DOD_PERDIEM_COL.TERRITORY];
      if (territory && typeof territory === 'string' && territory.trim()) {
        territoriesSet.add(territory.trim());
      }
    });

    // Sort alphabetically
    const territories = Array.from(territoriesSet).sort();

    // Cache the territory list
    cache.put(cacheKey, JSON.stringify(territories), DOD_CACHE_DURATION);

    console.log(`Loaded ${territories.length} DoD territories`);
    return { success: true, territories: territories };

  } catch (error) {
    console.error('Error getting DoD territories:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get list of localities for a specific territory
 * Accepts state abbreviation or territory name (data is already clean)
 * @param {string} territory - Territory name (e.g., "Alaska") or state abbr (e.g., "AK")
 * @returns {Object} Result with success status and localities array
 */
function getDoDLocalities(territory) {
  try {
    if (!territory) {
      return { success: false, error: 'Territory is required' };
    }

    const searchTerritory = territory.trim();

    // Convert state abbreviation to territory name if needed
    const searchUpperCase = searchTerritory.toUpperCase();
    const displayTerritory = STATE_TO_TERRITORY[searchUpperCase] || searchTerritory;

    const cache = CacheService.getScriptCache();
    const cacheKey = `dod_perdiem_localities_v3_${displayTerritory.replace(/\s+/g, '_')}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return { success: true, localities: JSON.parse(cachedData), territory: displayTerritory };
    }

    const data = getDoDPerDiemData_();
    if (!data.length) {
      return { success: false, error: 'No DoD per diem data available' };
    }

    // Get unique localities for this territory (data already clean from sync)
    const localitiesSet = new Set();
    data.forEach(row => {
      const rowTerritory = (row[DOD_PERDIEM_COL.TERRITORY] || '').toString().trim();

      // Case-insensitive match on territory name
      if (rowTerritory.toLowerCase() === displayTerritory.toLowerCase()) {
        const locality = row[DOD_PERDIEM_COL.LOCALITY];
        if (locality && typeof locality === 'string' && locality.trim()) {
          localitiesSet.add(locality.trim());
        }
      }
    });

    // Sort with "Other locations" at the end
    const localities = Array.from(localitiesSet).sort((a, b) => {
      if (a === 'Other locations') return 1;
      if (b === 'Other locations') return -1;
      return a.localeCompare(b);
    });

    // Cache the localities list
    cache.put(cacheKey, JSON.stringify(localities), DOD_CACHE_DURATION);

    console.log(`Loaded ${localities.length} localities for ${displayTerritory}`);
    return { success: true, localities: localities, territory: displayTerritory };

  } catch (error) {
    console.error('Error getting DoD localities:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get per diem rates for a specific territory/locality and date
 * Handles seasonal rates by matching the travel date
 * Data is already cleaned at sync time
 *
 * @param {string} territory - Territory name or state abbreviation
 * @param {string} locality - City/locality name
 * @param {string|Date} travelDate - Date to match for seasonal rates
 * @returns {Object} Result with lodging, mie, perDiem rates
 */
function getDoDPerDiemRates(territory, locality, travelDate) {
  try {
    if (!territory) {
      return { success: false, error: 'Territory is required' };
    }

    const searchTerritory = territory.trim();
    const searchUpperCase = searchTerritory.toUpperCase();

    // Convert state abbreviation to territory name if needed
    const displayTerritory = STATE_TO_TERRITORY[searchUpperCase] || searchTerritory;
    const searchLocality = (locality || '').trim();
    const displayLocality = searchLocality || 'Other locations';

    // Parse travel date using strict parsing (avoids timezone issues)
    const parsed = parseDoDDateString(travelDate);
    const travelMonth = parsed.month;
    const travelDay = parsed.day;

    const data = getDoDPerDiemData_();
    if (!data.length) {
      return { success: false, error: 'No DoD per diem data available. Run syncDoDPerDiem() to fetch data.' };
    }

    // Find matching rows (data already clean from sync)
    const matchingRows = data.filter(row => {
      const rowTerritory = (row[DOD_PERDIEM_COL.TERRITORY] || '').toString().trim();
      const rowLocality = (row[DOD_PERDIEM_COL.LOCALITY] || '').toString().trim();

      // Case-insensitive match
      const territoryMatches = rowTerritory.toLowerCase() === displayTerritory.toLowerCase();
      const localityMatches = rowLocality.toLowerCase() === searchLocality.toLowerCase();

      return territoryMatches && localityMatches;
    });

    if (!matchingRows.length) {
      // Try to find a default/other rate for the territory
      const defaultRows = data.filter(row => {
        const rowTerritory = (row[DOD_PERDIEM_COL.TERRITORY] || '').toString().trim();
        const rowLocality = (row[DOD_PERDIEM_COL.LOCALITY] || '').toString().trim();

        const territoryMatches = rowTerritory.toLowerCase() === displayTerritory.toLowerCase();
        const isOtherLocations = rowLocality === 'Other locations';

        return territoryMatches && isOtherLocations;
      });

      if (defaultRows.length) {
        return buildDoDRateResponse_(defaultRows, travelMonth, travelDay, displayTerritory, 'Other locations');
      }

      return {
        success: false,
        error: `No per diem rates found for ${displayLocality}, ${displayTerritory}`
      };
    }

    return buildDoDRateResponse_(matchingRows, travelMonth, travelDay, displayTerritory, displayLocality);

  } catch (error) {
    console.error('Error getting DoD per diem rates:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Build rate response, handling seasonal logic
 */
function buildDoDRateResponse_(rows, travelMonth, travelDay, territory, locality) {
  // If only one row (no seasons), use it directly
  if (rows.length === 1) {
    const row = rows[0];
    return {
      success: true,
      territory: territory,
      locality: locality,
      lodging: parseFloat(row[DOD_PERDIEM_COL.LODGING]) || 0,
      mie: parseFloat(row[DOD_PERDIEM_COL.MIE]) || 0,
      perDiem: parseFloat(row[DOD_PERDIEM_COL.PERDIEM]) || 0,
      effectiveDate: row[DOD_PERDIEM_COL.EFFECTIVE_DATE] || '',
      documentNumber: row[DOD_PERDIEM_COL.DOCUMENT_NUMBER] || ''
    };
  }

  // Multiple seasons - find the matching one
  for (const row of rows) {
    const seasonStart = row[DOD_PERDIEM_COL.SEASON_START];
    const seasonEnd = row[DOD_PERDIEM_COL.SEASON_END];

    if (isDoDDateInSeason_(travelMonth, travelDay, seasonStart, seasonEnd)) {
      return {
        success: true,
        territory: territory,
        locality: locality,
        lodging: parseFloat(row[DOD_PERDIEM_COL.LODGING]) || 0,
        mie: parseFloat(row[DOD_PERDIEM_COL.MIE]) || 0,
        perDiem: parseFloat(row[DOD_PERDIEM_COL.PERDIEM]) || 0,
        seasonStart: formatDoDSeasonDate_(seasonStart),
        seasonEnd: formatDoDSeasonDate_(seasonEnd),
        effectiveDate: row[DOD_PERDIEM_COL.EFFECTIVE_DATE] || '',
        documentNumber: row[DOD_PERDIEM_COL.DOCUMENT_NUMBER] || ''
      };
    }
  }

  // Fallback to first row
  const row = rows[0];
  return {
    success: true,
    territory: territory,
    locality: locality,
    lodging: parseFloat(row[DOD_PERDIEM_COL.LODGING]) || 0,
    mie: parseFloat(row[DOD_PERDIEM_COL.MIE]) || 0,
    perDiem: parseFloat(row[DOD_PERDIEM_COL.PERDIEM]) || 0,
    effectiveDate: row[DOD_PERDIEM_COL.EFFECTIVE_DATE] || '',
    documentNumber: row[DOD_PERDIEM_COL.DOCUMENT_NUMBER] || '',
    note: 'Season not matched, using default rate'
  };
}

/**
 * Check if date falls within season range
 */
function isDoDDateInSeason_(month, day, seasonStart, seasonEnd) {
  const startParsed = parseDoDSeasonDate_(seasonStart);
  const endParsed = parseDoDSeasonDate_(seasonEnd);

  if (!startParsed || !endParsed) {
    return false;
  }

  const dateNum = month * 100 + day;
  const startNum = startParsed.month * 100 + startParsed.day;
  const endNum = endParsed.month * 100 + endParsed.day;

  if (startNum <= endNum) {
    return dateNum >= startNum && dateNum <= endNum;
  } else {
    // Crosses year boundary
    return dateNum >= startNum || dateNum <= endNum;
  }
}

/**
 * Parse season date (MM/DD format)
 */
function parseDoDSeasonDate_(dateValue) {
  if (!dateValue) return null;

  if (dateValue instanceof Date) {
    return { month: dateValue.getMonth() + 1, day: dateValue.getDate() };
  }

  const str = dateValue.toString().trim();
  const match = str.match(/^(\d{1,2})\/(\d{1,2})/);
  if (match) {
    return { month: parseInt(match[1], 10), day: parseInt(match[2], 10) };
  }

  return null;
}

/**
 * Format season date for display
 */
function formatDoDSeasonDate_(dateValue) {
  const parsed = parseDoDSeasonDate_(dateValue);
  if (!parsed) return '';

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[parsed.month - 1]} ${parsed.day}`;
}

/**
 * Calculate DoD per diem for a traveler
 * Handles seasonal rate changes mid-trip by calculating day-by-day
 * Wrapper function for client-side calls
 *
 * @param {Object} params - Parameters object
 * @param {string} params.state - State abbreviation (AK, HI, etc.)
 * @param {string} params.city - City name
 * @param {string} params.travelStartDate - Start date
 * @param {string} params.travelEndDate - End date
 * @returns {Object} Calculated costs
 */
function calculateDoDPerDiem(params) {
  try {
    const { state, city, travelStartDate, travelEndDate } = params;

    // Use strict date string parsing to avoid timezone issues
    const startDateStr = typeof travelStartDate === 'string'
      ? travelStartDate.split('T')[0]
      : new Date(travelStartDate).toISOString().split('T')[0];
    const endDateStr = typeof travelEndDate === 'string'
      ? travelEndDate.split('T')[0]
      : new Date(travelEndDate).toISOString().split('T')[0];

    // Calculate days using noon UTC to avoid DST issues
    const startDateObj = new Date(startDateStr + 'T12:00:00Z');
    const endDateObj = new Date(endDateStr + 'T12:00:00Z');
    const msPerDay = 24 * 60 * 60 * 1000;

    const totalDays = Math.round((endDateObj - startDateObj) / msPerDay) + 1;
    const nights = Math.max(0, totalDays - 1);

    // Calculate lodging day by day (per night)
    let lodgingTotal = 0;
    const lodgingBreakdown = [];

    for (let i = 0; i < nights; i++) {
      const nightDateStr = addDoDDaysToDateString(startDateStr, i);

      const ratesResult = getDoDPerDiemRates(state, city, nightDateStr);
      if (!ratesResult.success) {
        return ratesResult;
      }

      lodgingTotal += ratesResult.lodging;
      lodgingBreakdown.push({
        date: nightDateStr,
        rate: ratesResult.lodging,
        season: ratesResult.seasonStart ? `${ratesResult.seasonStart} - ${ratesResult.seasonEnd}` : null
      });
    }

    // Calculate M&IE day by day (75% first/last day, 100% middle days)
    let mieTotal = 0;
    const mieBreakdown = [];

    for (let i = 0; i < totalDays; i++) {
      const dayDateStr = addDoDDaysToDateString(startDateStr, i);

      const ratesResult = getDoDPerDiemRates(state, city, dayDateStr);
      if (!ratesResult.success) {
        return ratesResult;
      }

      const isFirstDay = i === 0;
      const isLastDay = i === totalDays - 1;
      const isPartialDay = isFirstDay || isLastDay;

      // Single day trip or first/last day gets 75%
      const appliedRate = (totalDays === 1 || isPartialDay) ? ratesResult.mie * 0.75 : ratesResult.mie;

      mieTotal += appliedRate;
      mieBreakdown.push({
        date: dayDateStr,
        dailyRate: ratesResult.mie,
        appliedRate: appliedRate,
        percentage: isPartialDay ? 75 : 100,
        season: ratesResult.seasonStart ? `${ratesResult.seasonStart} - ${ratesResult.seasonEnd}` : null
      });
    }

    // Get primary rate info from start date for display
    const primaryRates = getDoDPerDiemRates(state, city, travelStartDate);

    // Check if rates varied during trip
    const ratesVaried = lodgingBreakdown.some((b, i, arr) => i > 0 && b.rate !== arr[0].rate) ||
                        mieBreakdown.some((b, i, arr) => i > 0 && b.dailyRate !== arr[0].dailyRate);

    const averageLodgingRate = nights > 0 ? lodgingTotal / nights : 0;

    return {
      success: true,
      territory: primaryRates.territory,
      locality: primaryRates.locality,
      rates: {
        lodging: averageLodgingRate,
        mie: primaryRates.mie,
        perDiem: primaryRates.perDiem
      },
      calculated: {
        nights: nights,
        days: totalDays,
        lodgingTotal: roundMoney(lodgingTotal),
        mieTotal: roundMoney(mieTotal),
        total: roundMoney((lodgingTotal + mieTotal))
      },
      seasonInfo: primaryRates.seasonStart ? {
        start: primaryRates.seasonStart,
        end: primaryRates.seasonEnd
      } : null,
      ratesVaried: ratesVaried,
      breakdown: ratesVaried ? { lodging: lodgingBreakdown, mie: mieBreakdown } : undefined,
      source: 'DoD',
      documentNumber: primaryRates.documentNumber
    };

  } catch (error) {
    console.error('Error calculating DoD per diem:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all DoD OCONUS per diem data for client-side caching
 *
 * Sheet structure (0-indexed):
 *   A(0): Territory/State, B(1): City, C(2): Season Start,
 *   D(3): Season End, E(4): Lodging, F(5): M&IE
 *
 * Returns: { territories, localities, rates }
 * - territories: ['Alaska', 'Hawaii', ...]
 * - localities: { 'Alaska': ['Anchorage', 'Fairbanks', ...], ... }
 * - rates: { 'Alaska': { 'Anchorage': [{ lodging, mie, seasonStart, seasonEnd }, ...] } }
 */
function getAllDoDPerDiemData() {
  try {
    const sheet = getDoDSheet_();
    if (!sheet) {
      return { success: false, error: 'DoD Per Diem sheet not found' };
    }

    const allData = sheet.getDataRange().getValues();
    if (allData.length <= 1) {
      return { success: false, error: 'No DoD per diem data available' };
    }

    const rows = allData.slice(1); // Skip header

    const territoriesSet = new Set();
    const localities = {};
    const rates = {};

    rows.forEach(row => {
      const territory = String(row[0] || '').trim();  // A: Territory/State
      const city = String(row[1] || '').trim();       // B: City
      if (!territory || !city) return;

      territoriesSet.add(territory);

      // Build localities
      if (!localities[territory]) localities[territory] = new Set();
      localities[territory].add(city);

      // Build rates
      if (!rates[territory]) rates[territory] = {};
      if (!rates[territory][city]) rates[territory][city] = [];

      rates[territory][city].push({
        lodging: parseFloat(row[4]) || 0,             // E: Lodging
        mie: parseFloat(row[5]) || 0,                 // F: M&IE
        seasonStart: formatDoDDate(row[2]),           // C: Season Start
        seasonEnd: formatDoDDate(row[3])              // D: Season End
      });
    });

    // Convert Sets to sorted arrays
    const territories = Array.from(territoriesSet).sort();
    for (const territory of Object.keys(localities)) {
      localities[territory] = Array.from(localities[territory]).sort((a, b) => {
        if (a === 'Other' || a === '[Other]') return 1;
        if (b === 'Other' || b === '[Other]') return -1;
        return a.localeCompare(b);
      });
    }

    const version = getDoDLastSync() || new Date().toISOString();
    console.log(`DoD: ${territories.length} territories, ${rows.length} rate entries`);

    return { success: true, version, territories, localities, rates };

  } catch (error) {
    console.error('getAllDoDPerDiemData error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Format DoD date to MM/DD string (handles Date objects and strings)
 */
function formatDoDDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return (val.getMonth() + 1) + '/' + val.getDate();
  }
  const str = String(val);
  const match = str.match(/(\d{1,2})\/(\d{1,2})/);
  return match ? match[1] + '/' + match[2] : str;
}
