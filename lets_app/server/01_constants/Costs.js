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
  // NOTE: this constant has NO READERS. Grepped at the time of writing —
  // nothing references COST_DEFAULTS. The live gross-up comes from the
  // `other_cost_percentage` Script Property via Props.js:117, and the
  // first/last-day M&IE rate is inlined at 30_services/Costs.js:340.
  //
  // Left in place rather than deleted because it is inherited TRIP code and
  // removal is out of scope here, but do not treat either value as live.
  // Editing them changes nothing.
  OTHER_COST_PERCENTAGE: 0.30,   // unused — see note above
  FIRST_LAST_DAY_MIE_RATE: 0.75  // unused — the real 0.75 is inlined
};

// Lock acquisition timeout for serialized writes (admin bulk ops, etc.)
const LOCK_TIMEOUT_MS = 30000;   // 30 seconds

const CHAR_LIMITS = {
  BLUF: 500,
  DETAILED_PURPOSE: 2000,
  COMMENTS: 1000,
  TRIP_NAME: 200
};
