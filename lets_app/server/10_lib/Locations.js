/**
 * Locations.js (lib)
 * Location classification + display formatting helpers.
 * Consumes OCONUS_STATES and US_COUNTRY_NAMES from 01_constants/Locations.js
 * (they live as data there; logic lives here).
 */

/**
 * Check if a country is international (non-US). Handles country name variants.
 *
 * @param {string} country - Country name to check
 * @returns {boolean} True if international
 * @server
 */
function isInternationalLocation(country) {
  if (!country) return false;
  return !US_COUNTRY_NAMES.includes(country);
}

/**
 * Check if a US location is OCONUS (Outside Continental US).
 * Only applies to US locations — international locations return false.
 *
 * @param {string} state - State/territory code (e.g., 'AK', 'HI')
 * @param {string} [country] - Country name (optional, for validation)
 * @returns {boolean} True if OCONUS
 * @server
 */
function isOCONUSLocation(state, country) {
  if (country && isInternationalLocation(country)) return false;
  return OCONUS_STATES.includes(state);
}

/**
 * Determine per diem rate source based on location.
 * Sources: GSA (CONUS), DoD (OCONUS), DOS (international).
 *
 * @param {string} country - Country name
 * @param {string} state - State/territory code
 * @returns {string} 'GSA' | 'DoD' | 'DOS'
 * @server
 */
function getPerDiemSource(country, state) {
  if (isInternationalLocation(country)) return 'DOS';
  if (isOCONUSLocation(state, country)) return 'DoD';
  return 'GSA';
}

/**
 * Format a leg's location for display. Format: "Site Name - City, State" or
 * "Site Name - City, Country" (international).
 *
 * @param {Object} leg - Leg object with siteName, city, state, country
 * @returns {string} Formatted location string
 * @server
 */
function formatLocationDisplay(leg) {
  if (!leg) return '';
  const parts = [];

  if (leg.siteName) parts.push(leg.siteName);

  let locationPart = '';
  if (leg.city) {
    locationPart = leg.city;
    const international = isInternationalLocation(leg.country);
    if (!international && leg.state) {
      locationPart += ', ' + leg.state;
    } else if (international && leg.country) {
      locationPart += ', ' + leg.country;
    }
  }
  if (locationPart) parts.push(locationPart);

  return parts.join(' - ');
}

/**
 * Calculate location flags and per diem source for a leg.
 * @param {Object} leg - Leg with country and state
 * @returns {{isInternational: boolean, isOCONUS: boolean, perDiemSource: string}}
 * @server
 */
function getLegLocationFlags(leg) {
  const country = leg.country || 'United States';
  const state = leg.state || '';
  return {
    isInternational: isInternationalLocation(country),
    isOCONUS: isOCONUSLocation(state, country),
    perDiemSource: getPerDiemSource(country, state)
  };
}

/**
 * Process a leg for database storage — calculates all derived fields.
 * @param {Object} leg - Raw leg data
 * @returns {Object} Leg data with calculated fields added
 * @server
 */
function processLegForStorage(leg) {
  const flags = getLegLocationFlags(leg);
  const locationDisplay = formatLocationDisplay(leg);
  return {
    ...leg,
    country: leg.country || 'United States',
    isInternational: flags.isInternational,
    isOCONUS: flags.isOCONUS,
    perDiemSource: flags.perDiemSource,
    locationDisplay: locationDisplay
  };
}
