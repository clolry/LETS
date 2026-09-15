/**
 * TravelOrgLookup.js
 *
 * Shared org-code lookup util used by:
 *   - TravelReviewerDashboardService.js (reviewer dashboard)
 *   - TravelAdminService.js              (admin dashboard)
 *   - TravelSubmissionService.js         (submission routing — current data only)
 *
 * Why this file exists:
 *   HC's Org Hierarchy table tracks org-code reorgs in a CSV field
 *   (formerOrgCodes). After a reorg from QFA → FAB, requests submitted under
 *   the old codes still live in the Requests / Request_Travelers sheets with
 *   those former codes. Without canonicalization, dashboards silently drop
 *   them from BU/sector resolution and from spend totals.
 *
 *   loadOrgLookups() expands each current orgCode's mapping to ALSO cover
 *   every entry in formerOrgCodes — so 'QFAA' resolves to today's BU /
 *   Sector / Division regardless of when it was stored on a row.
 */

/**
 * Load HC org hierarchy into orgCode → BU/Sector/Division maps with
 * formerOrgCodes expansion baked in.
 *
 * @returns {Object} {
 *   orgToBU: { [orgCode]: 'Army' },
 *   orgToSector: { [orgCode]: 'Sector 1' },              // normalized
 *   orgToDivision: { [orgCode]: 'Division Name' },
 *   orgToCurrentOrgCode: { [former]: 'FAB1', [current]: 'FAB1' }
 * }
 */
function loadOrgLookups() {
  var lookups = {
    orgToBU: {},
    orgToSector: {},
    orgToDivision: {},
    orgToCurrentOrgCode: {}
  };
  try {
    var orgs = HC.hcGetOrgHierarchy();
    for (var i = 0; i < orgs.length; i++) {
      var o = orgs[i];
      if (!o || !o.orgCode) continue;

      // Current orgCode → current values
      lookups.orgToCurrentOrgCode[o.orgCode] = o.orgCode;
      if (o.businessUnit) lookups.orgToBU[o.orgCode] = o.businessUnit;
      if (o.sector) lookups.orgToSector[o.orgCode] = normalizeSectorName(o.sector);
      if (o.division) lookups.orgToDivision[o.orgCode] = o.division;

      // Former org codes → SAME current values
      var formers = Array.isArray(o.formerOrgCodes) ? o.formerOrgCodes : [];
      for (var f = 0; f < formers.length; f++) {
        var former = String(formers[f] || '').trim();
        if (!former) continue;
        lookups.orgToCurrentOrgCode[former] = o.orgCode;
        if (o.businessUnit) lookups.orgToBU[former] = o.businessUnit;
        if (o.sector) lookups.orgToSector[former] = normalizeSectorName(o.sector);
        if (o.division) lookups.orgToDivision[former] = o.division;
      }
    }
  } catch (e) {
    console.warn('loadOrgLookups: HC error: ' + e.message);
  }
  return lookups;
}

/**
 * Returns the canonical list of AAS BUs and sectors derived from HC's
 * org hierarchy — the trustworthy source for "which BUs/sectors can
 * have a TRIP reviewer assigned." Used by the admin Users page to
 * populate the role scope dropdowns instead of staffing-prefix scans
 * (which would leak non-AAS orgs into the list).
 *
 * Dedupes by code. Sector name is normalized via normalizeSectorName.
 * Returns:
 *   {
 *     businessUnits: [{ code: 'QFA', name: 'Army' }, ...],
 *     sectors:       [{ code: 'QFAA', name: 'Sector 1', buCode: 'QFA', buName: 'Army' }, ...]
 *   }
 *
 * @returns {Object} { success, businessUnits, sectors }
 */
function getAASOrgScope() {
  try {
    var orgs = HC.hcGetOrgHierarchy();
    // Dedupe by NAME (not orgCode prefix) since HC's org codes will
    // restructure later and a single BU can already span multiple
    // prefixes today. Names are stable; the orgCode list is stored as
    // a side-channel for tooltip display.
    var bu = {};       // BU name -> { name, codes: [orgCode, ...] }
    var sector = {};   // sectorCode -> { code, name, buCode, buName, codes: [...] }
    var EXCLUDED_STATUSES = ['decommissioned', 'not in use'];
    // BUs that exist in HC but aren't TRIP-routable.
    //   Commissioner's Office — AAS FO Primary sits here; submissions
    //                           route via the AAS FO stage directly.
    //   Innovation            — flagged Not In Use; going away.
    var EXCLUDED_BUS = ["Commissioner's Office", "Innovation"];
    for (var i = 0; i < orgs.length; i++) {
      var o = orgs[i];
      if (!o || !o.orgCode) continue;
      var rawStatus = String(o.status || '').trim().toLowerCase();
      if (rawStatus && EXCLUDED_STATUSES.indexOf(rawStatus) !== -1) continue;
      var orgCode = String(o.orgCode);
      var buName = o.businessUnit || '';
      if (buName && EXCLUDED_BUS.indexOf(buName) !== -1) continue;
      var sectorName = o.sector ? normalizeSectorName(o.sector) : '';
      if (buName) {
        if (!bu[buName]) bu[buName] = { name: buName, codes: [] };
        if (bu[buName].codes.indexOf(orgCode) === -1) bu[buName].codes.push(orgCode);
      }
      // Skip rows where sector is null/empty — those orgs operate at the
      // BU level and route through the BU stage, not a sector stage.
      //
      // Dedupe by SECTOR CODE (first 4 chars of orgCode), not sector
      // NAME. Sector names collide across BUs ("Sector 1" exists in
      // Army, Defense, AF/Navy/SF, ...). The 4-char code is unique by
      // HC convention (QFAA = Army's Sector 1, QFEA = Defense's Sector
      // 1, etc.) — that's what disambiguates them.
      if (sectorName) {
        var sectorCode = orgCode.substring(0, 4).toUpperCase();
        var buCode = orgCode.substring(0, 3).toUpperCase();
        if (!sector[sectorCode]) {
          sector[sectorCode] = {
            code: sectorCode,
            name: sectorName,
            buCode: buCode,
            buName: buName,
            codes: []
          };
        }
        if (sector[sectorCode].codes.indexOf(orgCode) === -1) {
          sector[sectorCode].codes.push(orgCode);
        }
      }
    }
    // Specific organizational display order — matches the AAS BU hierarchy
    // as the org chart shows it. Names not in this list fall to the end
    // alphabetically so new BUs added to HC don't break the list, they
    // just appear after the known ones.
    var BU_DISPLAY_ORDER = ['OSO', 'Army', 'AF/Navy/SF', 'Civilian', 'Defense'];
    function _buOrderIndex(name) {
      if (!name) return BU_DISPLAY_ORDER.length + 1;
      var lower = String(name).toLowerCase();
      for (var i = 0; i < BU_DISPLAY_ORDER.length; i++) {
        if (BU_DISPLAY_ORDER[i].toLowerCase() === lower) return i;
      }
      return BU_DISPLAY_ORDER.length + 1;
    }

    var businessUnits = Object.keys(bu).map(function(k) { return bu[k]; });
    businessUnits.sort(function(a, b) {
      var ai = _buOrderIndex(a.name);
      var bi = _buOrderIndex(b.name);
      if (ai !== bi) return ai - bi;
      return (a.name || '').localeCompare(b.name || '');
    });

    // Sectors stay alphabetical for now — the org-order convention is
    // BU-level only. Sectors can adopt their own order list later if needed.
    var sectors = Object.keys(sector).map(function(k) { return sector[k]; });
    sectors.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    return {
      success: true,
      businessUnits: businessUnits,
      sectors: sectors
    };
  } catch (e) {
    console.error('getAASOrgScope error:', e);
    return { success: false, error: e.message, businessUnits: [], sectors: [] };
  }
}

/**
 * Phase 7 routing-coverage verifier. Walks Travel_User_Roles + the AAS
 * org scope to report exactly who is configured for each routing stage,
 * and red-flags any gap that would silently break submissions.
 *
 * Run from the Apps Script editor — pure read, no writes.
 *
 * Output (structured + logged):
 *   admins:          [{ name, email }, ...]
 *   aas_fo:          { primary, backups: [...] }
 *   fas_fo:          { primary }
 *   bu_reviewers:    { '<BU name>': { primary, backup } }
 *   sector_overrides: [{ sectorName, person }]
 *   approved_users:  count
 *   issues:          [ '...', ... ]    ← non-empty means something needs fixing
 *
 * @returns {Object} report
 */
function verifyPhase7Routing() {
  var report = {
    admins: [],
    aas_fo: { primary: null, backups: [] },
    fas_fo: { primary: null },
    bu_reviewers: {},
    sector_overrides: [],
    approved_users: 0,
    issues: []
  };

  try {
    var data = _getUnifiedRoleData();
    for (var em in data.rolesByEmail) {
      if (!data.rolesByEmail.hasOwnProperty(em)) continue;
      var roles = data.rolesByEmail[em];
      for (var i = 0; i < roles.length; i++) {
        var r = roles[i];
        var person = { name: r.userName || '', email: em };
        if (r.roleType === 'admin') {
          report.admins.push(person);
        } else if (r.roleType === 'aas_fo_reviewer') {
          if (r.isPrimary && !report.aas_fo.primary) report.aas_fo.primary = person;
          else report.aas_fo.backups.push(person);
        } else if (r.roleType === 'fas_fo_reviewer') {
          if (r.isPrimary && !report.fas_fo.primary) report.fas_fo.primary = person;
        } else if (r.roleType === 'bu_reviewer') {
          var slot = report.bu_reviewers[r.scope] = report.bu_reviewers[r.scope] || { primary: null, backup: null };
          if (r.isPrimary && !slot.primary) slot.primary = person;
          else if (!r.isPrimary && !slot.backup) slot.backup = person;
        } else if (r.roleType === 'sector_override') {
          report.sector_overrides.push({ sectorName: r.scope, person: person });
        } else if (r.roleType === 'approved_user') {
          report.approved_users++;
        }
      }
    }
  } catch (e) {
    report.issues.push('FATAL: _getUnifiedRoleData failed — ' + e.message);
    console.error('verifyPhase7Routing data load error:', e);
  }

  // Critical-gap checks
  if (!report.admins.length) {
    report.issues.push('No active admin — admin console inaccessible');
  }
  if (!report.aas_fo.primary) {
    report.issues.push('No active primary aas_fo_reviewer — AAS FO stage routing fails');
  }
  if (!report.fas_fo.primary) {
    report.issues.push('No active primary fas_fo_reviewer — overhead requests stuck at PENDING_FAS with no reviewer');
  }

  // BU coverage check — every AAS BU should have at least a primary
  try {
    var scope = getAASOrgScope();
    if (scope && scope.success) {
      for (var k = 0; k < scope.businessUnits.length; k++) {
        var buName = scope.businessUnits[k].name;
        if (!report.bu_reviewers[buName]) {
          report.issues.push('BU "' + buName + '" has NO reviewers configured — submissions cascade to OSO');
        } else if (!report.bu_reviewers[buName].primary) {
          report.issues.push('BU "' + buName + '" has no active primary — only backup reachable');
        }
      }
      // Also flag any bu_reviewer whose Scope name is NOT in the AAS scope
      // (typo or stale name)
      for (var sn in report.bu_reviewers) {
        var found = false;
        for (var j = 0; j < scope.businessUnits.length; j++) {
          if (scope.businessUnits[j].name === sn) { found = true; break; }
        }
        if (!found) {
          report.issues.push('Reviewer scope "' + sn + '" does not match any AAS BU name — typo? routing won\'t fire');
        }
      }
    }
  } catch (e) {
    report.issues.push('AAS scope check failed — ' + e.message);
  }

  // Pretty-print log
  console.log('=== Phase 7 Routing Verification ===');
  console.log(JSON.stringify(report, null, 2));
  if (report.issues.length === 0) {
    console.log('OK: every routing path has at least one active primary, every AAS BU is covered.');
  } else {
    console.warn('Issues found (' + report.issues.length + '):');
    report.issues.forEach(function(s, i) { console.warn('  ' + (i + 1) + '. ' + s); });
  }
  return report;
}

/**
 * Normalize sector display strings: "Sector 1 (Systems)" → "Sector 1".
 * Strips parenthetical descriptors so the same sector reads consistently
 * across UI surfaces.
 *
 * @param {string} s
 * @returns {string}
 */
function normalizeSectorName(s) {
  if (!s) return s;
  return s.replace(/\s*\(.*\)$/, '');
}
