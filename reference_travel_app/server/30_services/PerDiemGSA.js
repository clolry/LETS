/**
 * GSAPerDiemService.js
 * Server-side service for GSA Per Diem rates and travel cost calculations
 *
 * Required Script Properties:
 * - GSA_PERDIEM_API_KEY: API key for GSA Per Diem API
 * - MILEAGE_RATE_PRIVATE: Current private vehicle mileage rate (e.g., 0.725)
 * - MILEAGE_RATE_GOV: Current government vehicle mileage rate (e.g., 0.205)
 * - MILEAGE_RATE_EFFECTIVE_DATE: Effective date for mileage rates
 */

// =============================================================================
// CONSTANTS
// =============================================================================

const GSA_PERDIEM_BASE_URL = 'https://api.gsa.gov/travel/perdiem/v2/rates';
const CACHE_DURATION_SECONDS = 21600; // 6 hours

// =============================================================================
// API FUNCTIONS
// =============================================================================

/**
 * Get per diem rates for a city/state and fiscal year
 * @param {string} city - City name
 * @param {string} state - State abbreviation (e.g., "DC", "VA")
 * @param {number} fiscalYear - Fiscal year (e.g., 2026)
 * @returns {Object} Per diem rate data or error
 */
function fetchPerDiemRates(city, state, fiscalYear) {
  try {
    const apiKey = getGSAApiKey();
    if (!apiKey) {
      throw new Error('GSA_PERDIEM_API_KEY not configured in Script Properties');
    }

    // Check cache first
    const cacheKey = `perdiem_${city}_${state}_${fiscalYear}`.toLowerCase().replace(/\s+/g, '_');
    const cache = CacheService.getScriptCache();
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      console.log(`Cache hit for ${city}, ${state} FY${fiscalYear}`);
      return JSON.parse(cachedData);
    }

    // Build URL - encode city name for spaces/special chars
    const encodedCity = encodeURIComponent(city);
    const url = `${GSA_PERDIEM_BASE_URL}/city/${encodedCity}/state/${state}/year/${fiscalYear}`;

    console.log(`Fetching per diem rates: ${url}`);

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
      console.log(`City "${city}" not found in GSA API, fetching standard rate for ${state}`);
      // City not found - fall back to state standard rate
      return fetchStandardRateForState(state, fiscalYear, city);
    }

    const data = JSON.parse(responseText);

    // Parse and normalize the response
    const result = parsePerDiemResponse(data, city, state, fiscalYear);

    // If parsing failed, try standard rate fallback
    if (!result.success) {
      console.log(`Failed to parse response for "${city}", fetching standard rate for ${state}`);
      return fetchStandardRateForState(state, fiscalYear, city);
    }

    // Cache the successful result
    cache.put(cacheKey, JSON.stringify(result), CACHE_DURATION_SECONDS);

    return result;

  } catch (error) {
    console.error('Error fetching per diem rates:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Fetch the standard per diem rate for a state
 * Used as fallback when a specific city isn't found in GSA data
 * @param {string} state - State abbreviation
 * @param {number} fiscalYear - Fiscal year
 * @param {string} originalCity - The city the user entered (preserved for display)
 * @returns {Object} Standard rate data with isStandardRate: true
 */
function fetchStandardRateForState(state, fiscalYear, originalCity) {
  try {
    const apiKey = getGSAApiKey();
    if (!apiKey) {
      throw new Error('GSA_PERDIEM_API_KEY not configured');
    }

    // Check cache for standard rate
    const cacheKey = `perdiem_standard_${state}_${fiscalYear}`.toLowerCase();
    const cache = CacheService.getScriptCache();
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      const cached = JSON.parse(cachedData);
      // Return cached data but with the user's city name
      return {
        ...cached,
        city: originalCity,
        displayCity: originalCity + ' (Standard Rate)'
      };
    }

    // Fetch state rates to find the standard rate
    const url = `${GSA_PERDIEM_BASE_URL}/state/${state}/year/${fiscalYear}`;
    console.log(`Fetching standard rate for ${state}: ${url}`);

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    if (responseCode !== 200) {
      return {
        success: false,
        error: `Failed to fetch standard rate for ${state}`
      };
    }

    const data = JSON.parse(response.getContentText());

    // Find the standard rate entry (standardRate: "true")
    let standardRateEntry = null;
    if (data.rates && Array.isArray(data.rates)) {
      for (const rateGroup of data.rates) {
        if (rateGroup.rate && Array.isArray(rateGroup.rate)) {
          for (const rate of rateGroup.rate) {
            if (rate.standardRate === 'true') {
              standardRateEntry = rate;
              break;
            }
          }
        }
        if (standardRateEntry) break;
      }
    }

    if (!standardRateEntry) {
      return {
        success: false,
        error: `No standard rate found for ${state}`
      };
    }

    // Extract monthly lodging rates
    const monthlyLodging = {};
    if (standardRateEntry.months && standardRateEntry.months.month) {
      standardRateEntry.months.month.forEach(month => {
        monthlyLodging[month.number] = parseFloat(month.value) || 0;
      });
    }

    const result = {
      success: true,
      city: originalCity,
      displayCity: originalCity + ' (Standard Rate)',
      county: standardRateEntry.county || '',
      state: state,
      fiscalYear: fiscalYear,
      mieRate: parseFloat(standardRateEntry.meals) || 0,
      monthlyLodging: monthlyLodging,
      isStandardRate: true,
      isOconus: false
    };

    // Cache the standard rate (without city-specific info)
    const cacheResult = { ...result, city: 'STANDARD', displayCity: 'Standard Rate' };
    cache.put(cacheKey, JSON.stringify(cacheResult), CACHE_DURATION_SECONDS);

    return result;

  } catch (error) {
    console.error('Error fetching standard rate:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get list of cities/localities for a state from GSA
 * Uses the state endpoint which returns all non-standard rate areas
 * @param {string} state - State abbreviation (e.g., "VA", "CA")
 * @returns {Object} Result with cities array
 */
function getGSACitiesForState(state) {
  try {
    const apiKey = getGSAApiKey();
    if (!apiKey) {
      throw new Error('GSA_PERDIEM_API_KEY not configured in Script Properties');
    }

    // Determine fiscal year (Oct 1 starts new FY)
    const now = new Date();
    const fiscalYear = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();

    // Check cache first (cities don't change often)
    const cacheKey = `gsa_cities_${state}_${fiscalYear}`;
    const cache = CacheService.getScriptCache();
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      console.log(`Cache hit for ${state} cities`);
      return JSON.parse(cachedData);
    }

    // Fetch all localities for the state
    const url = `${GSA_PERDIEM_BASE_URL}/state/${state}/year/${fiscalYear}`;

    console.log(`Fetching cities for state: ${url}`);

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
      console.error(`GSA API error: ${responseCode} - ${responseText}`);
      return { success: false, error: `GSA API returned ${responseCode}` };
    }

    const data = JSON.parse(responseText);

    // Extract unique city names from the response
    const citiesSet = new Set();

    if (data.rates && Array.isArray(data.rates)) {
      data.rates.forEach(rateGroup => {
        if (rateGroup.rate && Array.isArray(rateGroup.rate)) {
          rateGroup.rate.forEach(rate => {
            if (rate.city) {
              citiesSet.add(rate.city);
            }
          });
        }
      });
    }

    // Convert to sorted array (no "Standard Rate" option - users can type any city)
    const cities = Array.from(citiesSet).sort();

    const result = {
      success: true,
      state: state,
      fiscalYear: fiscalYear,
      cities: cities,
      count: cities.length
    };

    // Cache for 24 hours (cities list doesn't change often)
    cache.put(cacheKey, JSON.stringify(result), 86400);

    console.log(`Found ${cities.length} cities for ${state}`);
    return result;

  } catch (error) {
    console.error('Error fetching cities for state:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// CITY-LIST WARMING & INLINE BUNDLE
// ============================================================================

/**
 * CONUS states + DC. AK and HI go through the DoD path, so they're not
 * GSA-cached.
 */
var GSA_CONUS_STATES = [
  'AL','AZ','AR','CA','CO','CT','DE','DC','FL','GA','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX',
  'UT','VT','VA','WA','WV','WI','WY'
];

/**
 * Calculate the current GSA fiscal year (Oct 1 = new FY).
 */
function _gsaCurrentFiscalYear() {
  var now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

/**
 * Read the cached city list for every CONUS state (no GSA API calls).
 * Used by doGet at template-eval time to inline the bundle into the page.
 * States missing from the cache are simply omitted — the client falls
 * back to its existing on-demand path for those.
 *
 * @returns {Object} { STATE_ABBR: ['City1', 'City2', ...] }
 */
function getInlineGSACitiesBundle() {
  try {
    var cache = CacheService.getScriptCache();
    var fy = _gsaCurrentFiscalYear();
    var keys = GSA_CONUS_STATES.map(function(s) { return 'gsa_cities_' + s + '_' + fy; });

    // Single multi-get is much faster than 49 separate cache.get calls
    var hits = cache.getAll(keys) || {};

    var bundle = {};
    for (var i = 0; i < GSA_CONUS_STATES.length; i++) {
      var state = GSA_CONUS_STATES[i];
      var raw = hits['gsa_cities_' + state + '_' + fy];
      if (!raw) continue;
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.success && Array.isArray(parsed.cities)) {
          bundle[state] = parsed.cities;
        }
      } catch (e) { /* ignore corrupted entry */ }
    }
    return bundle;
  } catch (e) {
    console.warn('getInlineGSACitiesBundle failed: ' + e.message);
    return {};
  }
}

// Trigger handler (warmGSACitiesCache) + installer/uninstaller live in
// 99_triggers/CacheWarming.js.

/**
 * Drop every CONUS state's cached city list. Run from the Apps Script
 * editor when GSA pushes new rates mid-cycle. The next page-load (or
 * the next warmGSACitiesCache run) repopulates the cache.
 *
 * @editor
 */
function clearGSACitiesCache() {
  var cache = CacheService.getScriptCache();
  var fy = _gsaCurrentFiscalYear();
  var keys = GSA_CONUS_STATES.map(function(s) { return 'gsa_cities_' + s + '_' + fy; });
  cache.removeAll(keys);
  console.log('clearGSACitiesCache: cleared ' + keys.length + ' keys for FY' + fy);
  return { success: true, cleared: keys.length };
}

/**
 * Parse the GSA API response into a normalized format
 * API Response structure:
 * {
 *   "rates": [{
 *     "rate": [{
 *       "months": { "month": [...] },
 *       "meals": 92,
 *       "city": "District of Columbia",
 *       "county": "...",
 *       "standardRate": "false"
 *     }],
 *     "state": "DC",
 *     "year": 2025,
 *     "isOconus": "false"
 *   }]
 * }
 * @param {Object} data - Raw API response
 * @param {string} requestedCity - City that was requested
 * @param {string} requestedState - State that was requested
 * @param {number} fiscalYear - Fiscal year
 * @returns {Object} Normalized per diem data
 */
function parsePerDiemResponse(data, requestedCity, requestedState, fiscalYear) {
  try {
    // Check for the rates array at top level
    if (!data || !data.rates || data.rates.length === 0) {
      return {
        success: false,
        error: 'No per diem data found for this location'
      };
    }

    const ratesWrapper = data.rates[0];

    // Check for the rate array inside rates
    if (!ratesWrapper.rate || ratesWrapper.rate.length === 0) {
      return {
        success: false,
        error: 'No rate data available for this location'
      };
    }

    // Get the first rate entry (primary location)
    const rateData = ratesWrapper.rate[0];

    // Extract monthly lodging rates
    const monthlyLodging = {};
    if (rateData.months && rateData.months.month) {
      rateData.months.month.forEach(month => {
        monthlyLodging[month.number] = parseFloat(month.value) || 0;
      });
    }

    // M&IE rate is constant for the location
    const mieRate = parseFloat(rateData.meals) || 0;

    return {
      success: true,
      city: rateData.city || requestedCity,
      county: rateData.county || '',
      state: ratesWrapper.state || requestedState,
      fiscalYear: ratesWrapper.year || fiscalYear,
      mieRate: mieRate,
      monthlyLodging: monthlyLodging,
      isStandardRate: rateData.standardRate === 'true',
      isOconus: ratesWrapper.isOconus === 'true'
    };

  } catch (error) {
    console.error('Error parsing per diem response:', error);
    return {
      success: false,
      error: 'Failed to parse per diem data: ' + error.message
    };
  }
}

// =============================================================================
// FISCAL YEAR FUNCTIONS
// =============================================================================

/**
 * Calculate fiscal year from a date
 * Federal fiscal year runs October 1 - September 30
 * FY2026 = Oct 1, 2025 through Sep 30, 2026
 * @param {Date|string} date - Date to check
 * @returns {number} Fiscal year
 */
/**
 * Parse a date string (YYYY-MM-DD) into components
 * Avoids timezone issues by not using Date object methods
 */
function parseDateString(dateStr) {
  const str = typeof dateStr === 'string' ? dateStr : new Date(dateStr).toISOString().split('T')[0];
  const parts = str.split('-');
  return {
    year: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10),  // 1-indexed (1 = January)
    day: parseInt(parts[2], 10)
  };
}

/**
 * Add days to a date string, returns new date string
 */
function addDaysToDateString(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z'); // Use noon UTC to avoid DST issues
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function getFiscalYear(date) {
  const parsed = parseDateString(date);
  // October (10), November (11), December (12) are in the NEXT fiscal year
  if (parsed.month >= 10) {
    return parsed.year + 1;
  }
  return parsed.year;
}

/**
 * Get fiscal year range for a given fiscal year
 * @param {number} fiscalYear - The fiscal year (e.g., 2026)
 * @returns {Object} { start: Date, end: Date }
 */
function getFiscalYearRange(fiscalYear) {
  return {
    start: new Date(fiscalYear - 1, 9, 1), // October 1 of previous calendar year
    end: new Date(fiscalYear, 8, 30)       // September 30 of fiscal year
  };
}

// =============================================================================
// LODGING CALCULATION
// =============================================================================

/**
 * Calculate total lodging cost for a trip
 * Lodging is paid per night (not per day)
 * @param {string} city - Destination city
 * @param {string} state - Destination state abbreviation
 * @param {Date|string} checkIn - Check-in date
 * @param {Date|string} checkOut - Check-out date
 * @returns {Object} { success, total, nights, breakdown, rateInfo }
 */
function calculateLodging(city, state, checkIn, checkOut) {
  try {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    // Validate dates
    if (checkOutDate <= checkInDate) {
      return {
        success: false,
        error: 'Check-out date must be after check-in date'
      };
    }

    // Calculate number of nights
    const nights = Math.ceil((checkOutDate - checkInDate) / TIME_CONSTANTS.MS_PER_DAY);

    // Get fiscal year from check-in date
    const fiscalYear = getFiscalYear(checkInDate);

    // Fetch per diem rates
    const rateData = fetchPerDiemRates(city, state, fiscalYear);
    if (!rateData.success) {
      return rateData;
    }

    // Calculate lodging for each night (rates can vary by month)
    const breakdown = [];
    let total = 0;
    const checkInDateStr = checkInDate.toISOString().split('T')[0];

    for (let i = 0; i < nights; i++) {
      const nightDateStr = addDaysToDateString(checkInDateStr, i);
      const parsed = parseDateString(nightDateStr);
      const rate = rateData.monthlyLodging[parsed.month] || 0;

      breakdown.push({
        date: nightDateStr,
        month: parsed.month,
        rate: rate
      });

      total += rate;
    }

    return {
      success: true,
      total: total,
      nights: nights,
      averageRate: nights > 0 ? total / nights : 0,
      breakdown: breakdown,
      rateInfo: {
        city: rateData.city,
        state: rateData.state,
        fiscalYear: fiscalYear,
        isStandardRate: rateData.isStandardRate
      }
    };

  } catch (error) {
    console.error('Error calculating lodging:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// =============================================================================
// M&IE CALCULATION
// =============================================================================

/**
 * Calculate total M&IE (Meals & Incidental Expenses) for a trip
 * First and last day of travel receive 75% of the daily rate
 * @param {string} city - Destination city
 * @param {string} state - Destination state abbreviation
 * @param {Date|string} startDate - Travel start date
 * @param {Date|string} endDate - Travel end date
 * @returns {Object} { success, total, days, dailyRate, breakdown }
 */
function calculateMIE(city, state, startDate, endDate) {
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Validate dates
    if (end < start) {
      return {
        success: false,
        error: 'End date must be on or after start date'
      };
    }

    // Calculate number of days (inclusive)
    const days = Math.ceil((end - start) / TIME_CONSTANTS.MS_PER_DAY) + 1;

    // Get fiscal year from start date
    const fiscalYear = getFiscalYear(start);

    // Fetch per diem rates
    const rateData = fetchPerDiemRates(city, state, fiscalYear);
    if (!rateData.success) {
      return rateData;
    }

    const dailyRate = rateData.mieRate;
    const reducedRate = dailyRate * 0.75; // 75% for first/last day

    // Calculate M&IE for each day
    const breakdown = [];
    let total = 0;
    const startDateStr = start.toISOString().split('T')[0];

    for (let i = 0; i < days; i++) {
      const dayDateStr = addDaysToDateString(startDateStr, i);

      const isFirstDay = i === 0;
      const isLastDay = i === days - 1;
      const isPartialDay = isFirstDay || isLastDay;

      // Single day trip gets 75% rate
      const rate = (days === 1 || isPartialDay) ? reducedRate : dailyRate;

      breakdown.push({
        date: dayDateStr,
        rate: rate,
        isPartialDay: isPartialDay,
        percentage: isPartialDay ? 75 : 100
      });

      total += rate;
    }

    return {
      success: true,
      total: total,
      days: days,
      dailyRate: dailyRate,
      reducedRate: reducedRate,
      breakdown: breakdown,
      rateInfo: {
        city: rateData.city,
        state: rateData.state,
        fiscalYear: fiscalYear
      }
    };

  } catch (error) {
    console.error('Error calculating M&IE:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// =============================================================================
// MILEAGE FUNCTIONS
// =============================================================================

/**
 * Get current mileage rates from Script Properties
 * Returns the extended shape used by GSA Per Diem display (privateRate, govRate, effectiveDate).
 * Named getGSAMileageRates() to avoid collision with getMileageRates() in TravelCostUtils.js
 * which returns { private, gov } and is used by calculateTransportationTotal().
 * @returns {Object} { privateRate, govRate, effectiveDate }
 */
function getGSAMileageRates() {
  return {
    privateRate: getPrivateMileageRate(),
    govRate: getGovMileageRate(),
    effectiveDate: getMileageRateEffectiveDate()
  };
}

/**
 * Calculate mileage cost
 * @param {number} miles - Number of miles
 * @param {string} vehicleType - 'private' or 'gov'
 * @returns {Object} { cost, miles, rate, vehicleType }
 */
function calculateMileage(miles, vehicleType) {
  const rates = getGSAMileageRates();
  const rate = vehicleType === 'gov' ? rates.govRate : rates.privateRate;

  return {
    cost: miles * rate,
    miles: miles,
    rate: rate,
    vehicleType: vehicleType || 'private'
  };
}

// =============================================================================
// CLIENT-CALLABLE FUNCTIONS
// =============================================================================

/**
 * Get per diem rates for client display
 * @param {string} city - City name
 * @param {string} state - State abbreviation
 * @param {string} travelDate - Travel date to determine fiscal year
 * @returns {Object} Per diem rates
 */
function getPerDiemRatesForClient(city, state, travelDate) {
  const fiscalYear = getFiscalYear(new Date(travelDate));
  return fetchPerDiemRates(city, state, fiscalYear);
}

/**
 * Get mileage rates for client display.
 * Delegates to getMileageRates() in TravelCostUtils.js so the client gets
 * the {private, gov} shape it expects (the GSA-internal shape with
 * privateRate/govRate/effectiveDate is wrong for client consumers — the
 * client falls back silently if reshape is missed). Both this and the
 * server-side getMileageRates() ultimately read the same script properties
 * via getGSAMileageRates().
 *
 * @returns {{private: number, gov: number}}
 * @client
 */
function getMileageRatesForClient() {
  return getMileageRates();
}

/**
 * Calculate GSA per diem for a traveler leg
 * Handles seasonal rate changes mid-trip and fiscal year boundaries
 * Returns calculated totals in the same format as DOS/DoD for consistency
 * @param {string} city - City name
 * @param {string} state - State abbreviation
 * @param {string} startDate - Travel start date (YYYY-MM-DD)
 * @param {string} endDate - Travel end date (YYYY-MM-DD)
 * @returns {Object} { success, perDiem: { lodging, mie } }
 */
function calculateGSAPerDiem(city, state, startDate, endDate) {
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Validate dates
    if (end < start) {
      return { success: false, error: 'End date must be on or after start date' };
    }

    // Calculate days and nights
    const msPerDay = 24 * 60 * 60 * 1000;
    const totalDays = Math.round((end - start) / msPerDay) + 1;
    const nights = Math.max(0, totalDays - 1);

    // Cache rate data by fiscal year to avoid redundant API calls
    const rateCache = {};

    // Helper to get rates for a specific date (handles fiscal year boundaries)
    function getRatesForDate(date) {
      const fiscalYear = getFiscalYear(date);
      if (!rateCache[fiscalYear]) {
        rateCache[fiscalYear] = fetchPerDiemRates(city, state, fiscalYear);
      }
      return rateCache[fiscalYear];
    }

    // Calculate lodging day by day (lodging is per night, so we iterate nights)
    let lodgingTotal = 0;
    const lodgingBreakdown = [];
    const startDateStr = start.toISOString().split('T')[0];

    for (let i = 0; i < nights; i++) {
      const nightDateStr = addDaysToDateString(startDateStr, i);
      const parsed = parseDateString(nightDateStr);

      const rateData = getRatesForDate(nightDateStr);
      if (!rateData.success) {
        return rateData;
      }

      const lodgingRate = rateData.monthlyLodging[parsed.month] || 0;

      lodgingTotal += lodgingRate;
      lodgingBreakdown.push({
        date: nightDateStr,
        month: parsed.month,
        rate: lodgingRate,
        fiscalYear: getFiscalYear(nightDateStr)
      });
    }

    // Calculate M&IE day by day (75% first/last day, 100% middle days)
    let mieTotal = 0;
    const mieBreakdown = [];

    for (let i = 0; i < totalDays; i++) {
      const dayDateStr = addDaysToDateString(startDateStr, i);

      const rateData = getRatesForDate(dayDateStr);
      if (!rateData.success) {
        return rateData;
      }

      const mieRate = rateData.mieRate || 0;
      const isFirstDay = i === 0;
      const isLastDay = i === totalDays - 1;
      const isPartialDay = isFirstDay || isLastDay;

      // Single day trip or first/last day gets 75%
      const appliedRate = (totalDays === 1 || isPartialDay) ? mieRate * 0.75 : mieRate;

      mieTotal += appliedRate;
      mieBreakdown.push({
        date: dayDateStr,
        dailyRate: mieRate,
        appliedRate: appliedRate,
        percentage: isPartialDay ? 75 : 100,
        fiscalYear: getFiscalYear(dayDateStr)
      });
    }

    // Get primary rate info from start date for display
    const primaryRateData = getRatesForDate(startDateStr);
    const averageLodgingRate = nights > 0 ? lodgingTotal / nights : 0;
    const averageMieRate = totalDays > 0 ? mieTotal / totalDays : 0;

    // Check if rates varied during trip
    const fiscalYearsUsed = [...new Set(Object.keys(rateCache).map(Number))];
    const ratesVaried = lodgingBreakdown.some((b, i, arr) => i > 0 && b.rate !== arr[0].rate) ||
                        mieBreakdown.some((b, i, arr) => i > 0 && b.dailyRate !== arr[0].dailyRate);

    return {
      success: true,
      perDiem: {
        lodging: {
          rate: averageLodgingRate,
          nights: nights,
          total: lodgingTotal,
          breakdown: ratesVaried ? lodgingBreakdown : undefined
        },
        mie: {
          dailyRate: primaryRateData.mieRate || 0,
          days: totalDays,
          total: mieTotal,
          breakdown: ratesVaried ? mieBreakdown : undefined
        }
      },
      rateInfo: {
        city: primaryRateData.city || city,
        state: primaryRateData.state || state,
        fiscalYear: fiscalYearsUsed.length === 1 ? fiscalYearsUsed[0] : fiscalYearsUsed,
        isStandardRate: primaryRateData.isStandardRate,
        ratesVaried: ratesVaried
      }
    };

  } catch (error) {
    console.error('Error calculating GSA per diem:', error);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// SETUP FUNCTIONS
// =============================================================================

/**
 * Setup Script Properties for GSA Per Diem Service
 * RUN THIS ONCE to configure the required properties
 * After running, update the API key with your actual key
 */
function _setupGSAPerDiemProperties() {
  const props = PropertiesService.getScriptProperties();

  // Set properties - UPDATE THE API KEY!
  props.setProperties({
    'GSA_PERDIEM_API_KEY': 'YOUR_API_KEY_HERE',  // <-- Replace with your actual API key
    'MILEAGE_RATE_PRIVATE': '0.725',
    'MILEAGE_RATE_GOV': '0.205',
    'MILEAGE_RATE_EFFECTIVE_DATE': '2026-01-01'
  });

  console.log('Script Properties have been set!');
  console.log('Current properties:', props.getProperties());

  // Reminder to update API key
  const apiKey = props.getProperty('GSA_PERDIEM_API_KEY');
  if (apiKey === 'YOUR_API_KEY_HERE') {
    console.log('⚠️ IMPORTANT: Update GSA_PERDIEM_API_KEY with your actual API key!');
    console.log('Run this function again after updating the key in the code.');
  }

  return props.getProperties();
}

/**
 * View current Script Properties (for debugging)
 */
function _viewScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  console.log('Current Script Properties:');
  console.log(JSON.stringify(allProps, null, 2));
  return allProps;
}

// =============================================================================
// TESTING FUNCTIONS
// =============================================================================

/**
 * Test the GSA Per Diem API connection
 * Run this from the Apps Script editor to verify setup
 */
function _testGSAPerDiemAPI() {
  console.log('Testing GSA Per Diem API...');

  // Try FY2025 first (more likely to have data), then FY2026
  const years = [2025, 2026];
  const cities = [
    { city: 'Washington', state: 'DC' },
    { city: 'Chicago', state: 'IL' }
  ];

  for (const year of years) {
    for (const loc of cities) {
      console.log(`\nTrying ${loc.city}, ${loc.state} for FY${year}...`);
      const result = fetchPerDiemRates(loc.city, loc.state, year);

      if (result.success) {
        console.log('✓ SUCCESS!');
        console.log(`  City: ${result.city}`);
        console.log(`  M&IE Rate: $${result.mieRate}`);
        console.log(`  January Lodging: $${result.monthlyLodging[1]}`);
        return result;
      } else {
        console.log(`✗ Failed: ${result.error}`);
      }
    }
  }

  console.log('\nAll attempts failed. Running raw API debug...');
  return testRawAPIResponse();
}

/**
 * Debug function to see raw API response
 */
function _testRawAPIResponse() {
  const apiKey = getGSAApiKey();

  // Try a simple request
  const url = 'https://api.gsa.gov/travel/perdiem/v2/rates/city/Washington/state/DC/year/2025';
  console.log('Testing URL:', url);

  const response = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  });

  console.log('Response Code:', response.getResponseCode());
  console.log('Raw Response:', response.getContentText());

  return {
    code: response.getResponseCode(),
    body: response.getContentText()
  };
}

