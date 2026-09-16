/**
 * TravelCostUtils.js
 * Server-side cost calculation utilities
 *
 * Mirrors TravelCostService.html (client) for server-side validation
 * and triggered recalculations.
 *
 * Used by:
 * - TravelSubmissionService.js (initial submission)
 * - TravelReviewService.js (itinerary edits, cost updates)
 */

// =============================================================================
// DEFAULT VALUES (references TravelConstants.js with fallbacks)
// =============================================================================

// Hardcoded fallbacks for the PropertiesService-failure catch path only.
// Normal reads go through Props.js getters (getPrivateMileageRate etc.)
// which themselves have these same default values — duplicated here so
// the catch block doesn't depend on Props.js working.
const COST_RATE_DEFAULTS = {
  PRIVATE_MILEAGE_RATE: 0.70,
  GOV_MILEAGE_RATE: 0.22,
  OTHER_COST_PERCENTAGE: 15
};

// =============================================================================
// MILEAGE RATES
// =============================================================================

/**
 * Get mileage rates for server-side cost calculations.
 * Delegates to getGSAMileageRates() (in GSAPerDiemService.js) which is the
 * single source of truth for reading the MILEAGE_RATE_PRIVATE /
 * MILEAGE_RATE_GOV script properties. This function reshapes the result
 * to drop effectiveDate (not needed for cost calc) and uses the keys
 * (private, gov) that the existing callers expect.
 *
 * @returns {Object} { private, gov }
 */
function getMileageRates() {
  try {
    const rates = getGSAMileageRates();
    return { private: rates.privateRate, gov: rates.govRate };
  } catch (e) {
    return {
      private: COST_RATE_DEFAULTS.PRIVATE_MILEAGE_RATE,
      gov: COST_RATE_DEFAULTS.GOV_MILEAGE_RATE
    };
  }
}

/**
 * Get default other cost percentage. Delegates to Props.js getter (which
 * handles the property read + default); catch-block returns the local
 * hardcoded default if PropertiesService itself is broken.
 *
 * @returns {number} Percentage (e.g., 15)
 * @server
 */
function getDefaultOtherPercentage() {
  try {
    return getOtherCostPercentage();
  } catch (e) {
    return COST_RATE_DEFAULTS.OTHER_COST_PERCENTAGE;
  }
}

// =============================================================================
// UNIFIED PER DIEM LOOKUP (Server-Side)
// =============================================================================
// Mirrors client-side TravelCostService.getPerDiemRates()
// Routes to appropriate per diem service based on location type
// Returns pre-calculated totals with day-by-day rate handling

/**
 * Get per diem rates for a leg using day-by-day calculations
 * Unified dispatcher that routes to GSA, DoD, or DOS service
 *
 * @param {Object} params - Lookup parameters
 * @param {string} params.city - City name
 * @param {string} params.state - State code (for US locations)
 * @param {string} params.country - Country name
 * @param {string} params.locationType - 'CONUS', 'OCONUS', or 'Foreign'
 * @param {string} params.startDate - Start date (YYYY-MM-DD or Date)
 * @param {string} params.endDate - End date (YYYY-MM-DD or Date)
 * @param {boolean} [params.isInternational] - Override for international detection
 * @returns {Object} Normalized response with pre-calculated totals
 */
function getPerDiemForLeg(params) {
  try {
    const { city, state, country, locationType, startDate, endDate, isInternational } = params;

    // Determine location type
    const isIntl = isInternational || (country && country !== 'United States');
    const effectiveLocationType = locationType || (isIntl ? 'Foreign' : 'CONUS');

    // Route to appropriate service
    if (isIntl || effectiveLocationType === 'Foreign') {
      // Foreign locations - DOS rates
      return _fetchDOSPerDiem(country, city, startDate, endDate);
    } else if (effectiveLocationType === 'OCONUS') {
      // OCONUS - DoD rates
      return _fetchDoDPerDiem(state, city, startDate, endDate);
    } else {
      // CONUS - GSA rates
      return _fetchGSAPerDiem(city, state, startDate, endDate);
    }
  } catch (error) {
    console.error('Error in getPerDiemForLeg:', error);
    return {
      success: false,
      error: error.message,
      lodgingTotal: 0,
      mieTotal: 0
    };
  }
}

/**
 * Fetch GSA per diem with day-by-day calculation
 * @private
 */
function _fetchGSAPerDiem(city, state, startDate, endDate) {
  const result = calculateGSAPerDiem(city, state, startDate, endDate);

  if (!result.success) {
    return {
      success: false,
      error: result.error || 'GSA lookup failed',
      source: 'GSA',
      lodgingTotal: 0,
      mieTotal: 0
    };
  }

  return _normalizePerDiemResponse(result, 'GSA');
}

/**
 * Fetch DoD per diem with day-by-day calculation
 * @private
 */
function _fetchDoDPerDiem(state, city, startDate, endDate) {
  const result = calculateDoDPerDiem({
    state: state,
    city: city,
    travelStartDate: startDate,
    travelEndDate: endDate
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error || 'DoD lookup failed',
      source: 'DoD',
      lodgingTotal: 0,
      mieTotal: 0
    };
  }

  return _normalizePerDiemResponse(result, 'DoD');
}

/**
 * Fetch DOS (Foreign) per diem with day-by-day calculation
 * @private
 */
function _fetchDOSPerDiem(country, location, startDate, endDate) {
  const result = calculateForeignPerDiem({
    country: country,
    location: location,
    travelStartDate: startDate,
    travelEndDate: endDate
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error || 'DOS lookup failed',
      source: 'DOS',
      lodgingTotal: 0,
      mieTotal: 0
    };
  }

  return _normalizePerDiemResponse(result, 'DOS');
}

/**
 * Normalize per diem response from any source into consistent format
 * @private
 */
function _normalizePerDiemResponse(result, source) {
  // Handle different response structures from GSA/DoD/DOS services
  // GSA returns: { perDiem: { lodging: { total, rate, nights }, mie: { total, dailyRate, days } } }
  // DoD/DOS may return: { lodgingTotal, mieTotal, ... } or { calculated: { ... } }

  const perDiem = result.perDiem || {};
  const lodgingData = perDiem.lodging || {};
  const mieData = perDiem.mie || {};

  // Extract totals - check nested perDiem structure first, then flat structure
  const lodgingTotal = lodgingData.total || result.lodgingTotal || result.calculated?.lodgingTotal || 0;
  const mieTotal = mieData.total || result.mieTotal || result.calculated?.mieTotal || 0;

  // Extract rates
  const lodgingRate = lodgingData.rate || result.averageLodgingRate || result.lodgingRate || result.rates?.lodging || 0;
  const mieRate = mieData.dailyRate || result.mieRate || result.rates?.mie || 0;

  // Extract duration
  const nights = lodgingData.nights || result.nights || result.calculated?.nights || 0;
  const days = mieData.days || result.days || result.calculated?.days || 0;

  // Extract rate variation info
  const ratesVaried = result.rateInfo?.ratesVaried || result.ratesVaried || false;
  const breakdown = lodgingData.breakdown || mieData.breakdown || result.breakdown || null;

  return {
    success: true,
    source: source,

    // Pre-calculated totals (use these, not rate × nights)
    lodgingTotal: lodgingTotal,
    mieTotal: mieTotal,

    // Average/display rates
    lodgingRate: lodgingRate,
    mieRate: mieRate,

    // Duration
    nights: nights,
    days: days,

    // Whether rates varied during the trip (seasonal changes)
    ratesVaried: ratesVaried,

    // Detailed breakdown if available
    breakdown: breakdown
  };
}

// =============================================================================
// DATE CALCULATIONS
// =============================================================================

/**
 * Calculate number of nights between two dates
 * (For lodging calculations)
 * @param {Date|string} startDate
 * @param {Date|string} endDate
 * @returns {number} Number of nights (minimum 0)
 */
function calculateNights(startDate, endDate) {
  if (!startDate || !endDate) return 0;

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Reset time to avoid timezone issues
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const diffTime = end - start;
  const MS_PER_DAY = (typeof TIME_CONSTANTS !== 'undefined') ? TIME_CONSTANTS.MS_PER_DAY : (1000 * 60 * 60 * 24);
  const diffDays = Math.round(diffTime / MS_PER_DAY);

  return Math.max(0, diffDays);
}

/**
 * Calculate number of M&IE days between two dates
 * (For per diem calculations - inclusive of both start and end)
 * @param {Date|string} startDate
 * @param {Date|string} endDate
 * @returns {number} Number of days (minimum 1 if valid dates)
 */
function calculateMieDays(startDate, endDate) {
  const nights = calculateNights(startDate, endDate);
  return nights > 0 ? nights + 1 : (startDate && endDate ? 1 : 0);
}

// =============================================================================
// LODGING CALCULATIONS
// =============================================================================

/**
 * Calculate lodging total for a leg
 * @param {number} nights - Number of nights
 * @param {number} rate - Nightly rate
 * @param {Object} [override] - Optional override { enabled, amount }
 * @returns {Object} { nights, rate, calculated, total }
 */
function calculateLodgingTotal(nights, rate, override) {
  const n = parseInt(nights) || 0;
  const r = parseFloat(rate) || 0;
  const calculated = n * r;

  // Use override if enabled, otherwise use calculated
  const total = (override && override.enabled)
    ? (parseFloat(override.amount) || 0)
    : calculated;

  return {
    nights: n,
    rate: r,
    calculated,
    total,
    isOverridden: override && override.enabled
  };
}

// =============================================================================
// M&IE CALCULATIONS
// =============================================================================

/**
 * Calculate M&IE total with 75% first/last day rule
 * Federal per diem rule: 75% on first and last day, 100% on middle days
 *
 * @param {number} days - Number of M&IE days
 * @param {number} rate - Daily M&IE rate
 * @param {Object} [override] - Optional override { enabled, amount }
 * @returns {Object} { days, rate, calculated, total, breakdown }
 */
function calculateMieTotal(days, rate, override) {
  const d = parseInt(days) || 0;
  const r = parseFloat(rate) || 0;

  if (d === 0 || r === 0) {
    return {
      days: d,
      rate: r,
      calculated: 0,
      total: 0,
      breakdown: []
    };
  }

  const reducedRate = r * 0.75;
  const breakdown = [];
  let calculated = 0;

  for (let i = 0; i < d; i++) {
    const isFirstDay = i === 0;
    const isLastDay = i === d - 1;
    const isPartialDay = isFirstDay || isLastDay;

    // Single day trip or first/last day gets 75%
    const dayRate = (d === 1 || isPartialDay) ? reducedRate : r;

    breakdown.push({
      day: i + 1,
      rate: dayRate,
      percentage: isPartialDay ? 75 : 100,
      isPartialDay
    });

    calculated += dayRate;
  }

  // Use override if enabled, otherwise use calculated
  const total = (override && override.enabled)
    ? (parseFloat(override.amount) || 0)
    : calculated;

  return {
    days: d,
    rate: r,
    calculated,
    total,
    breakdown,
    isOverridden: override && override.enabled
  };
}

// =============================================================================
// TRANSPORTATION CALCULATIONS
// =============================================================================

/**
 * Calculate transportation costs for a traveler
 * @param {Object} options
 * @param {string} options.transportMode - 'air', 'private', 'gov', 'rental', etc.
 * @param {number} options.ticketCost - Air/rail ticket cost
 * @param {number} options.totalMiles - Total miles for POV
 * @param {boolean} options.needsRentalCar - Whether rental car needed
 * @param {number} options.rentalCarCost - Rental car cost
 * @param {Object} [mileageRates] - Optional rates, will fetch if not provided
 * @returns {Object} { transportationTotal, mileageRate, mileageCost, rentalCarCost }
 */
function calculateTransportationTotal(options, mileageRates) {
  const rates = mileageRates || getMileageRates();
  const transportMode = options.transportMode || '';

  let transportationTotal = 0;
  let mileageRate = 0;
  let mileageCost = 0;

  if (transportMode === 'private') {
    mileageRate = rates.private;
    mileageCost = (parseFloat(options.totalMiles) || 0) * mileageRate;
    transportationTotal = mileageCost;
  } else if (transportMode === 'gov') {
    mileageRate = rates.gov;
    mileageCost = (parseFloat(options.totalMiles) || 0) * mileageRate;
    transportationTotal = mileageCost;
  } else {
    // Air, rental, rail, bus, etc.
    transportationTotal = parseFloat(options.ticketCost) || 0;
  }

  // Add rental car cost if applicable (not when primary mode is already rental)
  let rentalCarCost = 0;
  if (options.needsRentalCar && transportMode !== 'rental') {
    rentalCarCost = parseFloat(options.rentalCarCost) || 0;
    transportationTotal += rentalCarCost;
  }

  return {
    transportMode,
    transportationTotal,
    mileageRate,
    mileageCost,
    totalMiles: parseFloat(options.totalMiles) || 0,
    ticketCost: parseFloat(options.ticketCost) || 0,
    rentalCarCost
  };
}

// =============================================================================
// LOCAL TRAVEL CALCULATIONS
// =============================================================================

/**
 * Calculate local travel reimbursement for a leg
 * Based on GSA Order OAS 5770.1B
 *
 * @param {Object} options
 * @param {number} options.localMiles - Miles driven locally
 * @param {number} options.localParking - Parking costs
 * @param {number} options.localTolls - Toll costs
 * @param {number} options.commuteDistance - Normal commute distance
 * @param {number} options.commuteParking - Normal commute parking
 * @param {boolean} options.wasGovVehicleAvailable - If gov vehicle was available
 * @param {Object} [mileageRates] - Optional rates
 * @returns {Object} Local travel breakdown
 */
function calculateLocalTravelReimbursement(options, mileageRates) {
  const rates = mileageRates || getMileageRates();

  const localMiles = parseFloat(options.localMiles) || 0;
  const localParking = parseFloat(options.localParking) || 0;
  const localTolls = parseFloat(options.localTolls) || 0;
  const commuteDistance = parseFloat(options.commuteDistance) || 0;
  const commuteParking = parseFloat(options.commuteParking) || 0;

  // Reimbursable mileage = actual - commute (minimum 0)
  const reimbursableMiles = Math.max(0, localMiles - commuteDistance);

  // Mileage rate: reduced if gov vehicle was available but chose POV
  const mileageRate = options.wasGovVehicleAvailable ? rates.gov : rates.private;
  const mileageReimbursement = reimbursableMiles * mileageRate;

  // Parking: reimburse excess over normal commute parking
  const excessParking = Math.max(0, localParking - commuteParking);

  // Tolls: fully reimbursable
  const tollsReimbursement = localTolls;

  // Total
  const total = mileageReimbursement + excessParking + tollsReimbursement;

  return {
    localMiles,
    reimbursableMiles,
    mileageRate,
    mileageReimbursement,
    localParking,
    excessParking,
    localTolls,
    tollsReimbursement,
    total
  };
}

// =============================================================================
// OTHER COSTS
// =============================================================================

/**
 * Calculate "other" costs (default 15% of transport + lodging + M&IE)
 * @param {number} transportation - Transportation total
 * @param {number} lodging - Lodging total
 * @param {number} mie - M&IE total
 * @param {number} [percentage] - Percentage to apply (default from config)
 * @returns {Object} { base, percentage, total }
 */
function calculateOtherCosts(transportation, lodging, mie, percentage) {
  const pct = percentage !== undefined ? percentage : getDefaultOtherPercentage();
  const base = (parseFloat(transportation) || 0) +
               (parseFloat(lodging) || 0) +
               (parseFloat(mie) || 0);
  const total = base * (pct / 100);

  return {
    base,
    percentage: pct,
    total
  };
}

// =============================================================================
// LEG COST CALCULATIONS
// =============================================================================

/**
 * Calculate costs for a single leg
 * @param {Object} leg - Leg data with dates
 * @param {Object} legCost - Existing leg cost data (rates, overrides)
 * @param {Object} traveler - Traveler data (for local travel calc)
 * @returns {Object} Complete leg cost breakdown
 */
function calculateLegCosts(leg, legCost, traveler) {
  // Independent lodging dates
  const lodgingStartDate = legCost.lodgingStartDate || leg.startDate;
  const lodgingEndDate = legCost.lodgingEndDate || leg.endDate;
  // Independent M&IE dates
  const mieStartDate = legCost.mieStartDate || leg.startDate;
  const mieEndDate = legCost.mieEndDate || leg.endDate;

  // Check if this is a local travel leg
  if (legCost.isLocalTravel) {
    const localTravel = calculateLocalTravelReimbursement({
      localMiles: legCost.localMilesDriven,
      localParking: legCost.localParking,
      localTolls: legCost.localTolls,
      commuteDistance: traveler.normalCommuteDistance || 0,
      commuteParking: traveler.normalCommuteParking || 0,
      wasGovVehicleAvailable: legCost.wasGovVehicleAvailable
    });

    return {
      isLocalTravel: true,
      lodgingStartDate,
      lodgingEndDate,
      mieStartDate,
      mieEndDate,
      ...localTravel,
      localTravelTotal: localTravel.total,
      legSubtotal: localTravel.total
    };
  }

  // Standard TDY leg - use separate date ranges for lodging and M&IE
  const nights = calculateNights(lodgingStartDate, lodgingEndDate);
  const mieDays = calculateMieDays(mieStartDate, mieEndDate);

  // Check for pre-calculated totals from unified per diem lookup
  // These account for day-by-day rate variations (seasonal changes, fiscal year boundaries)
  const hasPreCalculated = legCost._preCalculatedLodging !== null && legCost._preCalculatedLodging !== undefined;

  let lodging, mie;

  if (hasPreCalculated && !legCost.lodgingOverride && !legCost.mieOverride) {
    // Use pre-calculated totals from per diem service (day-by-day calculation)
    lodging = {
      nights: nights,
      rate: legCost.lodgingRate || 0,
      calculated: legCost._preCalculatedLodging,
      total: legCost._preCalculatedLodging,
      isOverridden: false
    };
    mie = {
      days: mieDays,
      rate: legCost.mieRate || 0,
      calculated: legCost._preCalculatedMie,
      total: legCost._preCalculatedMie,
      isOverridden: false
    };
  } else {
    // Fall back to simple rate × nights calculation (or use override)
    lodging = calculateLodgingTotal(nights, legCost.lodgingRate, {
      enabled: legCost.lodgingOverride,
      amount: legCost.lodgingOverrideAmount
    });

    mie = calculateMieTotal(mieDays, legCost.mieRate, {
      enabled: legCost.mieOverride,
      amount: legCost.mieOverrideAmount
    });
  }

  return {
    isLocalTravel: false,
    // Independent lodging dates
    lodgingStartDate,
    lodgingEndDate,
    lodgingUsesItineraryDates: legCost.lodgingUsesItineraryDates !== false,
    // Independent M&IE dates
    mieStartDate,
    mieEndDate,
    mieUsesItineraryDates: legCost.mieUsesItineraryDates !== false,
    ratesVaried: legCost._ratesVaried || false,

    // Lodging
    lodgingNights: lodging.nights,
    lodgingRate: lodging.rate,
    lodgingCalculated: lodging.calculated,
    lodgingTotal: lodging.total,
    lodgingOverride: lodging.isOverridden,

    // M&IE
    mieDays: mie.days,
    mieRate: mie.rate,
    mieCalculated: mie.calculated,
    mieTotal: mie.total,
    mieOverride: mie.isOverridden,

    // Subtotal
    legSubtotal: lodging.total + mie.total
  };
}

// =============================================================================
// TRAVELER COST CALCULATIONS
// =============================================================================

/**
 * Calculate all costs for a traveler
 * @param {Object} traveler - Traveler with legCosts, transportMode, etc.
 * @param {Array} legs - Array of leg objects
 * @param {Object} [mileageRates] - Optional mileage rates
 * @returns {Object} Complete traveler cost breakdown
 */
function calculateTravelerCosts(traveler, legs, mileageRates) {
  const rates = mileageRates || getMileageRates();

  // Get attending leg IDs
  const attendingLegIds = traveler.attendingLegs || legs.map(l => l.legId || l.id);

  // Calculate leg costs
  let lodgingTotal = 0;
  let mieTotal = 0;
  let localTravelTotal = 0;
  const legCostDetails = {};

  attendingLegIds.forEach(legId => {
    const leg = legs.find(l => (l.legId || l.id) === legId);
    const legCostData = traveler.legCosts?.[legId] || {};

    if (leg) {
      const calculated = calculateLegCosts(leg, legCostData, traveler);
      legCostDetails[legId] = calculated;

      if (calculated.isLocalTravel) {
        localTravelTotal += calculated.localTravelTotal || 0;
      } else {
        lodgingTotal += calculated.lodgingTotal || 0;
        mieTotal += calculated.mieTotal || 0;
      }
    }
  });

  // Transportation
  const transportation = calculateTransportationTotal({
    transportMode: traveler.transportMode,
    ticketCost: traveler.ticketCost,
    totalMiles: traveler.totalMiles,
    needsRentalCar: traveler.needsRentalCar,
    rentalCarCost: traveler.rentalCarCost
  }, rates);

  // Other costs
  const otherPercentage = traveler.otherPercentage !== undefined
    ? traveler.otherPercentage
    : getDefaultOtherPercentage();

  const other = calculateOtherCosts(
    transportation.transportationTotal,
    lodgingTotal,
    mieTotal,
    otherPercentage
  );

  // Subtotal
  const subtotal = transportation.transportationTotal + lodgingTotal + mieTotal + localTravelTotal + other.total;

  return {
    // Leg costs
    legCosts: legCostDetails,
    attendingLegIds,

    // Aggregated totals
    lodgingTotal,
    mieTotal,
    localTravelTotal,

    // Transportation
    transportMode: transportation.transportMode,
    transportationTotal: transportation.transportationTotal,
    mileageRate: transportation.mileageRate,
    mileageCost: transportation.mileageCost,
    totalMiles: transportation.totalMiles,
    ticketCost: transportation.ticketCost,
    rentalCarCost: transportation.rentalCarCost,

    // Other
    otherPercentage: other.percentage,
    otherTotal: other.total,

    // Final
    subtotal
  };
}

/**
 * Recalculate traveler costs when itinerary changes
 * Updates leg costs based on new dates, handles added/removed legs
 *
 * @param {Object} traveler - Current traveler data
 * @param {Array} newLegs - Updated legs array
 * @param {Object} [mileageRates] - Optional mileage rates
 * @param {Object} [oldLegsMap] - Map of legId -> old leg dates for smart date shifting
 * @param {Object} [confirmedShifts] - Map of legId -> confirmed dates from client (skips calculation)
 * @returns {Object} Updated traveler costs
 */
function recalculateTravelerForItineraryChange(traveler, newLegs, mileageRates, oldLegsMap, confirmedShifts) {
  // Determine which legs the traveler is attending
  // If leg was removed, it's no longer attended
  // If leg was added, include if traveler attends all or it's explicitly added
  const newLegIds = newLegs.map(l => l.legId || l.id);
  const currentAttending = traveler.attendingLegs || [];

  // Filter to only legs that still exist
  let updatedAttending = currentAttending.filter(id => newLegIds.includes(id));

  // If traveler was attending all legs, add any new legs
  if (currentAttending.length === 0 || currentAttending.length >= newLegs.length) {
    updatedAttending = newLegIds;
  }

  // Build updated leg costs with fresh per diem rates
  const updatedLegCosts = {};
  const dateShifts = [];  // Track custom date shifts for user notification

  // Helper to compute date offset in days
  const getDayOffset = (dateStr, baseStr) => {
    if (!dateStr || !baseStr) return 0;
    const date = new Date(dateStr);
    const base = new Date(baseStr);
    return Math.round((date - base) / TIME_CONSTANTS.MS_PER_DAY);
  };

  // Helper to shift date by offset days
  const shiftDate = (baseStr, offsetDays) => {
    if (!baseStr) return '';
    const base = new Date(baseStr);
    base.setDate(base.getDate() + offsetDays);
    return formatDateForStorage(base);
  };

  updatedAttending.forEach(legId => {
    const leg = newLegs.find(l => (l.legId || l.id) === legId);
    const existingLegCost = traveler.legCosts?.[legId] || {};
    const oldLeg = oldLegsMap?.[legId];

    if (leg) {
      // Check if we have confirmed shifts from client for this leg
      const confirmedLegShift = confirmedShifts?.[legId];

      // Determine if using itinerary dates (will be updated if confirmed dates match itinerary)
      let lodgingUsesItineraryDates = existingLegCost.lodgingUsesItineraryDates !== false;
      let mieUsesItineraryDates = existingLegCost.mieUsesItineraryDates !== false;

      let effectiveLodgingStartDate, effectiveLodgingEndDate;
      let effectiveMieStartDate, effectiveMieEndDate;
      let lodgingShifted = false, mieShifted = false;

      // PRIORITY 1: Use confirmed shifts from client (user already approved these)
      if (confirmedLegShift) {
        effectiveLodgingStartDate = confirmedLegShift.lodgingStartDate || existingLegCost.lodgingStartDate || leg.startDate;
        effectiveLodgingEndDate = confirmedLegShift.lodgingEndDate || existingLegCost.lodgingEndDate || leg.endDate;
        effectiveMieStartDate = confirmedLegShift.mieStartDate || existingLegCost.mieStartDate || leg.startDate;
        effectiveMieEndDate = confirmedLegShift.mieEndDate || existingLegCost.mieEndDate || leg.endDate;

        // Update flags based on whether confirmed dates match the new itinerary
        lodgingUsesItineraryDates = (effectiveLodgingStartDate === leg.startDate && effectiveLodgingEndDate === leg.endDate);
        mieUsesItineraryDates = (effectiveMieStartDate === leg.startDate && effectiveMieEndDate === leg.endDate);
      }
      // PRIORITY 2: Using itinerary dates - use new leg dates directly
      else if (lodgingUsesItineraryDates) {
        effectiveLodgingStartDate = leg.startDate;
        effectiveLodgingEndDate = leg.endDate;
      } else if (oldLeg && oldLeg.startDate && oldLeg.endDate) {
        // SMART DATE SHIFTING: Custom dates with old leg data available
        // Compute offset from old itinerary, apply to new itinerary
        const startOffset = getDayOffset(existingLegCost.lodgingStartDate, oldLeg.startDate);
        const endOffset = getDayOffset(existingLegCost.lodgingEndDate, oldLeg.endDate);

        effectiveLodgingStartDate = shiftDate(leg.startDate, startOffset);
        effectiveLodgingEndDate = shiftDate(leg.endDate, endOffset);

        // Track if dates actually changed
        if (effectiveLodgingStartDate !== existingLegCost.lodgingStartDate ||
            effectiveLodgingEndDate !== existingLegCost.lodgingEndDate) {
          lodgingShifted = true;
        }
      } else {
        // No old leg data - keep existing custom dates unchanged
        effectiveLodgingStartDate = existingLegCost.lodgingStartDate;
        effectiveLodgingEndDate = existingLegCost.lodgingEndDate;
      }

      // M&IE dates (only calculate if not using confirmed shifts)
      if (!confirmedLegShift) {
        if (mieUsesItineraryDates) {
          // Using itinerary dates - use new leg dates directly
          effectiveMieStartDate = leg.startDate;
          effectiveMieEndDate = leg.endDate;
        } else if (oldLeg && oldLeg.startDate && oldLeg.endDate) {
          // SMART DATE SHIFTING: Custom dates with old leg data available
          const startOffset = getDayOffset(existingLegCost.mieStartDate, oldLeg.startDate);
          const endOffset = getDayOffset(existingLegCost.mieEndDate, oldLeg.endDate);

          effectiveMieStartDate = shiftDate(leg.startDate, startOffset);
          effectiveMieEndDate = shiftDate(leg.endDate, endOffset);

          // Track if dates actually changed
          if (effectiveMieStartDate !== existingLegCost.mieStartDate ||
              effectiveMieEndDate !== existingLegCost.mieEndDate) {
            mieShifted = true;
          }
        } else {
          // No old leg data - keep existing custom dates unchanged
          effectiveMieStartDate = existingLegCost.mieStartDate;
          effectiveMieEndDate = existingLegCost.mieEndDate;
        }
      }

      // Track shifts for user notification (ensure dates are strings for serialization)
      const toDateStr = (val) => formatDateForStorage(val);

      if (lodgingShifted || mieShifted) {
        dateShifts.push({
          legId,
          location: leg.city || leg.locationDisplay || 'Unknown',
          lodgingShifted: lodgingShifted ? {
            from: { start: toDateStr(existingLegCost.lodgingStartDate), end: toDateStr(existingLegCost.lodgingEndDate) },
            to: { start: toDateStr(effectiveLodgingStartDate), end: toDateStr(effectiveLodgingEndDate) }
          } : null,
          mieShifted: mieShifted ? {
            from: { start: toDateStr(existingLegCost.mieStartDate), end: toDateStr(existingLegCost.mieEndDate) },
            to: { start: toDateStr(effectiveMieStartDate), end: toDateStr(effectiveMieEndDate) }
          } : null
        });
      }

      // Check if this is a local travel leg (no per diem needed)
      if (existingLegCost.isLocalTravel) {
        updatedLegCosts[legId] = {
          ...existingLegCost,
          lodgingStartDate: effectiveLodgingStartDate,
          lodgingEndDate: effectiveLodgingEndDate,
          mieStartDate: effectiveMieStartDate,
          mieEndDate: effectiveMieEndDate
        };
        return; // Skip per diem lookup for local travel
      }

      // Check if lodging and M&IE dates are the same (can use single per diem call)
      const datesMatch = effectiveLodgingStartDate === effectiveMieStartDate &&
                         effectiveLodgingEndDate === effectiveMieEndDate;

      let lodgingResult, mieResult;

      if (datesMatch) {
        // Same date range - single per diem call
        const perDiemResult = getPerDiemForLeg({
          city: leg.city,
          state: leg.state,
          country: leg.country || 'United States',
          locationType: leg.locationType,
          isInternational: leg.isInternational,
          startDate: effectiveLodgingStartDate,
          endDate: effectiveLodgingEndDate
        });
        lodgingResult = perDiemResult;
        mieResult = perDiemResult;
      } else {
        // Different date ranges - separate calls for lodging and M&IE
        lodgingResult = getPerDiemForLeg({
          city: leg.city,
          state: leg.state,
          country: leg.country || 'United States',
          locationType: leg.locationType,
          isInternational: leg.isInternational,
          startDate: effectiveLodgingStartDate,
          endDate: effectiveLodgingEndDate
        });
        mieResult = getPerDiemForLeg({
          city: leg.city,
          state: leg.state,
          country: leg.country || 'United States',
          locationType: leg.locationType,
          isInternational: leg.isInternational,
          startDate: effectiveMieStartDate,
          endDate: effectiveMieEndDate
        });
      }

      // Build updated leg cost data with independent date ranges
      const legCostData = {
        ...existingLegCost,
        lodgingStartDate: effectiveLodgingStartDate,
        lodgingEndDate: effectiveLodgingEndDate,
        lodgingUsesItineraryDates,
        mieStartDate: effectiveMieStartDate,
        mieEndDate: effectiveMieEndDate,
        mieUsesItineraryDates,

        // Update rates from fresh per diem lookup
        lodgingRate: lodgingResult.success ? lodgingResult.lodgingRate : existingLegCost.lodgingRate,
        mieRate: mieResult.success ? mieResult.mieRate : existingLegCost.mieRate,

        // Store pre-calculated totals (used by calculateLegCosts)
        _preCalculatedLodging: lodgingResult.success ? lodgingResult.lodgingTotal : null,
        _preCalculatedMie: mieResult.success ? mieResult.mieTotal : null,
        _ratesVaried: (lodgingResult.ratesVaried || mieResult.ratesVaried) || false,
        _perDiemSource: lodgingResult.source || mieResult.source,

        // Clear overrides since dates/cities changed (Option A)
        lodgingOverride: false,
        lodgingOverrideAmount: 0,
        lodgingOverrideReason: '',
        mieOverride: false,
        mieOverrideAmount: 0,
        mieOverrideReason: ''
      };

      updatedLegCosts[legId] = legCostData;
    }
  });

  // Create updated traveler object
  const updatedTraveler = {
    ...traveler,
    attendingLegs: updatedAttending,
    legCosts: updatedLegCosts
  };

  // Recalculate all costs
  const result = calculateTravelerCosts(updatedTraveler, newLegs, mileageRates);

  // Add date shift info for user notification
  result.dateShifts = dateShifts;

  return result;
}

// =============================================================================
// REQUEST TOTALS
// =============================================================================

/**
 * Calculate shared costs total
 * @param {Object} sharedCosts - { facilities, audioVisual, logistics, other }
 * @returns {Object} { facilities, audioVisual, logistics, other, total }
 */
function calculateSharedTotal(sharedCosts) {
  if (!sharedCosts) {
    return { facilities: 0, audioVisual: 0, logistics: 0, other: 0, total: 0 };
  }

  const facilities = parseFloat(sharedCosts.facilities?.amount || sharedCosts.facilities) || 0;
  const audioVisual = parseFloat(sharedCosts.audioVisual?.amount || sharedCosts.audioVisual) || 0;
  const logistics = parseFloat(sharedCosts.logistics?.amount || sharedCosts.logistics) || 0;
  const other = parseFloat(sharedCosts.other?.amount || sharedCosts.other) || 0;

  return {
    facilities,
    audioVisual,
    logistics,
    other,
    total: facilities + audioVisual + logistics + other
  };
}

/**
 * Calculate grand total from traveler and shared totals
 * @param {number} travelerTotal
 * @param {number} sharedTotal
 * @returns {number} Grand total
 */
function calculateGrandTotal(travelerTotal, sharedTotal) {
  return (parseFloat(travelerTotal) || 0) + (parseFloat(sharedTotal) || 0);
}

/**
 * Recalculate all totals for a request
 * @param {Array} travelers - Travelers with subtotals
 * @param {Object} sharedCosts - Shared costs object
 * @returns {Object} { travelerTotal, sharedTotal, grandTotal }
 */
function recalculateRequestTotals(travelers, sharedCosts) {
  const travelerTotal = (travelers || []).reduce((sum, t) => {
    return sum + (parseFloat(t.subtotal) || 0);
  }, 0);

  const shared = calculateSharedTotal(sharedCosts);
  const grandTotal = calculateGrandTotal(travelerTotal, shared.total);

  return {
    travelerTotal,
    sharedTotal: shared.total,
    grandTotal
  };
}

// =============================================================================
// VALIDATION
// =============================================================================

// =============================================================================
// CLIENT-CALLABLE UNIFIED PER DIEM FUNCTION
// =============================================================================
// Called via google.script.run.calculatePerDiem(params)
// Single entry point for all per diem calculations from client

/**
 * Calculate per diem for a location and date range
 * Unified function called by client - routes to appropriate service
 *
 * @param {Object} params - Calculation parameters
 * @param {string} params.city - City name
 * @param {string} params.state - State code (for US)
 * @param {string} params.country - Country name (default: 'United States')
 * @param {string} params.locationType - 'CONUS', 'OCONUS', or 'Foreign'
 * @param {string} params.startDate - Start date (YYYY-MM-DD)
 * @param {string} params.endDate - End date (YYYY-MM-DD)
 * @returns {Object} Normalized per diem result with pre-calculated totals
 */
function calculatePerDiem(params) {
  try {
    const result = getPerDiemForLeg(params);

    // Return in a format consistent with client expectations
    return {
      success: result.success,
      error: result.error,
      source: result.source,

      // Rates (averages for display)
      lodgingRate: result.lodgingRate || 0,
      mieRate: result.mieRate || 0,

      // Legacy aliases
      lodging: result.lodgingRate || 0,
      mie: result.mieRate || 0,

      // Pre-calculated totals (day-by-day calculation)
      lodgingTotal: result.lodgingTotal || 0,
      mieTotal: result.mieTotal || 0,

      // Duration
      nights: result.nights || 0,
      days: result.days || 0,

      // Rate variation info
      ratesVaried: result.ratesVaried || false,
      breakdown: result.breakdown || null,

      // Combined per diem rate
      perDiem: (result.lodgingRate || 0) + (result.mieRate || 0)
    };
  } catch (error) {
    console.error('Error in calculatePerDiem:', error);
    return {
      success: false,
      error: error.message || 'Calculation failed'
    };
  }
}
