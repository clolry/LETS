/**
 * HCSeed.js
 * Seeds HC_Positions and HC_Orgs with representative test data.
 *
 * WHY THIS EXISTS
 * ---------------
 * LETS inherited TRIP from another workgroup. TRIP's HR data came from an Apps
 * Script Library bound as `HC`, which held THAT workgroup's employees and is
 * no longer reachable by this team. 20_data/HCData.js reconstructs the
 * interface; this file gives it something to return so the travel form,
 * approval routing and the org chart can be exercised end to end before real
 * HR data is assembled.
 *
 * THE DATA BELOW IS FICTIONAL. Every name is invented and every email is on
 * the reserved example.gov domain, so a stray notification cannot reach a real
 * mailbox. Do not treat any of it as a roster.
 *
 * ORG STRUCTURE
 * -------------
 * Mirrors the four offices already defined in 00_config/BudgetConfig.js, using
 * the HR org codes confirmed by @clolry:
 *
 *   FC  -> FO   Front Office / AC      baseline   $4,000
 *   FCA -> OMD  OMD DAC                baseline $152,000   share 15.3%
 *   FCB -> IDV  IDV DAC                baseline $659,000   share 66.4%
 *   FCC -> CM   CM DAC                 baseline $182,000   share 18.3%
 *
 * Two code namespaces coexist deliberately. Org_Code is the HR code carried by
 * positions; Office_Code is the key BudgetConfig.js uses for allocations and
 * set-asides. Carrying both on one HC_Orgs row makes the correspondence
 * explicit rather than implied, because getting it wrong routes a budget
 * commitment to the wrong DAC — an error that surfaces weeks later in
 * reconciliation, not at submission time.
 *
 * WHAT THE SHAPE EXERCISES
 * ------------------------
 * The hierarchy is built to cover the cases the inherited code actually
 * branches on, not just to look plausible:
 *
 *   - An SES at the top with no supervisor, so the chain walk terminates.
 *   - A staffed GS-15 Division Director under each DAC, which is what
 *     Request.js:137 looks for when it resolves ddName/ddEmail.
 *   - A GS-14 deputy under one DD, so the walk has to pass through a
 *     non-matching supervisor before finding the GS-15.
 *   - A VACANT GS-15 seat, which must be SKIPPED by the DD walk (an empty
 *     seat cannot approve travel) and OMITTED from the org chart.
 *   - A GS-07, which only resolves correctly because HCData.js zero-pads
 *     grades — String(7) is '7', not '07', and every grade comparison in the
 *     system is a string comparison (docs/GAP_CONSOLIDATION_PASS6.md VT-03).
 *   - Supervisory_Status '2' on supervisors only. canAccessTrip() at
 *     Access.js:416 grants site access on that value, so seeding it widely
 *     would silently widen access in whichever project this runs against.
 *
 * ACCESS SIDE EFFECT — READ BEFORE RUNNING IN PRODUCTION
 * ------------------------------------------------------
 * Access.js:394 canAccessTrip() allows anyone whose HC position has
 * Supervisory_Status === '2' and a non-vacant seat. Until now that path was
 * dead, because no HC library was attached and the call threw into a
 * try/catch. Seeding HC data makes it LIVE.
 *
 * None of the seeded emails are real, so no real person gains access from
 * this data. But the mechanism is now active: a future real roster grants
 * LETS access to every supervisor in it, without any entry in
 * Travel_User_Roles and without an audit record. That is the behaviour
 * docs/GAP_REGISTER.md G-008 describes. It is by design in the inherited
 * code; it is worth knowing it switched on.
 *
 * Run from the editor: select seedHCTestData, click Run, read the log.
 */

// Fictional roster. Emails use example.gov (RFC 2606 reserved) so nothing can
// be delivered. Position numbers are text to preserve any leading zeros.
var HC_SEED_ORGS = [
  {
    orgCode: 'FC',
    officeCode: 'FO',
    businessUnit: 'Front Office',
    sector: 'ASD',
    division: 'Front Office / AC',
    status: 'Active',
    formerOrgCodes: ''
  },
  {
    orgCode: 'FCA',
    officeCode: 'OMD',
    businessUnit: 'OMD',
    sector: 'ASD',
    division: 'Operations Management Division',
    status: 'Active',
    formerOrgCodes: ''
  },
  {
    orgCode: 'FCB',
    officeCode: 'IDV',
    businessUnit: 'IDV',
    sector: 'ASD',
    division: 'Infrastructure Delivery Division',
    status: 'Active',
    formerOrgCodes: ''
  },
  {
    orgCode: 'FCC',
    officeCode: 'CM',
    businessUnit: 'CM',
    sector: 'ASD',
    division: 'Category Management Division',
    status: 'Active',
    formerOrgCodes: ''
  }
];

var HC_SEED_POSITIONS = [
  // --- FC / FO — Front Office -------------------------------------------
  // Top of the tree. Reports_To is empty, so the supervisor walk terminates
  // here rather than running to its depth cap.
  {
    positionNumber: 'FC-0001', reportsTo: '',
    employeeId: '0010001', name: 'Marguerite Okonkwo',
    email: 'marguerite.okonkwo@example.gov',
    orgCode: 'FC', officeTitle: 'Assistant Commissioner',
    grade: 'SES', supervisoryStatus: '2', occupancy: 'FILLED',
    lcat: 'Executive', locationCode: 'DC-CENTRAL',
    address: '1800 F Street NW', city: 'Washington', state: 'DC'
  },
  {
    positionNumber: 'FC-0002', reportsTo: 'FC-0001',
    employeeId: '0010002', name: 'Desmond Whitaker',
    email: 'desmond.whitaker@example.gov',
    orgCode: 'FC', officeTitle: 'Chief of Staff',
    grade: '15', supervisoryStatus: '2', occupancy: 'FILLED',
    lcat: 'Program Management', locationCode: 'DC-CENTRAL',
    address: '1800 F Street NW', city: 'Washington', state: 'DC'
  },
  {
    positionNumber: 'FC-0003', reportsTo: 'FC-0002',
    employeeId: '0010003', name: 'Priya Raghunathan',
    email: 'priya.raghunathan@example.gov',
    orgCode: 'FC', officeTitle: 'Executive Assistant',
    // GS-07 is deliberate. A sheet cell containing 07 arrives as the NUMBER 7,
    // and String(7) !== '07'. This row fails every grade comparison in the
    // system unless HCData.js zero-pads it.
    grade: '07', supervisoryStatus: '', occupancy: 'FILLED',
    lcat: 'Administrative', locationCode: 'DC-CENTRAL',
    address: '1800 F Street NW', city: 'Washington', state: 'DC'
  },

  // --- FCA / OMD ---------------------------------------------------------
  {
    positionNumber: 'FCA-0001', reportsTo: 'FC-0001',
    employeeId: '0020001', name: 'Alasdair Benavides',
    email: 'alasdair.benavides@example.gov',
    orgCode: 'FCA', officeTitle: 'Division Director',
    grade: '15', supervisoryStatus: '2', occupancy: 'FILLED',
    lcat: 'Program Management', locationCode: 'DC-CENTRAL',
    address: '1800 F Street NW', city: 'Washington', state: 'DC'
  },
  {
    positionNumber: 'FCA-0002', reportsTo: 'FCA-0001',
    employeeId: '0020002', name: 'Thandiwe Mbeki-Lawson',
    email: 'thandiwe.mbeki-lawson@example.gov',
    orgCode: 'FCA', officeTitle: 'Deputy Division Director',
    // GS-14 between a GS-13 and the GS-15 DD. Forces the DD walk to pass
    // through a supervisor that does NOT match the predicate.
    grade: '14', supervisoryStatus: '2', occupancy: 'FILLED',
    lcat: 'Program Management', locationCode: 'PHL-REGION',
    address: '100 South Independence Mall West', city: 'Philadelphia', state: 'PA'
  },
  {
    positionNumber: 'FCA-0003', reportsTo: 'FCA-0002',
    employeeId: '0020003', name: 'Rutger Vandersloot',
    email: 'rutger.vandersloot@example.gov',
    orgCode: 'FCA', officeTitle: 'Management Analyst',
    grade: '13', supervisoryStatus: '', occupancy: 'FILLED',
    lcat: 'Analysis', locationCode: 'PHL-REGION',
    address: '100 South Independence Mall West', city: 'Philadelphia', state: 'PA'
  },
  {
    positionNumber: 'FCA-0004', reportsTo: 'FCA-0002',
    employeeId: '0020004', name: 'Ingrid Solheim-Baptiste',
    email: 'ingrid.solheim-baptiste@example.gov',
    orgCode: 'FCA', officeTitle: 'Program Analyst',
    grade: '12', supervisoryStatus: '', occupancy: 'FILLED',
    lcat: 'Analysis', locationCode: 'DEN-REGION',
    address: '1961 Stout Street', city: 'Denver', state: 'CO'
  },

  // --- FCB / IDV ---------------------------------------------------------
  {
    positionNumber: 'FCB-0001', reportsTo: 'FC-0001',
    employeeId: '0030001', name: 'Cornelius Achterberg',
    email: 'cornelius.achterberg@example.gov',
    orgCode: 'FCB', officeTitle: 'Division Director',
    grade: '15', supervisoryStatus: '2', occupancy: 'FILLED',
    lcat: 'Engineering', locationCode: 'DC-CENTRAL',
    address: '1800 F Street NW', city: 'Washington', state: 'DC'
  },
  {
    positionNumber: 'FCB-0002', reportsTo: 'FCB-0001',
    employeeId: '', name: '',
    email: '',
    orgCode: 'FCB', officeTitle: 'Deputy Division Director',
    // VACANT, and deliberately a GS-15. Two behaviours depend on it:
    //   1. hcFindDivisionDirector must SKIP it — an empty seat cannot approve
    //      travel (Request.js:137 requires occupancyStatus !== 'VACANT').
    //   2. hcGetOrgChartTree must OMIT it — a chart reachable by any domain
    //      user should not advertise which positions are unfilled.
    grade: '15', supervisoryStatus: '2', occupancy: 'VACANT',
    lcat: 'Engineering', locationCode: 'DC-CENTRAL',
    address: '1800 F Street NW', city: 'Washington', state: 'DC'
  },
  {
    positionNumber: 'FCB-0003', reportsTo: 'FCB-0002',
    employeeId: '0030003', name: 'Yevgenia Taraschuk',
    email: 'yevgenia.taraschuk@example.gov',
    orgCode: 'FCB', officeTitle: 'Project Manager',
    // Reports to the VACANT seat. Two walks must both step past FCB-0002:
    // the DD walk (Request.js:137 requires a non-vacant GS-15) and the org
    // chart's nearest-staffed-ancestor walk. Both land on FCB-0001.
    //
    // This row is why hcGetOrgChartTree has that second walk at all. Before
    // it existed, dropping the vacant seat orphaned this person into a false
    // second root — rendering her as a peer of the Assistant Commissioner.
    grade: '14', supervisoryStatus: '', occupancy: 'FILLED',
    lcat: 'Engineering', locationCode: 'ATL-REGION',
    address: '77 Forsyth Street SW', city: 'Atlanta', state: 'GA'
  },
  {
    positionNumber: 'FCB-0004', reportsTo: 'FCB-0001',
    employeeId: '0030004', name: 'Bartholomew Nkemelu',
    email: 'bartholomew.nkemelu@example.gov',
    orgCode: 'FCB', officeTitle: 'Contract Specialist',
    grade: '13', supervisoryStatus: '', occupancy: 'FILLED',
    lcat: 'Acquisition', locationCode: 'FTW-REGION',
    address: '819 Taylor Street', city: 'Fort Worth', state: 'TX'
  },
  {
    positionNumber: 'FCB-0005', reportsTo: 'FCB-0001',
    employeeId: '0030005', name: 'Siobhan Fitzgerald-Moreau',
    email: 'siobhan.fitzgerald-moreau@example.gov',
    orgCode: 'FCB', officeTitle: 'Realty Specialist',
    grade: '12', supervisoryStatus: '', occupancy: 'FILLED',
    // OCONUS. Exercises the DoD per-diem path rather than GSA CONUS, and the
    // local-travel comparison against a non-CONUS duty station.
    lcat: 'Realty', locationCode: 'HI-REGION',
    address: '300 Ala Moana Boulevard', city: 'Honolulu', state: 'HI'
  },

  // --- FCC / CM ----------------------------------------------------------
  {
    positionNumber: 'FCC-0001', reportsTo: 'FC-0001',
    employeeId: '0040001', name: 'Wilhelmina Oyelaran',
    email: 'wilhelmina.oyelaran@example.gov',
    orgCode: 'FCC', officeTitle: 'Division Director',
    grade: '15', supervisoryStatus: '2', occupancy: 'FILLED',
    lcat: 'Category Management', locationCode: 'DC-CENTRAL',
    address: '1800 F Street NW', city: 'Washington', state: 'DC'
  },
  {
    positionNumber: 'FCC-0002', reportsTo: 'FCC-0001',
    employeeId: '0040002', name: 'Anatoly Pereverzev',
    email: 'anatoly.pereverzev@example.gov',
    orgCode: 'FCC', officeTitle: 'Category Manager',
    grade: '14', supervisoryStatus: '2', occupancy: 'FILLED',
    lcat: 'Category Management', locationCode: 'CHI-REGION',
    address: '230 South Dearborn Street', city: 'Chicago', state: 'IL'
  },
  {
    positionNumber: 'FCC-0003', reportsTo: 'FCC-0002',
    employeeId: '0040003', name: 'Esperanza Villalobos-Reyes',
    email: 'esperanza.villalobos-reyes@example.gov',
    orgCode: 'FCC', officeTitle: 'Program Analyst',
    grade: '13', supervisoryStatus: '', occupancy: 'FILLED',
    lcat: 'Analysis', locationCode: 'SF-REGION',
    address: '50 United Nations Plaza', city: 'San Francisco', state: 'CA'
  },
  {
    positionNumber: 'FCC-0004', reportsTo: 'FCC-0002',
    employeeId: '0040004', name: 'Fionnuala Mac Diarmada',
    email: 'fionnuala.macdiarmada@example.gov',
    orgCode: 'FCC', officeTitle: 'Procurement Analyst',
    grade: '11', supervisoryStatus: '', occupancy: 'FILLED',
    lcat: 'Acquisition', locationCode: 'BOS-REGION',
    address: '10 Causeway Street', city: 'Boston', state: 'MA'
  }
];

/**
 * Seeds both HC tabs.
 *
 * REPLACES the contents of HC_Positions and HC_Orgs — it does not merge. This
 * is seed data for an empty or test environment, and a merge would make the
 * result depend on whatever was already there, which is the opposite of what a
 * reproducible test fixture needs.
 *
 * Refuses to run when either tab already holds data unless `force` is true, so
 * it cannot quietly overwrite a real roster that someone has started building.
 *
 * @param {boolean} [force=false] overwrite existing rows
 * @returns {Object} { success, positions, orgs, message }
 * @editor
 */
function seedHCTestData(force) {
  try {
    if (!TRAVEL_DB_SPREADSHEET_ID) {
      return {
        success: false,
        error: 'TRAVEL_DB_SPREADSHEET_ID is not set in Script Properties.'
      };
    }

    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var posSheet = ss.getSheetByName(SHEET_NAMES.HC_POSITIONS);
    var orgSheet = ss.getSheetByName(SHEET_NAMES.HC_ORGS);

    if (!posSheet || !orgSheet) {
      return {
        success: false,
        error: 'HC tabs not found. Run setupTravelDatabase() first — it creates ' +
               SHEET_NAMES.HC_POSITIONS + ' and ' + SHEET_NAMES.HC_ORGS + '.'
      };
    }

    // Guard against overwriting a real roster.
    var existingPositions = Math.max(0, posSheet.getLastRow() - 1);
    var existingOrgs = Math.max(0, orgSheet.getLastRow() - 1);
    if ((existingPositions > 0 || existingOrgs > 0) && force !== true) {
      return {
        success: false,
        aborted: true,
        error: 'HC tabs already contain data (' + existingPositions + ' positions, ' +
               existingOrgs + ' orgs). This function REPLACES all rows. ' +
               'Re-run as seedHCTestData(true) if that is what you intend.'
      };
    }

    var now = new Date();
    var actor = 'hc-seed';

    // --- Orgs -----------------------------------------------------------
    // Rows are built by mapping over the schema header list, so a column
    // appended to TRAVEL_SHEET_SCHEMAS lands in the right place without
    // editing this function. docs/DATA_DICTIONARY.md §3.9: writes are
    // positional, so never build these arrays by hand.
    var orgHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_ORGS];
    var orgRows = HC_SEED_ORGS.map(function (o) {
      var rec = {
        'Org_Code': o.orgCode,
        'Office_Code': o.officeCode,
        'Business_Unit': o.businessUnit,
        'Sector': o.sector,
        'Division': o.division,
        'Status': o.status,
        'Former_Org_Codes': o.formerOrgCodes,
        'Is_Active': true,
        'Created_By': actor,
        'Created_At': now,
        'Updated_By': actor,
        'Updated_At': now
      };
      return orgHeaders.map(function (h) {
        return h in rec ? rec[h] : '';
      });
    });

    if (existingOrgs > 0) {
      orgSheet.getRange(2, 1, existingOrgs, orgHeaders.length).clearContent();
    }
    orgSheet.getRange(2, 1, orgRows.length, orgHeaders.length).setValues(orgRows);

    // --- Positions ------------------------------------------------------
    var posHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_POSITIONS];
    var posRows = HC_SEED_POSITIONS.map(function (p) {
      var rec = {
        'Position_Number': p.positionNumber,
        'Reports_To_Position_Number': p.reportsTo,
        'Employee_ID': p.employeeId,
        'Employee_Name': p.name,
        'Email_Address': p.email,
        'Org_Code': p.orgCode,
        'Office_Title': p.officeTitle,
        'Grade': p.grade,
        'Supervisory_Status': p.supervisoryStatus,
        'Occupancy_Status': p.occupancy,
        'LCAT': p.lcat,
        'Location_Code': p.locationCode,
        'Duty_Station_Address': p.address,
        'Duty_Station_City': p.city,
        'Duty_Station_State': p.state,
        'Is_Active': true,
        'Created_By': actor,
        'Created_At': now,
        'Updated_By': actor,
        'Updated_At': now
      };
      return posHeaders.map(function (h) {
        return h in rec ? rec[h] : '';
      });
    });

    if (existingPositions > 0) {
      posSheet.getRange(2, 1, existingPositions, posHeaders.length).clearContent();
    }

    // Pin the three identifier columns to text BEFORE writing, so leading
    // zeros survive. Position_Number, Employee_ID and Grade all carry them
    // ('FC-0001' is safe, but '0010001' and '07' are not). Sheets would
    // otherwise store 07 as the number 7, and every grade comparison in the
    // system is a string comparison. Database.js:293 does the same thing for
    // Travel_Users.User_ID and documents the same reason.
    var pnCol = posHeaders.indexOf('Position_Number') + 1;
    var eidCol = posHeaders.indexOf('Employee_ID') + 1;
    var gradeCol = posHeaders.indexOf('Grade') + 1;
    [pnCol, eidCol, gradeCol].forEach(function (col) {
      if (col > 0) {
        posSheet.getRange(2, col, posRows.length, 1).setNumberFormat('@');
      }
    });
    SpreadsheetApp.flush();

    posSheet.getRange(2, 1, posRows.length, posHeaders.length).setValues(posRows);

    // The bundle is cached for CACHE_CONFIG.TTL.LONG (6 hours). Without this
    // the seed is invisible until it expires, which looks like a failed write.
    HC.hcCacheInvalidateAll();

    console.log('=== seedHCTestData ===');
    console.log('  orgs:      ' + orgRows.length);
    console.log('  positions: ' + posRows.length);
    console.log('  HC cache invalidated');
    console.log('  NOTE: canAccessTrip() grants LETS access to any HC position');
    console.log('        with Supervisory_Status = 2 and a non-vacant seat.');
    console.log('        All seeded emails are @example.gov, so no real person');
    console.log('        gains access — but that path is now live (G-008).');

    return {
      success: true,
      orgs: orgRows.length,
      positions: posRows.length,
      message: 'Seeded ' + posRows.length + ' positions across ' + orgRows.length + ' orgs'
    };

  } catch (error) {
    console.error('seedHCTestData failed: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Read-only sanity check on whatever is currently in the HC tabs.
 *
 * Reports the three classes of defect that are invisible in the sheet itself
 * but break consumers at runtime:
 *
 *   1. Dangling Reports_To — points at a Position_Number that does not exist,
 *      so the supervisor walk dead-ends and no DD is found.
 *   2. Supervisor cycles — A reports to B, B reports to A. Without the
 *      visited-set in HCData.js this is an infinite loop inside a web
 *      request, i.e. a hung page rather than an error.
 *   3. Grades that lost their leading zero — a cell holding the number 7
 *      instead of the text '07'. Every grade comparison in the system is a
 *      string comparison, so this silently excludes the person.
 *
 * The admin GUI rejects all three at write time. This exists for data that
 * arrived by hand or by import, before that GUI existed.
 *
 * @returns {Object} { success, positions, orgs, problems: [] }
 * @editor
 */
function validateHCData() {
  try {
    var bundle = HC.hcGetBundle();
    if (!bundle.success) {
      return { success: false, error: bundle.error, problems: [] };
    }

    var positions = bundle.data;
    var orgs = HC.hcGetOrgHierarchy();
    var problems = [];

    var byPn = {};
    for (var i = 0; i < positions.length; i++) {
      var pn = positions[i].positionNumber;
      if (byPn[pn]) {
        problems.push('Duplicate Position_Number "' + pn + '" — the later row wins ' +
                      'in every lookup, so one of these two people is invisible.');
      }
      byPn[pn] = positions[i];
    }

    var orgCodes = {};
    for (var o = 0; o < orgs.length; o++) {
      orgCodes[orgs[o].orgCode] = true;
      var formers = orgs[o].formerOrgCodes || [];
      for (var f = 0; f < formers.length; f++) orgCodes[formers[f]] = true;
    }

    for (var p = 0; p < positions.length; p++) {
      var pos = positions[p];

      // 1 — dangling supervisor pointer
      if (pos.reportsToPositionNumber && !byPn[pos.reportsToPositionNumber]) {
        problems.push('Position ' + pos.positionNumber + ' (' + (pos.employeeName || 'vacant') +
                      ') reports to "' + pos.reportsToPositionNumber + '", which does not exist. ' +
                      'Approval routing will find no Division Director for this person.');
      }

      // 2 — cycle. Walk with a predicate that never matches; a null result
      // from a position that HAS a supervisor means the walk hit the visited
      // set or the depth cap.
      if (pos.reportsToPositionNumber && byPn[pos.reportsToPositionNumber]) {
        var seen = {};
        var cursor = pos.reportsToPositionNumber;
        var depth = 0;
        while (cursor && depth < 20) {
          if (cursor === pos.positionNumber) {
            problems.push('Supervisor CYCLE involving position ' + pos.positionNumber +
                          ' (' + (pos.employeeName || 'vacant') + ').');
            break;
          }
          if (seen[cursor]) break;
          seen[cursor] = true;
          cursor = byPn[cursor] ? byPn[cursor].reportsToPositionNumber : '';
          depth++;
        }
      }

      // 3 — org code with no HC_Orgs row
      if (pos.orgCode && !orgCodes[pos.orgCode]) {
        problems.push('Position ' + pos.positionNumber + ' has Org_Code "' + pos.orgCode +
                      '" with no matching HC_Orgs row. Business unit and sector will be blank.');
      }

      // 4 — a staffed position with no email cannot be routed to or granted access
      if (pos.occupancyStatus !== 'VACANT' && pos.employeeName && !pos.emailAddress) {
        problems.push('Position ' + pos.positionNumber + ' (' + pos.employeeName +
                      ') is staffed but has no Email_Address. This person cannot ' +
                      'be notified and cannot be matched by canAccessTrip().');
      }
    }

    // Every DAC should have a reachable staffed GS-15, or its travel cannot route.
    for (var oc = 0; oc < orgs.length; oc++) {
      var org = orgs[oc];
      if (!org.officeCode) continue;
      var hasDd = positions.some(function (x) {
        return x.orgCode === org.orgCode && x.grade === '15' && x.occupancyStatus !== 'VACANT';
      });
      if (!hasDd) {
        problems.push('Org ' + org.orgCode + ' (' + org.officeCode + ') has no staffed ' +
                      'GS-15. Requests from this org will route with an empty ' +
                      'Division Director.');
      }
    }

    console.log('=== validateHCData ===');
    console.log('  positions: ' + positions.length);
    console.log('  orgs:      ' + orgs.length);
    if (problems.length === 0) {
      console.log('  no problems found');
    } else {
      console.log('  ' + problems.length + ' problem(s):');
      problems.forEach(function (pr) { console.log('    - ' + pr); });
    }

    return {
      success: problems.length === 0,
      positions: positions.length,
      orgs: orgs.length,
      problems: problems
    };

  } catch (error) {
    console.error('validateHCData failed: ' + error.message);
    return { success: false, error: error.message, problems: [] };
  }
}
