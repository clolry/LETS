/**
 * Costs.js
 * Cost-calculation constants + character limits + admin lock timeout.
 *
 * Mileage rates are NOT here — they're configurable values read from
 * script properties via 00_config/Props.js (getPrivateMileageRate +
 * getGovMileageRate). The catch-block fallback in 30_services/Costs.js
 * has its own hardcoded 0.70/0.22 defaults for the rare PropertiesService-
 * failure case.
 */

const COST_DEFAULTS = {
  OTHER_COST_PERCENTAGE: 0.15,   // 15% GO.gov gross-up
  FIRST_LAST_DAY_MIE_RATE: 0.75  // 75% of M&IE for first/last day
};

// Lock acquisition timeout for serialized writes (admin bulk ops, etc.)
const LOCK_TIMEOUT_MS = 30000;   // 30 seconds

const CHAR_LIMITS = {
  BLUF: 500,
  DETAILED_PURPOSE: 2000,
  COMMENTS: 1000,
  TRIP_NAME: 200
};
