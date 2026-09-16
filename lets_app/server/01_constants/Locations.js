/**
 * Locations.js
 * Location-type enum + sites-requiring-name list + OCONUS state codes +
 * recognized US country-name variants. Pure data; the helper functions
 * that consume these live in 10_lib/Locations.js.
 */

const LOCATION_TYPES = {
  CONFERENCE: 'conference',
  CLIENT_SITE: 'client-site',
  CONTRACTOR_SITE: 'contractor-site',
  TEB: 'teb',
  OTHER: 'other'
};

// Location types that require site name field
const LOCATION_TYPES_WITH_SITE = [
  LOCATION_TYPES.CLIENT_SITE,
  LOCATION_TYPES.CONTRACTOR_SITE
];

// OCONUS (Outside Continental United States) state/territory codes.
// Used for DoD per diem rate determination.
const OCONUS_STATES = ['AK', 'HI', 'PR', 'VI', 'GU', 'AS', 'MP'];

// Valid US country-name variations. Data sources differ in how they spell
// the US, so we accept all common variants.
const US_COUNTRY_NAMES = ['United States', 'USA', 'US', 'United States of America'];
