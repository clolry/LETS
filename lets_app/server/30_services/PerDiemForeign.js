/**
 * ForeignPerDiemService.js
 * Server-side service for State Department Foreign Per Diem rates
 *
 * Data source: https://aoprals.state.gov/content.asp?content_id=233
 * Excel files updated monthly: {Month}{Year}PD.xls
 *
 * Required:
 * - Sheet named 'Foreign_Per_Diem' in the travel data spreadsheet
 * - Columns: Country (A), Location (B), Season Code (C), Season Start (D),
 *            Season End (E), Lodging (F), M&IE (G), Per Diem (H), Location Code (K)
 */

// =============================================================================
// CONSTANTS
// =============================================================================

const FOREIGN_PERDIEM_SHEET_NAME = 'Foreign_Per_Diem';
const FOREIGN_PERDIEM_CACHE_DURATION = 3600; // 1 hour cache for country/location lists

// Column indices (0-based)
const FPD_COL = {
  COUNTRY: 0,
  LOCATION: 1,
  SEASON_CODE: 2,
  SEASON_START: 3,
  SEASON_END: 4,
  LODGING: 5,
  MIE: 6,
  PERDIEM: 7,
  EFFECTIVE_DATE: 8,
  FOOTNOTE: 9,
  LOCATION_CODE: 10
};

// ISO 3166-1 Alpha-2 country code aliases for search
// Maps common codes/abbreviations to full country names
const ISO_COUNTRY_ALIASES = {
  'UK': 'United Kingdom',
  'GB': 'United Kingdom',
  'US': 'United States',
  'USA': 'United States',
  'UAE': 'United Arab Emirates',
  'NZ': 'New Zealand',
  'SA': 'South Africa',
  'HK': 'Hong Kong',
  'SK': 'South Korea',
  'NK': 'North Korea',
  'CZ': 'Czech Republic',
  'DR': 'Dominican Republic',
  'CAR': 'Central African Republic',
  'DRC': 'Democratic Republic Of The Congo',
  'PNG': 'Papua New Guinea',
  'NL': 'Netherlands',
  'DE': 'Germany',
  'FR': 'France',
  'ES': 'Spain',
  'IT': 'Italy',
  'JP': 'Japan',
  'CN': 'China',
  'IN': 'India',
  'BR': 'Brazil',
  'MX': 'Mexico',
  'CA': 'Canada',
  'AU': 'Australia',
  'RU': 'Russia',
  'KR': 'South Korea',
  'PH': 'Philippines',
  'SG': 'Singapore',
  'MY': 'Malaysia',
  'TH': 'Thailand',
  'VN': 'Vietnam',
  'ID': 'Indonesia',
  'PK': 'Pakistan',
  'BD': 'Bangladesh',
  'EG': 'Egypt',
  'NG': 'Nigeria',
  'KE': 'Kenya',
  'ZA': 'South Africa',
  'AE': 'United Arab Emirates',
  'IL': 'Israel',
  'TR': 'Turkey',
  'PL': 'Poland',
  'SE': 'Sweden',
  'NO': 'Norway',
  'DK': 'Denmark',
  'FI': 'Finland',
  'CH': 'Switzerland',
  'AT': 'Austria',
  'BE': 'Belgium',
  'PT': 'Portugal',
  'GR': 'Greece',
  'IE': 'Ireland',
  'CL': 'Chile',
  'AR': 'Argentina',
  'CO': 'Colombia',
  'PE': 'Peru'
};

// =============================================================================
// STRICT DATE PARSING (avoids timezone issues)
// =============================================================================

/**
 * Parse a date string (YYYY-MM-DD) into month/day components
 * Avoids timezone issues by not using Date object methods for extraction
 */
function parseForeignDateString(dateValue) {
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
function addForeignDaysToDateString(dateStr, days) {
  // Ensure we have YYYY-MM-DD format
  const str = typeof dateStr === 'string' ? dateStr : new Date(dateStr).toISOString().split('T')[0];
  const d = new Date(str + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// =============================================================================
// DATA ACCESS FUNCTIONS
// =============================================================================
// NOTE: Data cleanup (proper case, inverted names) is now done at sync time
// in ForeignPerDiemSync.js. Data in the sheet is already clean.

/**
 * Get the Foreign Per Diem sheet
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} The sheet or null
 */
function getForeignPerDiemSheet_() {
  try {
    const ssId = TRAVEL_DB_SPREADSHEET_ID;

    if (!ssId) {
      console.error('No spreadsheet ID configured for foreign per diem data');
      return null;
    }

    const ss = SpreadsheetApp.openById(ssId);
    const sheet = ss.getSheetByName(FOREIGN_PERDIEM_SHEET_NAME);

    if (!sheet) {
      console.error(`Sheet '${FOREIGN_PERDIEM_SHEET_NAME}' not found`);
      return null;
    }

    return sheet;
  } catch (error) {
    console.error('Error accessing Foreign Per Diem sheet:', error);
    return null;
  }
}

/**
 * Get all foreign per diem data (cached)
 * @returns {Array} Array of row data
 */
function getForeignPerDiemData_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'foreign_perdiem_all_data';
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    return JSON.parse(cachedData);
  }

  const sheet = getForeignPerDiemSheet_();
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  // Skip header row
  const rows = data.slice(1);

  // Cache for 1 hour (data doesn't change frequently)
  try {
    cache.put(cacheKey, JSON.stringify(rows), FOREIGN_PERDIEM_CACHE_DURATION);
  } catch (e) {
    // Data might be too large for cache, that's okay
    console.log('Foreign per diem data too large to cache');
  }

  return rows;
}

// =============================================================================
// PUBLIC API FUNCTIONS
// =============================================================================

/**
 * Get list of all countries with foreign per diem rates
 * Data is already cleaned at sync time (proper case, fixed inversions)
 * @returns {Object} Result with success status and countries array
 */
function getForeignCountries() {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'foreign_perdiem_countries_v3'; // v3: data cleaned at sync time
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return { success: true, countries: JSON.parse(cachedData) };
    }

    const data = getForeignPerDiemData_();
    if (!data.length) {
      return { success: false, error: 'No foreign per diem data available' };
    }

    // Get unique countries (already clean from sync)
    const countriesSet = new Set();
    data.forEach(row => {
      const country = row[FPD_COL.COUNTRY];
      if (country && typeof country === 'string' && country.trim()) {
        countriesSet.add(country.trim());
      }
    });

    // Sort alphabetically
    const countries = Array.from(countriesSet).sort();

    // Cache the country list
    cache.put(cacheKey, JSON.stringify(countries), FOREIGN_PERDIEM_CACHE_DURATION);

    console.log(`Loaded ${countries.length} foreign countries`);
    return { success: true, countries: countries };

  } catch (error) {
    console.error('Error getting foreign countries:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get list of countries with ISO code aliases for enhanced search
 * Returns array of objects with name and aliases
 * @returns {Object} Result with countries array containing {name, aliases}
 */
function getForeignCountriesWithAliases() {
  try {
    const result = getForeignCountries();
    if (!result.success) return result;

    // Build reverse lookup: normalized name -> ISO codes
    const aliasLookup = {};
    for (const [code, name] of Object.entries(ISO_COUNTRY_ALIASES)) {
      if (!aliasLookup[name]) {
        aliasLookup[name] = [];
      }
      aliasLookup[name].push(code);
    }

    // Build countries with aliases
    const countriesWithAliases = result.countries.map(name => ({
      name: name,
      aliases: aliasLookup[name] || [],
      searchTerms: [name, ...(aliasLookup[name] || [])].join(' ').toLowerCase()
    }));

    return { success: true, countries: countriesWithAliases };

  } catch (error) {
    console.error('Error getting foreign countries with aliases:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get list of locations/cities for a specific country
 * Data is already cleaned at sync time
 * @param {string} country - Country name (as stored in sheet - already clean)
 * @returns {Object} Result with success status and locations array
 */
function getForeignLocations(country) {
  try {
    if (!country) {
      return { success: false, error: 'Country is required' };
    }

    const searchCountry = country.trim();

    const cache = CacheService.getScriptCache();
    const cacheKey = `foreign_perdiem_locations_v3_${searchCountry.replace(/\s+/g, '_')}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return { success: true, locations: JSON.parse(cachedData) };
    }

    const data = getForeignPerDiemData_();
    if (!data.length) {
      return { success: false, error: 'No foreign per diem data available' };
    }

    // Get unique locations for this country (data already clean from sync)
    const locationsSet = new Set();
    data.forEach(row => {
      const rowCountry = (row[FPD_COL.COUNTRY] || '').toString().trim();

      // Case-insensitive match on country name
      if (rowCountry.toLowerCase() === searchCountry.toLowerCase()) {
        const location = row[FPD_COL.LOCATION];
        if (location && typeof location === 'string' && location.trim()) {
          locationsSet.add(location.trim());
        }
      }
    });

    // Sort with "Other locations" at the end
    const locations = Array.from(locationsSet).sort((a, b) => {
      if (a === 'Other locations') return 1;
      if (b === 'Other locations') return -1;
      return a.localeCompare(b);
    });

    // Cache the locations list
    cache.put(cacheKey, JSON.stringify(locations), FOREIGN_PERDIEM_CACHE_DURATION);

    console.log(`Loaded ${locations.length} locations for ${country}`);
    return { success: true, locations: locations };

  } catch (error) {
    console.error('Error getting foreign locations:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get per diem rates for a specific country, location, and travel date
 * Handles seasonal rates by matching the travel date to the appropriate season
 *
 * @param {string} country - Country name
 * @param {string} location - City/location name
 * @param {string|Date} travelDate - Date to match for seasonal rates (start date of travel)
 * @returns {Object} Result with lodging, mie, perDiem rates
 */
function getForeignPerDiemRates(country, location, travelDate, preloadedData) {
  try {
    if (!country) {
      return { success: false, error: 'Country is required' };
    }

    const normalizedCountry = country.trim().toUpperCase();
    const normalizedLocation = (location || '[Other]').trim();

    // Parse travel date using strict parsing (avoids timezone issues)
    const parsed = parseForeignDateString(travelDate);
    const travelMonth = parsed.month; // 1-12
    const travelDay = parsed.day;

    // Use preloaded data if provided, otherwise load (for single lookups)
    const data = preloadedData || getForeignPerDiemData_();
    if (!data.length) {
      return { success: false, error: 'No foreign per diem data available' };
    }

    // Find matching rows for country/location
    const matchingRows = data.filter(row => {
      const rowCountry = (row[FPD_COL.COUNTRY] || '').toString().trim().toUpperCase();
      const rowLocation = (row[FPD_COL.LOCATION] || '').toString().trim();
      return rowCountry === normalizedCountry &&
             (rowLocation.toUpperCase() === normalizedLocation.toUpperCase() ||
              (normalizedLocation === '[Other]' && rowLocation === '[Other]'));
    });

    if (!matchingRows.length) {
      // Try to find [Other] as fallback
      const otherRows = data.filter(row => {
        const rowCountry = (row[FPD_COL.COUNTRY] || '').toString().trim().toUpperCase();
        const rowLocation = (row[FPD_COL.LOCATION] || '').toString().trim();
        return rowCountry === normalizedCountry && rowLocation === '[Other]';
      });

      if (!otherRows.length) {
        return {
          success: false,
          error: `No per diem rates found for ${location}, ${country}`
        };
      }

      // Use [Other] rates
      return buildRateResponse_(otherRows, travelMonth, travelDay, country, '[Other]');
    }

    return buildRateResponse_(matchingRows, travelMonth, travelDay, country, location);

  } catch (error) {
    console.error('Error getting foreign per diem rates:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Build rate response, handling seasonal logic
 * @private
 */
function buildRateResponse_(rows, travelMonth, travelDay, country, location) {
  // If only one row (no seasons), use it directly
  if (rows.length === 1) {
    const row = rows[0];
    return {
      success: true,
      country: country,
      location: location,
      seasonCode: row[FPD_COL.SEASON_CODE] || 'S1',
      lodging: parseFloat(row[FPD_COL.LODGING]) || 0,
      mie: parseFloat(row[FPD_COL.MIE]) || 0,
      perDiem: parseFloat(row[FPD_COL.PERDIEM]) || 0,
      locationCode: row[FPD_COL.LOCATION_CODE] || ''
    };
  }

  // Multiple seasons - find the one matching the travel date
  for (const row of rows) {
    const seasonStart = row[FPD_COL.SEASON_START];
    const seasonEnd = row[FPD_COL.SEASON_END];

    if (isDateInSeason_(travelMonth, travelDay, seasonStart, seasonEnd)) {
      return {
        success: true,
        country: country,
        location: location,
        seasonCode: row[FPD_COL.SEASON_CODE] || 'S1',
        lodging: parseFloat(row[FPD_COL.LODGING]) || 0,
        mie: parseFloat(row[FPD_COL.MIE]) || 0,
        perDiem: parseFloat(row[FPD_COL.PERDIEM]) || 0,
        locationCode: row[FPD_COL.LOCATION_CODE] || '',
        seasonStart: formatSeasonDate_(seasonStart),
        seasonEnd: formatSeasonDate_(seasonEnd)
      };
    }
  }

  // Fallback to first row if no season matches
  const row = rows[0];
  return {
    success: true,
    country: country,
    location: location,
    seasonCode: row[FPD_COL.SEASON_CODE] || 'S1',
    lodging: parseFloat(row[FPD_COL.LODGING]) || 0,
    mie: parseFloat(row[FPD_COL.MIE]) || 0,
    perDiem: parseFloat(row[FPD_COL.PERDIEM]) || 0,
    locationCode: row[FPD_COL.LOCATION_CODE] || '',
    note: 'Season not matched, using default rate'
  };
}

/**
 * Check if a date (month/day) falls within a season range
 * Handles seasons that cross year boundaries (e.g., Nov 1 - Feb 28)
 * @private
 */
function isDateInSeason_(month, day, seasonStart, seasonEnd) {
  const startParsed = parseSeasonDate_(seasonStart);
  const endParsed = parseSeasonDate_(seasonEnd);

  if (!startParsed || !endParsed) {
    return false;
  }

  const dateNum = month * 100 + day; // e.g., Jan 15 = 115, Dec 1 = 1201
  const startNum = startParsed.month * 100 + startParsed.day;
  const endNum = endParsed.month * 100 + endParsed.day;

  if (startNum <= endNum) {
    // Normal range (e.g., Mar 1 - Oct 31)
    return dateNum >= startNum && dateNum <= endNum;
  } else {
    // Crosses year boundary (e.g., Nov 1 - Feb 28)
    return dateNum >= startNum || dateNum <= endNum;
  }
}

/**
 * Parse season date string to month/day object
 * Handles formats like "01/15", "Jan 15", "1/15/2025", etc.
 * @private
 */
function parseSeasonDate_(dateValue) {
  if (!dateValue) return null;

  // If it's a Date object
  if (dateValue instanceof Date) {
    return { month: dateValue.getMonth() + 1, day: dateValue.getDate() };
  }

  const str = dateValue.toString().trim();

  // Try MM/DD or M/D format (possibly with year)
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})/);
  if (slashMatch) {
    return { month: parseInt(slashMatch[1], 10), day: parseInt(slashMatch[2], 10) };
  }

  // Try parsing as date string
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return { month: parsed.getMonth() + 1, day: parsed.getDate() };
    }
  } catch (e) {
    // Ignore parse errors
  }

  return null;
}

/**
 * Format season date for display
 * @private
 */
function formatSeasonDate_(dateValue) {
  const parsed = parseSeasonDate_(dateValue);
  if (!parsed) return '';

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[parsed.month - 1]} ${parsed.day}`;
}

/**
 * Calculate international per diem for a traveler
 * Handles seasonal rate changes mid-trip by calculating day-by-day
 * Wrapper function for client-side calls
 *
 * @param {Object} params - Parameters object
 * @param {string} params.country - Country name
 * @param {string} params.location - City/location name
 * @param {string} params.travelStartDate - Start date of travel
 * @param {string} params.travelEndDate - End date of travel
 * @returns {Object} Calculated costs
 */
function calculateForeignPerDiem(params) {
  try {
    const { country, location, travelStartDate, travelEndDate } = params;

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

    // Load per diem data ONCE for all lookups (major performance optimization)
    const perDiemData = getForeignPerDiemData_();
    if (!perDiemData.length) {
      return { success: false, error: 'No foreign per diem data available' };
    }

    // Calculate lodging day by day (per night)
    let lodgingTotal = 0;
    const lodgingBreakdown = [];

    for (let i = 0; i < nights; i++) {
      const nightDateStr = addForeignDaysToDateString(startDateStr, i);

      const ratesResult = getForeignPerDiemRates(country, location, nightDateStr, perDiemData);
      if (!ratesResult.success) {
        return ratesResult;
      }

      lodgingTotal += ratesResult.lodging;
      lodgingBreakdown.push({
        date: nightDateStr,
        rate: ratesResult.lodging,
        seasonCode: ratesResult.seasonCode,
        season: ratesResult.seasonStart ? `${ratesResult.seasonStart} - ${ratesResult.seasonEnd}` : null
      });
    }

    // Calculate M&IE day by day (75% first/last day, 100% middle days)
    let mieTotal = 0;
    const mieBreakdown = [];

    for (let i = 0; i < totalDays; i++) {
      const dayDateStr = addForeignDaysToDateString(startDateStr, i);

      const ratesResult = getForeignPerDiemRates(country, location, dayDateStr, perDiemData);
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
        seasonCode: ratesResult.seasonCode,
        season: ratesResult.seasonStart ? `${ratesResult.seasonStart} - ${ratesResult.seasonEnd}` : null
      });
    }

    // Get primary rate info from start date for display
    const primaryRates = getForeignPerDiemRates(country, location, travelStartDate, perDiemData);

    // Check if rates varied during trip
    const ratesVaried = lodgingBreakdown.some((b, i, arr) => i > 0 && b.rate !== arr[0].rate) ||
                        mieBreakdown.some((b, i, arr) => i > 0 && b.dailyRate !== arr[0].dailyRate);

    const averageLodgingRate = nights > 0 ? lodgingTotal / nights : 0;

    return {
      success: true,
      country: primaryRates.country,
      location: primaryRates.location,
      seasonCode: primaryRates.seasonCode,
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
      source: 'DOS'
    };

  } catch (error) {
    console.error('Error calculating foreign per diem:', error);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// VERSION TRACKING FOR CLIENT CACHE
// =============================================================================

/**
 * Get all DOS per diem data for client-side caching
 *
 * Sheet structure (0-indexed):
 *   A(0): Country, B(1): City, C(2): Season Code, D(3): Season Start,
 *   E(4): Season End, F(5): Lodging, G(6): M&IE
 *
 * Returns: { countries, localities, rates }
 * - countries: ['France', 'Germany', ...]
 * - localities: { 'France': ['Paris', 'Lyon', ...], ... }
 * - rates: { 'France': { 'Paris': [{ lodging, mie, seasonStart, seasonEnd }, ...] } }
 */
function getAllForeignPerDiemData() {
  try {
    const sheet = getForeignPerDiemSheet_();
    if (!sheet) {
      return { success: false, error: 'Foreign Per Diem sheet not found' };
    }

    const allData = sheet.getDataRange().getValues();
    if (allData.length <= 1) {
      return { success: false, error: 'No foreign per diem data available' };
    }

    const rows = allData.slice(1); // Skip header

    const countriesSet = new Set();
    const localities = {};
    const rates = {};

    rows.forEach(row => {
      const country = String(row[0] || '').trim();  // A: Country
      const city = String(row[1] || '').trim();     // B: City
      if (!country || !city) return;

      countriesSet.add(country);

      // Build localities
      if (!localities[country]) localities[country] = new Set();
      localities[country].add(city);

      // Build rates
      if (!rates[country]) rates[country] = {};
      if (!rates[country][city]) rates[country][city] = [];

      rates[country][city].push({
        lodging: parseFloat(row[5]) || 0,           // F: Lodging
        mie: parseFloat(row[6]) || 0,               // G: M&IE
        seasonStart: formatMMDD(row[3]),            // D: Season Start
        seasonEnd: formatMMDD(row[4])               // E: Season End
      });
    });

    // Convert Sets to sorted arrays
    const countries = Array.from(countriesSet).sort();
    for (const country of Object.keys(localities)) {
      localities[country] = Array.from(localities[country]).sort((a, b) => {
        if (a === 'Other locations' || a === '[Other]') return 1;
        if (b === 'Other locations' || b === '[Other]') return -1;
        return a.localeCompare(b);
      });
    }

    const version = getDOSLastSync() || new Date().toISOString();
    console.log(`DOS: ${countries.length} countries, ${rows.length} rate entries`);

    return { success: true, version, countries, localities, rates };

  } catch (error) {
    console.error('getAllForeignPerDiemData error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Format date to MM/DD string (handles Date objects and strings)
 */
function formatMMDD(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return (val.getMonth() + 1) + '/' + val.getDate();
  }
  // Already a string like "1/15" or "01/15"
  const str = String(val);
  const match = str.match(/(\d{1,2})\/(\d{1,2})/);
  return match ? match[1] + '/' + match[2] : str;
}

/**
 * Get current data version timestamps for client cache invalidation
 * Client can compare these against their cached versions to know when to refresh
 *
 * @returns {Object} Version timestamps for each data source
 */
function getPerDiemDataVersions() {
  try {
    return {
      success: true,
      versions: {
        dos: getDOSLastSync() || null,
        dod: getDoDLastSync() || null
      },
      // Include ISO aliases version (hash of the aliases object)
      isoAliasesVersion: '2025.01' // Bump this when ISO_COUNTRY_ALIASES changes
    };
  } catch (error) {
    console.error('Error getting data versions:', error);
    return { success: false, error: error.message };
  }
}
