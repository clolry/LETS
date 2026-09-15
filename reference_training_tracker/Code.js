/*******************************************************
 * FCB Budget Executive Dashboard
 * Google Apps Script Backend
 *
 * Updated:
 * - Office-level role is Supervisor
 * - Supervisors assigned to child orgs see the parent budget office:
 *      FCBBB  -> FCBB budget
 *      FCBAA  -> FCBA budget
 *      FCB0AAA -> FCB0A budget
 * - Supervisors only see Purchase Card spend for their assigned org
 *   and child orgs.
 * - Budget comes from FCB tab.
 * - Spend comes from Purchase Card tab.
 * - Purchase Card "Training Budget Allocation" maps:
 *      Other Training $$ Allocation -> Other
 *      AWF Training $$ Allocation   -> AWT
 * - Unmapped/exceptions are excluded.
 *******************************************************/

const CONFIG = {
  appName: 'FCB Budget',

  /*
   * If this Apps Script project is bound to the Google Sheet, leave blank.
   * If this is standalone, paste the spreadsheet ID here.
   */
  spreadsheetId: '',

  sheets: {
    budget: 'FCB',
    purchaseCard: 'Purchase Card',
    trainingRequest: 'Training Request',
    orgChart: 'FCB Org Chart',
    roles: 'Roles'
  },

  headers: {
    roles: {
      email: ['Email', 'User Email', 'Email Address'],
      name: ['Name', 'Employee Name'],
      role: ['Role', 'Access Role'],
      orgCode: ['Org Code', 'Org', 'Office Symbol', 'Access Org', 'Access Org Code'],
      active: ['Active', 'Enabled', 'Is Active']
    },

    budget: {
      orgCode: ['Org Code', 'Org', 'Office Symbol', 'Office Code'],
      officeName: ['Office Name', 'Office', 'Organization', 'Org Name'],
      manager: ['Manager', 'Approver', 'Supervisor'],
      personnel: ['Number of Personnel', 'Personnel', 'FTE', 'Headcount'],
      percentOfFcb: ['% of FCB', 'Percent of FCB'],

      otherAllocation: [
        'Other Trng Allocation',
        'Other Trng $ Allocation',
        'Other Trng $$ Allocation',
        'Other Training Allocation',
        'Other Training $ Allocation',
        'Other Training $$ Allocation',
        'Other Allocation'
      ],

      awtAllocation: [
        'AWT Trng Allocation',
        'AWT Trng $ Allocation',
        'AWT Trng $$ Allocation',
        'AWT Training Allocation',
        'AWT Training $ Allocation',
        'AWT Training $$ Allocation',
        'AWF Trng Allocation',
        'AWF Trng $ Allocation',
        'AWF Trng $$ Allocation',
        'AWF Training Allocation',
        'AWF Training $ Allocation',
        'AWF Training $$ Allocation',
        'AWT Allocation',
        'AWF Allocation'
      ],

      totalAllocation: [
        'Office Total Budget',
        'Total Allocation',
        'Total Budget',
        'Budget',
        'Office Budget',
        'Total Office Budget'
      ]
    },

    purchaseCard: {
      employeeName: ['Employee Name', 'Employee', 'Requester', 'Requestor', 'Student', 'Attendee', 'Name'],
      orgCode: ['Org Code', 'Org', 'Office Symbol', 'Office Code'],
      amount: ['Amount', 'Amount Paid', 'Transaction Amount', 'Cost', 'Total', 'Total Cost', 'Payment Amount'],
      paidDate: ['Paid Date', 'Date Paid', 'Transaction Date', 'Posted Date', 'Date', 'Purchase Date'],

      category: [
        'Training Budget Allocation',
        'Budget Allocation',
        'Category',
        'Training Category',
        'Spend Category',
        'Type',
        'Training Type',
        'AWT/Other',
        'AWF/Other'
      ],

      vendor: ['Vendor', 'Merchant', 'Supplier', 'Training Provider', 'Provider'],
      description: ['Description', 'Training', 'Training Title', 'Item Description', 'Course', 'Course Title'],
      status: ['Status', 'Payment Status'],
      fiscalYear: ['Fiscal Year', 'FY']
    }
  },

  /*
   * If the Purchase Card tab only contains paid rows, leave false.
   * If it contains unpaid/planned rows and has a Status column, set true.
   */
  usePaidStatusFilter: false,

  paidStatuses: [
    'paid',
    'posted',
    'complete',
    'completed',
    'reconciled',
    'approved'
  ],

  fullAccessRoles: [
    'executive',
    'admin',
    'budget admin'
  ],

  scopedAccessRoles: [
    'supervisor'
  ],

  fallbackBudget: [
    {
      orgCode: 'FCB',
      officeName: 'FCB Front Office Hold Back',
      manager: 'Cameron',
      personnel: 3,
      percentOfFcb: 0.55,
      otherAllocation: 2500.00,
      awtAllocation: 2500.00
    },
    {
      orgCode: 'FCB0A',
      officeName: 'Indefinite Delivery Vehicle Implementation and Warrant Management Service Center',
      manager: 'Washington',
      personnel: 31,
      percentOfFcb: 5.73,
      otherAllocation: 8841.48,
      awtAllocation: 10458.12
    },
    {
      orgCode: 'FCB0B',
      officeName: 'Indefinite Delivery Vehicle Supplier Compliance Service Center',
      manager: 'Francis',
      personnel: 35,
      percentOfFcb: 6.47,
      otherAllocation: 9982.31,
      awtAllocation: 11807.55
    },
    {
      orgCode: 'FCB0C',
      officeName: 'Cyber-Supply Chain Risk Management Service Center',
      manager: 'Achale',
      personnel: 9,
      percentOfFcb: 1.66,
      otherAllocation: 2566.88,
      awtAllocation: 3036.23
    },
    {
      orgCode: 'FCBA',
      officeName: 'Office of MAS',
      manager: 'Gio',
      personnel: 346,
      percentOfFcb: 63.96,
      otherAllocation: 98682.27,
      awtAllocation: 116726.07
    },
    {
      orgCode: 'FCBB',
      officeName: 'Office of Non-MAS',
      manager: 'Jefferies',
      personnel: 120,
      percentOfFcb: 22.18,
      otherAllocation: 34225.06,
      awtAllocation: 40483.03
    }
  ]
};


/**
 * Web app entry point.
 */
function doGet(e) {
  return HtmlService
    .createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.appName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/**
 * Optional menu if script is bound to the Sheet.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('FCB Budget')
    .addItem('Open Dashboard Sidebar', 'showDashboardSidebar')
    .addToUi();
}


function showDashboardSidebar() {
  const html = HtmlService
    .createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.appName);

  SpreadsheetApp.getUi().showSidebar(html);
}


/**
 * Main function called by Index.html.
 */
function getDashboardData(filters) {
  try {
    filters = filters || {};

    const userAccess = getCurrentUserAccess_();

    if (!userAccess.allowed) {
      return {
        ok: false,
        accessDenied: true,
        message: 'You do not currently have access to the FCB Budget dashboard. Please contact the dashboard administrator.',
        user: userAccess.publicUser
      };
    }

    const orgData = getOrgChartMap_();
    const budgetRows = getBudgetData_(orgData.orgNames);
    const purchaseRows = getPurchaseCardData_(orgData.employeeToOrg, orgData.orgNames);

    const result = calculateDashboardMetrics_(budgetRows, purchaseRows, userAccess, filters);

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      user: userAccess.publicUser,
      summary: result.summary,
      officeRows: result.officeRows,
      recentTransactions: result.recentTransactions,
      chartData: result.chartData,
      filterOptions: result.filterOptions,
      warnings: result.warnings
    };

  } catch (err) {
    console.error('getDashboardData error', err);

    return {
      ok: false,
      accessDenied: false,
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : ''
    };
  }
}


/**
 * Reads current user's access from Roles tab.
 *
 * Roles tab structure:
 * Email | Name | Role | Org Code | Active
 *
 * Example Supervisor:
 * supervisor@example.gov | Jane Doe | Supervisor | FCBBB | TRUE
 */
function getCurrentUserAccess_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();

  const denied = {
    allowed: false,
    email,
    name: '',
    role: '',
    orgCodes: [],
    fullAccess: false,
    scopedAccess: false,
    publicUser: {
      email,
      name: '',
      role: '',
      orgCode: '',
      orgCodes: [],
      fullAccess: false,
      scopedAccess: false
    }
  };

  if (!email) {
    denied.publicUser.role = 'Unknown';
    return denied;
  }

  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.sheets.roles);

  if (!sheet) {
    denied.publicUser.role = 'No Roles Sheet';
    return denied;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return denied;

  const headers = data[0];
  const h = CONFIG.headers.roles;

  const idx = {
    email: findHeaderIndex_(headers, h.email),
    name: findHeaderIndex_(headers, h.name),
    role: findHeaderIndex_(headers, h.role),
    orgCode: findHeaderIndex_(headers, h.orgCode),
    active: findHeaderIndex_(headers, h.active)
  };

  if (idx.email === -1 || idx.role === -1 || idx.orgCode === -1) {
    denied.publicUser.role = 'Roles Misconfigured';
    return denied;
  }

  const matches = [];

  for (let r = 1; r < data.length; r++) {
    const row = data[r];

    const rowEmail = String(row[idx.email] || '').trim().toLowerCase();
    if (rowEmail !== email) continue;

    const activeValue = idx.active === -1 ? true : row[idx.active];
    if (!isTruthy_(activeValue)) continue;

    matches.push({
      email,
      name: idx.name === -1 ? '' : String(row[idx.name] || '').trim(),
      role: String(row[idx.role] || '').trim(),
      orgCode: cleanOrgCode_(row[idx.orgCode])
    });
  }

  if (!matches.length) return denied;

  const orgCodes = unique_(matches.map(m => m.orgCode).filter(Boolean));
  const roles = unique_(matches.map(m => String(m.role || '').trim()).filter(Boolean));
  const roleLower = roles.map(r => r.toLowerCase());

  const fullAccess =
    roleLower.some(r => CONFIG.fullAccessRoles.indexOf(r) !== -1) ||
    orgCodes.some(c => c === 'ALL');

  const scopedAccess =
    roleLower.some(r => CONFIG.scopedAccessRoles.indexOf(r) !== -1);

  const primary = matches[0];

  return {
    allowed: true,
    email,
    name: primary.name,
    role: roles.join(', '),
    roleLower,
    orgCodes,
    fullAccess,
    scopedAccess,
    publicUser: {
      email,
      name: primary.name,
      role: roles.join(', '),
      orgCode: orgCodes.join(', '),
      orgCodes,
      fullAccess,
      scopedAccess
    }
  };
}


/**
 * Reads budget rows from FCB tab.
 */
function getBudgetData_(orgNames) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.sheets.budget);

  let rows = [];

  if (sheet) {
    const data = sheet.getDataRange().getValues();

    if (data.length >= 2) {
      const headers = data[0];
      const h = CONFIG.headers.budget;

      const idx = {
        orgCode: findHeaderIndex_(headers, h.orgCode),
        officeName: findHeaderIndex_(headers, h.officeName),
        manager: findHeaderIndex_(headers, h.manager),
        personnel: findHeaderIndex_(headers, h.personnel),
        percentOfFcb: findHeaderIndex_(headers, h.percentOfFcb),
        otherAllocation: findHeaderIndex_(headers, h.otherAllocation),
        awtAllocation: findHeaderIndex_(headers, h.awtAllocation),
        totalAllocation: findHeaderIndex_(headers, h.totalAllocation)
      };

      if (
        idx.orgCode !== -1 &&
        (
          idx.totalAllocation !== -1 ||
          idx.otherAllocation !== -1 ||
          idx.awtAllocation !== -1
        )
      ) {
        for (let r = 1; r < data.length; r++) {
          const row = data[r];

          const orgCode = cleanOrgCode_(row[idx.orgCode]);
          if (!orgCode || orgCode === 'ALL') continue;

          const otherAllocation =
            idx.otherAllocation === -1 ? 0 : parseMoney_(row[idx.otherAllocation]);

          const awtAllocation =
            idx.awtAllocation === -1 ? 0 : parseMoney_(row[idx.awtAllocation]);

          let totalAllocation =
            idx.totalAllocation === -1
              ? otherAllocation + awtAllocation
              : parseMoney_(row[idx.totalAllocation]);

          if (!totalAllocation && (otherAllocation || awtAllocation)) {
            totalAllocation = otherAllocation + awtAllocation;
          }

          if (!totalAllocation && !otherAllocation && !awtAllocation) continue;

          rows.push({
            orgCode,
            officeName:
              idx.officeName === -1
                ? getOfficeName_(orgCode, orgNames)
                : String(row[idx.officeName] || getOfficeName_(orgCode, orgNames)).trim(),
            manager: idx.manager === -1 ? '' : String(row[idx.manager] || '').trim(),
            personnel: idx.personnel === -1 ? 0 : Number(row[idx.personnel]) || 0,
            percentOfFcb: idx.percentOfFcb === -1 ? 0 : parsePercent_(row[idx.percentOfFcb]),
            otherAllocation,
            awtAllocation,
            totalAllocation
          });
        }
      }
    }
  }

  /*
   * Fallback if FCB tab is missing or headers are not recognized.
   */
  if (!rows.length) {
    rows = CONFIG.fallbackBudget.map(b => ({
      orgCode: b.orgCode,
      officeName: b.officeName,
      manager: b.manager || '',
      personnel: b.personnel || 0,
      percentOfFcb: b.percentOfFcb || 0,
      otherAllocation: Number(b.otherAllocation) || 0,
      awtAllocation: Number(b.awtAllocation) || 0,
      totalAllocation: (Number(b.otherAllocation) || 0) + (Number(b.awtAllocation) || 0)
    }));
  }

  /*
   * Consolidate duplicate budget rows by exact Org Code.
   */
  const map = {};

  rows.forEach(row => {
    const code = cleanOrgCode_(row.orgCode);
    if (!code) return;

    if (!map[code]) {
      map[code] = {
        orgCode: code,
        officeName: row.officeName || getOfficeName_(code, orgNames),
        manager: row.manager || '',
        personnel: row.personnel || 0,
        percentOfFcb: row.percentOfFcb || 0,
        otherAllocation: 0,
        awtAllocation: 0,
        totalAllocation: 0
      };
    }

    map[code].otherAllocation += Number(row.otherAllocation) || 0;
    map[code].awtAllocation += Number(row.awtAllocation) || 0;

    const explicitTotal = Number(row.totalAllocation) || 0;

    if (explicitTotal) {
      map[code].totalAllocation += explicitTotal;
    } else {
      map[code].totalAllocation +=
        (Number(row.otherAllocation) || 0) +
        (Number(row.awtAllocation) || 0);
    }
  });

  return sortBudgetRows_(Object.values(map));
}


/**
 * Reads paid spend from Purchase Card tab.
 *
 * Spend matching:
 * 1. Uses Purchase Card Org Code first.
 * 2. If Org Code is blank, tries employee lookup from FCB Org Chart.
 * 3. If no org code can be found, row is excluded.
 */
function getPurchaseCardData_(employeeToOrg, orgNames) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.sheets.purchaseCard);

  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const h = CONFIG.headers.purchaseCard;

  const idx = {
    employeeName: findHeaderIndex_(headers, h.employeeName),
    orgCode: findHeaderIndex_(headers, h.orgCode),
    amount: findHeaderIndex_(headers, h.amount),
    paidDate: findHeaderIndex_(headers, h.paidDate),
    category: findHeaderIndex_(headers, h.category),
    vendor: findHeaderIndex_(headers, h.vendor),
    description: findHeaderIndex_(headers, h.description),
    status: findHeaderIndex_(headers, h.status),
    fiscalYear: findHeaderIndex_(headers, h.fiscalYear)
  };

  if (idx.amount === -1) {
    throw new Error('Purchase Card sheet is missing an Amount column. Update CONFIG.headers.purchaseCard.amount in Code.gs.');
  }

  const rows = [];

  for (let r = 1; r < data.length; r++) {
    const row = data[r];

    const amount = parseMoney_(row[idx.amount]);
    if (!amount) continue;

    if (CONFIG.usePaidStatusFilter && idx.status !== -1) {
      const status = String(row[idx.status] || '').trim().toLowerCase();
      if (status && CONFIG.paidStatuses.indexOf(status) === -1) continue;
    }

    const employeeName =
      idx.employeeName === -1 ? '' : String(row[idx.employeeName] || '').trim();

    let orgCode =
      idx.orgCode === -1 ? '' : cleanOrgCode_(row[idx.orgCode]);

    if (!orgCode && employeeName) {
      orgCode = employeeToOrg[normalizeName_(employeeName)] || '';
    }

    if (!orgCode) continue;

    const paidDate =
      idx.paidDate === -1 ? null : parseDate_(row[idx.paidDate]);

    const allocationValue =
      idx.category === -1 ? '' : String(row[idx.category] || '').trim();

    const description =
      idx.description === -1 ? '' : String(row[idx.description] || '').trim();

    const vendor =
      idx.vendor === -1 ? '' : String(row[idx.vendor] || '').trim();

    const category = classifyCategory_(allocationValue, description, vendor);

    const fiscalYear =
      idx.fiscalYear === -1
        ? fiscalYearFromDate_(paidDate)
        : normalizeFiscalYear_(row[idx.fiscalYear]) || fiscalYearFromDate_(paidDate);

    rows.push({
      rowNumber: r + 1,
      employeeName,
      orgCode,
      paidDate: paidDate ? paidDate.toISOString() : '',
      fiscalYear,
      category,
      vendor,
      description,
      amount,
      allocationValue
    });
  }

  return rows;
}


/**
 * Reads FCB Org Chart and maps employee names to org codes.
 */
function getOrgChartMap_() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.sheets.orgChart);

  const employeeToOrg = {};
  const orgNames = {};

  CONFIG.fallbackBudget.forEach(b => {
    orgNames[b.orgCode] = b.officeName;
  });

  if (!sheet) {
    return { employeeToOrg, orgNames };
  }

  const data = sheet.getDataRange().getValues();

  let currentOrg = '';

  for (let r = 0; r < data.length; r++) {
    const colA = String(data[r][0] || '').trim();
    const colB = String(data[r][1] || '').trim();

    const extractedCode = extractOrgCode_(colA);

    if (extractedCode) {
      currentOrg = extractedCode;

      const officeName = extractOfficeName_(colA);
      if (officeName) {
        orgNames[currentOrg] = officeName;
      }
    }

    if (colB && currentOrg) {
      employeeToOrg[normalizeName_(colB)] = currentOrg;
    }
  }

  return { employeeToOrg, orgNames };
}


/**
 * Calculates dashboard metrics after role-based filtering.
 *
 * Supervisor example:
 * - Role Org Code = FCBBB
 * - Budget row displayed = FCBB
 * - Spend included = Purchase Card rows where org code is FCBBB or starts with FCBBB
 */
function calculateDashboardMetrics_(budgetRows, purchaseRows, userAccess, filters) {
  const warnings = [];

  let authorizedBudgetRows = getAuthorizedBudgetRows_(budgetRows, userAccess);

  authorizedBudgetRows = authorizedBudgetRows
    .filter(row => matchesOfficeFilter_(row.orgCode, filters.office));

  const authorizedBudgetCodes = authorizedBudgetRows.map(r => r.orgCode);

  const authorizedTransactions = purchaseRows
    .filter(tx => userCanAccessOrg_(userAccess, tx.orgCode))
    .map(tx => {
      const spendBudgetOrg = resolveSpendBudgetOrg_(tx.orgCode, authorizedBudgetCodes);
      const enriched = Object.assign({}, tx);
      enriched.spendBudgetOrg = spendBudgetOrg;
      return enriched;
    })
    .filter(tx => tx.spendBudgetOrg)
    .filter(tx => matchesTransactionFilters_(tx, filters));

  const allAuthorizedTransactions = purchaseRows
    .filter(tx => userCanAccessOrg_(userAccess, tx.orgCode));

  const rowMap = {};

  authorizedBudgetRows.forEach(b => {
    rowMap[b.orgCode] = {
      orgCode: b.orgCode,
      officeName: b.officeName,
      manager: b.manager || '',
      personnel: b.personnel || 0,
      percentOfFcb: b.percentOfFcb || 0,

      otherBudget: Number(b.otherAllocation) || 0,
      awtBudget: Number(b.awtAllocation) || 0,
      totalBudget: Number(b.totalAllocation) || 0,

      otherSpent: 0,
      awtSpent: 0,
      spent: 0,
      remaining: Number(b.totalAllocation) || 0,
      percentUsed: 0
    };
  });

  authorizedTransactions.forEach(tx => {
    const bucket = tx.spendBudgetOrg;

    if (!rowMap[bucket]) return;

    rowMap[bucket].spent += tx.amount;

    if (tx.category === 'AWT') {
      rowMap[bucket].awtSpent += tx.amount;
    } else {
      rowMap[bucket].otherSpent += tx.amount;
    }
  });

  const officeRows = sortBudgetRows_(Object.keys(rowMap).map(code => {
    const row = rowMap[code];

    row.remaining = row.totalBudget - row.spent;
    row.percentUsed = row.totalBudget ? row.spent / row.totalBudget * 100 : 0;

    row.otherRemaining = row.otherBudget - row.otherSpent;
    row.awtRemaining = row.awtBudget - row.awtSpent;

    return row;
  }));

  const categoryFilter = String(filters.category || 'All').trim();

  const totalBudget = sum_(officeRows.map(r => {
    if (categoryFilter === 'Other') return r.otherBudget;
    if (categoryFilter === 'AWT') return r.awtBudget;
    return r.totalBudget;
  }));

  const totalSpent = sum_(authorizedTransactions.map(tx => tx.amount));
  const remaining = totalBudget - totalSpent;

  const otherBudget = sum_(officeRows.map(r => r.otherBudget));
  const awtBudget = sum_(officeRows.map(r => r.awtBudget));
  const otherSpent = sum_(officeRows.map(r => r.otherSpent));
  const awtSpent = sum_(officeRows.map(r => r.awtSpent));

  const recentTransactions = authorizedTransactions
    .map(tx => {
      const officeRow = rowMap[tx.spendBudgetOrg];
      const enriched = Object.assign({}, tx);

      enriched.officeName = officeRow ? officeRow.officeName : tx.spendBudgetOrg;
      enriched.fundingOrg = tx.spendBudgetOrg;

      return enriched;
    })
    .sort((a, b) => String(b.paidDate).localeCompare(String(a.paidDate)))
    .slice(0, 75);

  const fiscalYears = unique_(allAuthorizedTransactions.map(tx => tx.fiscalYear).filter(Boolean)).sort();

  const officeOptions = authorizedBudgetRows.map(row => ({
    orgCode: row.orgCode,
    officeName: row.officeName
  }));

  const monthlyMap = {};

  authorizedTransactions.forEach(tx => {
    const key = monthKey_(tx.paidDate);
    if (!key) return;
    monthlyMap[key] = (monthlyMap[key] || 0) + tx.amount;
  });

  const monthlyTrend = Object.keys(monthlyMap)
    .sort()
    .map(month => ({
      month,
      amount: monthlyMap[month]
    }));

  const chartData = {
    budgetVsSpent: officeRows.map(r => ({
      orgCode: r.orgCode,
      officeName: r.officeName,
      budget: r.totalBudget,
      spent: r.spent,
      remaining: r.remaining
    })),

    spendByCategory: [
      { category: 'Other', amount: otherSpent },
      { category: 'AWT', amount: awtSpent }
    ],

    monthlyTrend
  };

  return {
    warnings,
    summary: {
      totalBudget,
      totalSpent,
      remaining,
      percentUsed: totalBudget ? totalSpent / totalBudget * 100 : 0,

      otherBudget,
      otherSpent,
      otherRemaining: otherBudget - otherSpent,
      otherPercentUsed: otherBudget ? otherSpent / otherBudget * 100 : 0,

      awtBudget,
      awtSpent,
      awtRemaining: awtBudget - awtSpent,
      awtPercentUsed: awtBudget ? awtSpent / awtBudget * 100 : 0,

      transactionCount: authorizedTransactions.length
    },

    officeRows,
    recentTransactions,
    chartData,

    filterOptions: {
      offices: officeOptions,
      fiscalYears,
      categories: ['All', 'Other', 'AWT']
    }
  };
}


/**
 * Determines which budget rows a user may see.
 *
 * Executive/Admin/Budget Admin:
 * - See all budget rows.
 *
 * Supervisor:
 * - Sees the parent funding office budget row.
 *
 * Examples:
 * - Supervisor assigned FCBBB sees FCBB budget.
 * - Supervisor assigned FCBAA sees FCBA budget.
 * - Supervisor assigned FCB0AAA sees FCB0A budget.
 */
function getAuthorizedBudgetRows_(budgetRows, userAccess) {
  if (userAccess.fullAccess) {
    return budgetRows.slice();
  }

  const assignedCodes = (userAccess.orgCodes || [])
    .map(cleanOrgCode_)
    .filter(c => c && c !== 'ALL');

  const results = [];

  const isSupervisor = (userAccess.roleLower || [])
    .some(r => CONFIG.scopedAccessRoles.indexOf(r) !== -1);

  assignedCodes.forEach(assigned => {
    if (!assigned) return;

    if (isSupervisor) {
      const budgetOfficeCode = getSupervisorBudgetOfficeCode_(assigned);

      const budgetRow = budgetRows.find(row => {
        return cleanOrgCode_(row.orgCode) === budgetOfficeCode;
      });

      if (budgetRow) {
        results.push(budgetRow);
      }

      return;
    }

    /*
     * Conservative default for non-full-access, non-supervisor roles:
     * exact budget row only.
     */
    const exactRows = budgetRows.filter(row => {
      return cleanOrgCode_(row.orgCode) === assigned;
    });

    exactRows.forEach(row => results.push(row));
  });

  return uniqueRowsByOrg_(results);
}


/**
 * Converts a Supervisor's assigned org code to parent budget office.
 *
 * Examples:
 * - FCBBB   -> FCBB
 * - FCBBBA  -> FCBB
 * - FCBAA   -> FCBA
 * - FCBABA  -> FCBA
 * - FCB0AAA -> FCB0A
 */
function getSupervisorBudgetOfficeCode_(assignedOrgCode) {
  const code = cleanOrgCode_(assignedOrgCode);

  if (!code) return '';

  if (code.startsWith('FCB0A')) return 'FCB0A';
  if (code.startsWith('FCB0B')) return 'FCB0B';
  if (code.startsWith('FCB0C')) return 'FCB0C';
  if (code.startsWith('FCBA')) return 'FCBA';
  if (code.startsWith('FCBB')) return 'FCBB';

  /*
   * Do not allow plain FCB to automatically capture every FCB office.
   */
  if (code === 'FCB') return 'FCB';

  return code;
}


/**
 * Resolves a Purchase Card transaction org to the visible budget row.
 *
 * Example:
 * - Visible budget row = FCBB
 * - Transaction org = FCBBB
 * - Spend bucket = FCBB
 *
 * This does not grant access.
 * Access is already enforced by userCanAccessOrg_().
 */
function resolveSpendBudgetOrg_(transactionOrgCode, authorizedBudgetCodes) {
  const txCode = cleanOrgCode_(transactionOrgCode);
  if (!txCode) return '';

  const codes = (authorizedBudgetCodes || [])
    .map(cleanOrgCode_)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (let i = 0; i < codes.length; i++) {
    const budgetCode = codes[i];

    if (budgetCode === 'FCB') {
      if (txCode === 'FCB') return 'FCB';
      continue;
    }

    if (txCode === budgetCode || txCode.startsWith(budgetCode)) {
      return budgetCode;
    }
  }

  return '';
}


/**
 * Server-side access control.
 *
 * Supervisor access:
 * - Supervisor assigned FCBBB can see FCBBB and child orgs only.
 * - Supervisor assigned FCBAA can see FCBAA and child orgs only.
 * - Supervisor assigned FCBB can see FCBB and all FCBB child orgs.
 *
 * Full-access roles:
 * - Executive/Admin/Budget Admin see all.
 */
function userCanAccessOrg_(userAccess, orgCode) {
  if (!userAccess || !userAccess.allowed) return false;
  if (userAccess.fullAccess) return true;

  const code = cleanOrgCode_(orgCode);
  if (!code) return false;

  const orgCodes = userAccess.orgCodes || [];
  const roles = userAccess.roleLower || [];

  const isSupervisor = roles.some(r => CONFIG.scopedAccessRoles.indexOf(r) !== -1);

  for (let i = 0; i < orgCodes.length; i++) {
    const assigned = cleanOrgCode_(orgCodes[i]);

    if (!assigned || assigned === 'ALL') continue;

    /*
     * Do not let plain FCB automatically view every FCB* org.
     */
    if (assigned === 'FCB') {
      if (code === 'FCB') return true;
      continue;
    }

    if (isSupervisor) {
      if (code === assigned || code.startsWith(assigned)) {
        return true;
      }
    } else {
      /*
       * Conservative default:
       * exact org code only.
       */
      if (code === assigned) {
        return true;
      }
    }
  }

  return false;
}


function matchesTransactionFilters_(tx, filters) {
  filters = filters || {};

  if (filters.fiscalYear && filters.fiscalYear !== 'All') {
    if (String(tx.fiscalYear) !== String(filters.fiscalYear)) return false;
  }

  if (filters.category && filters.category !== 'All') {
    if (tx.category !== filters.category) return false;
  }

  if (filters.office && filters.office !== 'All') {
    const filterOffice = cleanOrgCode_(filters.office);

    if (tx.spendBudgetOrg !== filterOffice && !matchesOfficeFilter_(tx.orgCode, filterOffice)) {
      return false;
    }
  }

  if (filters.startDate) {
    const start = parseDate_(filters.startDate);
    const d = parseDate_(tx.paidDate);

    if (start && d && d < start) return false;
  }

  if (filters.endDate) {
    const end = parseDate_(filters.endDate);
    const d = parseDate_(tx.paidDate);

    if (end && d && d > end) return false;
  }

  if (filters.search) {
    const q = String(filters.search || '').trim().toLowerCase();

    const haystack = [
      tx.employeeName,
      tx.vendor,
      tx.description,
      tx.orgCode,
      tx.spendBudgetOrg,
      tx.category,
      tx.allocationValue
    ].join(' ').toLowerCase();

    if (q && haystack.indexOf(q) === -1) return false;
  }

  return true;
}


function matchesOfficeFilter_(orgCode, filterOffice) {
  if (!filterOffice || filterOffice === 'All') return true;

  const code = cleanOrgCode_(orgCode);
  const filter = cleanOrgCode_(filterOffice);

  if (!code || !filter) return false;

  if (filter === 'FCB') return code === 'FCB';

  return code === filter || code.startsWith(filter);
}


/**
 * Maps Purchase Card dropdown value to spend category.
 *
 * Requested mapping:
 * - Other Training $$ Allocation = Other Training Spent
 * - AWF Training $$ Allocation   = AWT Training Spent
 */
function classifyCategory_(categoryRaw, description, vendor) {
  const raw = String(categoryRaw || '').trim().toLowerCase();
  const combined = [categoryRaw, description, vendor].join(' ').toLowerCase();

  if (raw === 'awf training $$ allocation') return 'AWT';
  if (raw === 'awt training $$ allocation') return 'AWT';
  if (raw === 'awf training allocation') return 'AWT';
  if (raw === 'awt training allocation') return 'AWT';

  if (raw === 'other training $$ allocation') return 'Other';
  if (raw === 'other training allocation') return 'Other';

  if (combined.indexOf('awf') !== -1) return 'AWT';
  if (combined.indexOf('awt') !== -1) return 'AWT';
  if (combined.indexOf('advanced warrant') !== -1) return 'AWT';
  if (combined.indexOf('warrant training') !== -1) return 'AWT';

  return 'Other';
}


/**
 * Spreadsheet helper.
 */
function getSpreadsheet_() {
  if (CONFIG.spreadsheetId) {
    return SpreadsheetApp.openById(CONFIG.spreadsheetId);
  }

  return SpreadsheetApp.getActiveSpreadsheet();
}


function findHeaderIndex_(headers, aliases) {
  const normalizedHeaders = headers.map(h => normalizeHeader_(h));

  for (let i = 0; i < aliases.length; i++) {
    const target = normalizeHeader_(aliases[i]);
    const found = normalizedHeaders.indexOf(target);

    if (found !== -1) return found;
  }

  return -1;
}


function normalizeHeader_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}


function normalizeName_(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ');
}


function cleanOrgCode_(value) {
  let text = String(value || '').trim().toUpperCase();

  if (!text) return '';

  const parenMatch = text.match(/\(([A-Z0-9]+)\)/);
  if (parenMatch) return parenMatch[1];

  const codeMatch = text.match(/\b(FCB[A-Z0-9]*)\b/);
  if (codeMatch) return codeMatch[1];

  if (text === 'ALL') return 'ALL';

  return text.replace(/[^A-Z0-9]/g, '');
}


function extractOrgCode_(text) {
  return cleanOrgCode_(text);
}


function extractOfficeName_(text) {
  const s = String(text || '').trim();

  if (!s) return '';

  return s.replace(/^\([A-Z0-9]+\)\s*/, '').trim();
}


function getOfficeName_(orgCode, orgNames) {
  const code = cleanOrgCode_(orgCode);

  if (!code) return '';

  if (orgNames && orgNames[code]) return orgNames[code];

  const fallback = CONFIG.fallbackBudget.find(b => b.orgCode === code);
  if (fallback) return fallback.officeName;

  return code;
}


function parseMoney_(value) {
  if (typeof value === 'number') return value;

  let text = String(value || '').trim();

  if (!text) return 0;

  const isNegative = /^\(.*\)$/.test(text) || text.indexOf('-') === 0;

  text = text
    .replace(/[,$]/g, '')
    .replace(/[()]/g, '')
    .replace(/[^0-9.\-]/g, '');

  const num = Number(text);

  if (isNaN(num)) return 0;

  return isNegative ? -Math.abs(num) : num;
}


function parsePercent_(value) {
  if (typeof value === 'number') {
    return value <= 1 ? value * 100 : value;
  }

  const text = String(value || '').replace('%', '').trim();
  const num = Number(text);

  return isNaN(num) ? 0 : num;
}


function parseDate_(value) {
  if (!value) return null;

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value;
  }

  const d = new Date(value);

  if (isNaN(d.getTime())) return null;

  return d;
}


function fiscalYearFromDate_(dateValue) {
  const d = parseDate_(dateValue);

  if (!d) return '';

  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  const fy = month >= 10 ? year + 1 : year;

  return 'FY' + String(fy).slice(-2);
}


function normalizeFiscalYear_(value) {
  const text = String(value || '').trim().toUpperCase();

  if (!text) return '';

  const fyMatch = text.match(/FY\s?(\d{2,4})/);

  if (fyMatch) {
    const n = fyMatch[1];
    return 'FY' + n.slice(-2);
  }

  const yearMatch = text.match(/\b(20\d{2})\b/);

  if (yearMatch) {
    return 'FY' + yearMatch[1].slice(-2);
  }

  return text;
}


function monthKey_(dateValue) {
  const d = parseDate_(dateValue);

  if (!d) return '';

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');

  return y + '-' + m;
}


function isTruthy_(value) {
  if (typeof value === 'boolean') return value;

  const text = String(value || '').trim().toLowerCase();

  return ['true', 'yes', 'y', '1', 'active', 'enabled'].indexOf(text) !== -1;
}


function sum_(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}


function unique_(arr) {
  return Array.from(new Set(arr));
}


function uniqueRowsByOrg_(rows) {
  const seen = {};
  const result = [];

  rows.forEach(row => {
    const code = cleanOrgCode_(row.orgCode);

    if (!code || seen[code]) return;

    seen[code] = true;
    result.push(row);
  });

  return result;
}


function sortBudgetRows_(rows) {
  return rows.sort((a, b) => {
    const ac = cleanOrgCode_(a.orgCode);
    const bc = cleanOrgCode_(b.orgCode);

    const order = ['FCB', 'FCB0A', 'FCB0B', 'FCB0C', 'FCBA', 'FCBB'];

    const ai = order.indexOf(ac);
    const bi = order.indexOf(bc);

    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    }

    return ac.localeCompare(bc);
  });
}