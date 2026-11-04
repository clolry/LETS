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

// ============================================================================
// REAL ORG CODES — @clolry, corrected November 2026
// ============================================================================
//
// 137 codes. Supplied as a May snapshot, then CORRECTED by @clolry after I
// drew the wrong hierarchy from it.
//
// WHAT THE MAY DATA GOT WRONG
// ---------------------------
// I inferred the tree from org-code LENGTH and asserted that FCBA sat under
// FCA. It sits under FCB. @clolry: "FCBA is not under FCA - it's part of FCB."
//
// Two division names were also transposed in the source: FCA0CB and FCA0DB
// had each other's names, which read plausibly because both pairs are
// Workforce-something and analytics-something.
//
// So the parent and the level are now STORED per row rather than derived.
// Deriving them from length is what produced the wrong answer, and it was
// wrong in a way that looked right.
//
// THE '0' IS A FILLER, NOT A LEVEL
// --------------------------------
// @clolry: "In FCA it goes directly from FCA to FCA0A ... there isn't a
// 4-character level." So FCA0A's parent is FCA, not FCA0.
//
// FCB and FCC DO have a 4-character office level — FCBA (Office of MAS),
// FCBB (Office of Non-MAS), FCCA (Office of IT Category) — and FCA does not.
// Depth therefore varies by branch of the tree, which is precisely why length
// cannot stand in for it.
//
// LEVELS
// ------
//   AC               FC          the Assistant Commissioner and his advisor
//   DAC              FCA/B/C     where the DACs sit
//   OFFICE           4 chars     FCB and FCC only
//   SERVICE_CENTER   5 chars     22 of them. A Service Center Director is
//                                the supervisory person whose own Dept ID is
//                                exactly one of these
//   DIVISION         6 chars
//   BRANCH           7 chars
//
// TWO SERVICE CENTRES SHARE A NAME, legitimately: Acquisition Service Center
// 2 exists under both Office of MAS (FCBAC) and Office of Non-MAS (FCBBB).
// @clolry confirmed they are distinct. The code is the key; a display name
// should prefix the parent office or a dropdown shows two identical entries.
//
// WHY THESE ARE ROWS AND NOT DERIVED
// ----------------------------------
// Prefix resolution alone makes FCA0A *work* — it inherits FCA's business
// unit — but it cannot know FCA0A is the "Portfolio Management Service
// Center". Without these rows every sub-org displays as its parent's name,
// and the roster validator cannot tell FCA0A from the typo FCAXX, since both
// resolve to FCA.
//
// WHY ONLY FOUR CARRY A BUDGET KEY
// --------------------------------
// officeCode and businessUnit are DELIBERATELY blank on all 133 sub-orgs.
// Only FC/FCA/FCB/FCC are budget offices in BudgetConfig.js, and
// HCData.inheritOrgField walks up the prefix chain to find them. Copying OMD
// onto all 22 FCA descendants would mean a reorganisation had to edit 22 rows
// instead of one.
//
// To move a service center to a different DAC, fill officeCode and
// businessUnit on its own row — an explicit value beats the inherited one.
//
// FIELD NAMES ARE ABBREVIATED (c/o/b/d) so each row fits one line. 137 rows
// of four-key objects is 550 lines of mostly whitespace otherwise.
//
// ACCURACY: @clolry's words — "a bit outdated but this should be pretty
// close". Treat a code missing from this list as plausible rather than wrong;
// prefix resolution still attributes it correctly, and validateHCData reports
// it so it can be added.
//
var HC_REAL_ORGS = [
  // ---- FC (budget key FO) ------------------------------------------------
  { c: 'FC',      p: '',        v: 'AC',            o: 'FO',   b: 'Front Office',  d: 'Office of Acquisition Solutions Development' },

  // ---- FCA (budget key OMD) ----------------------------------------------
  { c: 'FCA',     p: 'FC',      v: 'DAC',           o: 'OMD',  b: 'OMD',           d: 'Office of Mission Delivery' },
  { c: 'FCA0A',   p: 'FCA',     v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Portfolio Management Service Center' },
  { c: 'FCA0B',   p: 'FCA',     v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Stakeholder Connection and Engagement Service Center' },
  { c: 'FCA0BA',  p: 'FCA0B',   v: 'DIVISION',      o: '',     b: '',              d: 'Stakeholder Connection Division' },
  { c: 'FCA0BAA', p: 'FCA0BA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCA0BAB', p: 'FCA0BA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCA0BB',  p: 'FCA0B',   v: 'DIVISION',      o: '',     b: '',              d: 'Stakeholder Engagement Division' },
  { c: 'FCA0BBA', p: 'FCA0BB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCA0BBB', p: 'FCA0BB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCA0C',   p: 'FCA',     v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Workforce Service Center' },
  { c: 'FCA0CA',  p: 'FCA0C',   v: 'DIVISION',      o: '',     b: '',              d: 'Workforce Operations Division' },
  { c: 'FCA0CB',  p: 'FCA0C',   v: 'DIVISION',      o: '',     b: '',              d: 'Workforce Planning Division' },
  { c: 'FCA0D',   p: 'FCA',     v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Business Analytics Service Center' },
  { c: 'FCA0DA',  p: 'FCA0D',   v: 'DIVISION',      o: '',     b: '',              d: 'Accountability and Operational Analysis Division' },
  { c: 'FCA0DB',  p: 'FCA0D',   v: 'DIVISION',      o: '',     b: '',              d: 'Enterprise Intelligence Division' },
  { c: 'FCA0E',   p: 'FCA',     v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Systems Service Center' },
  { c: 'FCA0EA',  p: 'FCA0E',   v: 'DIVISION',      o: '',     b: '',              d: 'Buying-Ordering Tools Division' },
  { c: 'FCA0EB',  p: 'FCA0E',   v: 'DIVISION',      o: '',     b: '',              d: 'Contracting Tools Division 1' },
  { c: 'FCA0EC',  p: 'FCA0E',   v: 'DIVISION',      o: '',     b: '',              d: 'Contracting Tools Division 2' },
  { c: 'FCA0ED',  p: 'FCA0E',   v: 'DIVISION',      o: '',     b: '',              d: 'Pricing Tools Division' },
  { c: 'FCA0EDA', p: 'FCA0ED',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCA0EDB', p: 'FCA0ED',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },

  // ---- FCB (budget key IDV) ----------------------------------------------
  { c: 'FCB',     p: 'FC',      v: 'DAC',           o: 'IDV',  b: 'IDV',           d: 'Office of Indefinite Delivery Vehicle Acquisition Management' },
  { c: 'FCB0A',   p: 'FCB',     v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Indefinite Delivery Vehicle Implementation and Warrant Management Service Center' },
  { c: 'FCB0AA',  p: 'FCB0A',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 1' },
  { c: 'FCB0AAA', p: 'FCB0AA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCB0AAB', p: 'FCB0AA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCB0AB',  p: 'FCB0A',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 2' },
  { c: 'FCB0B',   p: 'FCB',     v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Indefinite Delivery Vehicle Supplier Compliance Service Center' },
  { c: 'FCB0BA',  p: 'FCB0B',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 1' },
  { c: 'FCB0BAA', p: 'FCB0BA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCB0BAB', p: 'FCB0BA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCB0BB',  p: 'FCB0B',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 2' },
  { c: 'FCB0BBA', p: 'FCB0BB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCB0BBB', p: 'FCB0BB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCB0C',   p: 'FCB',     v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Cyber-Supply Chain Risk Management Service Center' },
  { c: 'FCBA',    p: 'FCB',     v: 'OFFICE',        o: '',     b: '',              d: 'Office of MAS' },
  { c: 'FCBAA',   p: 'FCBA',    v: 'SERVICE_CENTER', o: '',     b: '',              d: 'MAS Program Management Service Center' },
  { c: 'FCBAAA',  p: 'FCBAA',   v: 'DIVISION',      o: '',     b: '',              d: 'Solicitation and Training Division' },
  { c: 'FCBAAB',  p: 'FCBAA',   v: 'DIVISION',      o: '',     b: '',              d: 'Intake and Performance Division' },
  { c: 'FCBAAC',  p: 'FCBAA',   v: 'DIVISION',      o: '',     b: '',              d: 'Analysis and Improvement Division' },
  { c: 'FCBAB',   p: 'FCBA',    v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Acquisition Service Center 1' },
  { c: 'FCBABA',  p: 'FCBAB',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 1' },
  { c: 'FCBABB',  p: 'FCBAB',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 2' },
  { c: 'FCBABBA', p: 'FCBABB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBABBB', p: 'FCBABB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBABC',  p: 'FCBAB',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 3' },
  { c: 'FCBABCA', p: 'FCBABC',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBABCB', p: 'FCBABC',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBABCC', p: 'FCBABC',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch C' },
  { c: 'FCBABD',  p: 'FCBAB',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 4' },
  { c: 'FCBABDA', p: 'FCBABD',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBABDB', p: 'FCBABD',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBABE',  p: 'FCBAB',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 5' },
  { c: 'FCBABEA', p: 'FCBABE',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBABEB', p: 'FCBABE',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBAC',   p: 'FCBA',    v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Acquisition Service Center 2' },
  { c: 'FCBACA',  p: 'FCBAC',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 1' },
  { c: 'FCBACAA', p: 'FCBACA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBACAB', p: 'FCBACA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBACB',  p: 'FCBAC',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 2' },
  { c: 'FCBACBA', p: 'FCBACB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBACBB', p: 'FCBACB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBACBC', p: 'FCBACB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch C' },
  { c: 'FCBACC',  p: 'FCBAC',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 3' },
  { c: 'FCBACCA', p: 'FCBACC',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBACCB', p: 'FCBACC',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBAD',   p: 'FCBA',    v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Acquisition Service Center 3' },
  { c: 'FCBADA',  p: 'FCBAD',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 1' },
  { c: 'FCBADAA', p: 'FCBADA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBADAB', p: 'FCBADA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBADAC', p: 'FCBADA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch C' },
  { c: 'FCBADB',  p: 'FCBAD',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 2' },
  { c: 'FCBADBA', p: 'FCBADB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBADBB', p: 'FCBADB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBADBC', p: 'FCBADB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch C' },
  { c: 'FCBADC',  p: 'FCBAD',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 3' },
  { c: 'FCBADCA', p: 'FCBADC',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBADCB', p: 'FCBADC',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBADCC', p: 'FCBADC',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch C' },
  { c: 'FCBADD',  p: 'FCBAD',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 4' },
  { c: 'FCBADDA', p: 'FCBADD',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBADDB', p: 'FCBADD',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBADDC', p: 'FCBADD',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch C' },
  { c: 'FCBADDD', p: 'FCBADD',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch D' },
  { c: 'FCBAE',   p: 'FCBA',    v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Acquisition Service Center 4' },
  { c: 'FCBAEA',  p: 'FCBAE',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 1' },
  { c: 'FCBAEAA', p: 'FCBAEA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBAEAB', p: 'FCBAEA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBAEAC', p: 'FCBAEA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch C' },
  { c: 'FCBAEAD', p: 'FCBAEA',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch D' },
  { c: 'FCBAEB',  p: 'FCBAE',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 2' },
  { c: 'FCBAEBA', p: 'FCBAEB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBAEBB', p: 'FCBAEB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBAEBC', p: 'FCBAEB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch C' },
  { c: 'FCBAEBD', p: 'FCBAEB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch D' },
  { c: 'FCBAEBE', p: 'FCBAEB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch E' },
  { c: 'FCBB',    p: 'FCB',     v: 'OFFICE',        o: '',     b: '',              d: 'Office of Non-MAS' },
  { c: 'FCBBA',   p: 'FCBB',    v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Acquisition Service Center 1' },
  { c: 'FCBBAA',  p: 'FCBBA',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 1' },
  { c: 'FCBBAB',  p: 'FCBBA',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 2' },
  { c: 'FCBBABA', p: 'FCBBAB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCBBABB', p: 'FCBBAB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCBBAC',  p: 'FCBBA',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 3' },
  { c: 'FCBBB',   p: 'FCBB',    v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Acquisition Service Center 2' },
  { c: 'FCBBBA',  p: 'FCBBB',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 1' },
  { c: 'FCBBBB',  p: 'FCBBB',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 2' },
  { c: 'FCBBBC',  p: 'FCBBB',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 3' },
  { c: 'FCBBC',   p: 'FCBB',    v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Acquisition Service Center 3' },
  { c: 'FCBBCA',  p: 'FCBBC',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 1' },
  { c: 'FCBBCB',  p: 'FCBBC',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 2' },
  { c: 'FCBBCC',  p: 'FCBBC',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 3' },
  { c: 'FCBBCD',  p: 'FCBBC',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 4' },
  { c: 'FCBBCE',  p: 'FCBBC',   v: 'DIVISION',      o: '',     b: '',              d: 'Division 5' },

  // ---- FCC (budget key CM) -----------------------------------------------
  { c: 'FCC',     p: 'FC',      v: 'DAC',           o: 'CM',   b: 'CM',            d: 'Office of Category Management' },
  { c: 'FCC0A',   p: 'FCC',     v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Category Management Service Center' },
  { c: 'FCC0B',   p: 'FCC',     v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Vendor Management Service Center' },
  { c: 'FCC0C',   p: 'FCC',     v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Non-IT Program Management Service Center' },
  { c: 'FCCA',    p: 'FCC',     v: 'OFFICE',        o: '',     b: '',              d: 'Office of IT Category' },
  { c: 'FCCAA',   p: 'FCCA',    v: 'SERVICE_CENTER', o: '',     b: '',              d: 'IT Products Service Center' },
  { c: 'FCCAAA',  p: 'FCCAA',   v: 'DIVISION',      o: '',     b: '',              d: 'Software Division' },
  { c: 'FCCAAAA', p: 'FCCAAA',  v: 'BRANCH',        o: '',     b: '',              d: 'Solutions Development Branch' },
  { c: 'FCCAAAB', p: 'FCCAAA',  v: 'BRANCH',        o: '',     b: '',              d: 'Service Delivery Branch' },
  { c: 'FCCAAB',  p: 'FCCAA',   v: 'DIVISION',      o: '',     b: '',              d: 'Hardware Division' },
  { c: 'FCCAB',   p: 'FCCA',    v: 'SERVICE_CENTER', o: '',     b: '',              d: 'IT Services Service Center' },
  { c: 'FCCABA',  p: 'FCCAB',   v: 'DIVISION',      o: '',     b: '',              d: 'IT Services Division' },
  { c: 'FCCABB',  p: 'FCCAB',   v: 'DIVISION',      o: '',     b: '',              d: 'IT Security Division' },
  { c: 'FCCAC',   p: 'FCCA',    v: 'SERVICE_CENTER', o: '',     b: '',              d: 'Enterprise Technology Solutions Service Center' },
  { c: 'FCCACA',  p: 'FCCAC',   v: 'DIVISION',      o: '',     b: '',              d: 'Business Management Division' },
  { c: 'FCCACAA', p: 'FCCACA',  v: 'BRANCH',        o: '',     b: '',              d: 'Program Management Branch' },
  { c: 'FCCACAB', p: 'FCCACA',  v: 'BRANCH',        o: '',     b: '',              d: 'Mission Support Branch' },
  { c: 'FCCACAC', p: 'FCCACA',  v: 'BRANCH',        o: '',     b: '',              d: 'Strategic Partner Analytics Branch' },
  { c: 'FCCACB',  p: 'FCCAC',   v: 'DIVISION',      o: '',     b: '',              d: 'Technology Account Management Division' },
  { c: 'FCCACBA', p: 'FCCACB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch A' },
  { c: 'FCCACBB', p: 'FCCACB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch B' },
  { c: 'FCCACBC', p: 'FCCACB',  v: 'BRANCH',        o: '',     b: '',              d: 'Branch C' },
];

/**
 * HC_SEED_ORGS-shaped records for the 137 real codes.
 *
 * Expands the abbreviated table above. Kept separate from HC_SEED_ORGS, which
 * is four FICTIONAL orgs matched to the fictional seed roster — overwriting
 * that would break the seed data's own tests.
 *
 * @returns {Array<Object>}
 */
function hcRealOrgRecords() {
  return HC_REAL_ORGS.map(function (o) {
    return {
      orgCode: o.c,
      // STORED, not derived. Deriving the parent from the code length gave
      // the wrong tree — see the note above.
      parentOrgCode: o.p,
      orgLevel: o.v,
      officeCode: o.o,
      businessUnit: o.b,
      sector: 'ASD',
      division: o.d,
      status: 'Active',
      formerOrgCodes: ''
    };
  });
}

/**
 * Service centre org codes.
 *
 * @clolry: "We don't call them Sector Directors, we call them Service Center
 * Directors - I'm not precisely sure how to tell you how to identify what a
 * service center is or who the director is."
 *
 * The answer was in the org list: a service centre is a row whose level is
 * SERVICE_CENTER, and there are 22. The DIRECTOR is then the supervisory
 * person whose own Dept ID is exactly that code — somebody in FCA0BAA belongs
 * to a branch, while somebody sitting directly at FCA0B is at the service
 * centre level.
 *
 * THIS MATTERS BECAUSE FOUR CALL SITES LOOK FOR THE WRONG THING. They match a
 * title containing 'sector director', which does not exist in this
 * organisation — so all four find nobody, including the one that resolves the
 * routing reviewer. That would have failed silently the moment the real
 * roster loaded.
 *
 * @returns {Array<string>}
 */
function hcServiceCenterCodes() {
  return HC_REAL_ORGS
    .filter(function (o) { return o.v === 'SERVICE_CENTER'; })
    .map(function (o) { return o.c; });
}

/**
 * Display name for an org code, with the parent office prefixed when the
 * bare name is ambiguous.
 *
 * Acquisition Service Center 2 exists under both Office of MAS and Office of
 * Non-MAS. Two identical entries in a dropdown are unusable, so the parent
 * disambiguates — but only where it is needed, because prefixing every name
 * would make the common case worse.
 *
 * @param {string} code
 * @returns {string}
 */
function hcOrgDisplayName(code) {
  var byCode = {};
  HC_REAL_ORGS.forEach(function (o) { byCode[o.c] = o; });

  var me = byCode[String(code || '').toUpperCase()];
  if (!me) return String(code || '');

  var sameName = HC_REAL_ORGS.filter(function (o) {
    return o.d === me.d && o.v === me.v;
  });
  if (sameName.length < 2) return me.d;

  var parent = byCode[me.p];
  return parent ? (parent.d + ' / ' + me.d) : me.d;
}

/**
 * Loads the 137 real org codes into HC_Orgs, REPLACING what is there.
 *
 * Positions are untouched — this is the org reference table, not the roster.
 * Run it once, then the roster editor accepts any real code and
 * validateHCData stops reporting sub-orgs as unmatched.
 *
 * Does NOT require force: HC_Orgs is reference data reconstructed from an
 * authoritative list, unlike HC_Positions, which holds hand-entered rows that
 * cannot be recovered. seedHCTestData guards positions for that reason.
 *
 * @returns {Object} { success, orgs, message }
 * @editor
 */
function loadRealOrgCodes() {
  try {
    if (!TRAVEL_DB_SPREADSHEET_ID) {
      return { success: false, error: 'TRAVEL_DB_SPREADSHEET_ID is not set.' };
    }
    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.HC_ORGS);
    if (!sheet) {
      return {
        success: false,
        error: SHEET_NAMES.HC_ORGS + ' not found. Run setupTravelDatabase() first.'
      };
    }

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_ORGS];
    var now = new Date();
    var actor = Session.getActiveUser().getEmail() || 'org-code-load';

    // Built by mapping over the schema headers, never by hand: writes are
    // positional (docs/DATA_DICTIONARY.md §3.9).
    var rows = hcRealOrgRecords().map(function (o) {
      var rec = {
        'Org_Code': o.orgCode,
        'Parent_Org_Code': o.parentOrgCode,
        'Org_Level': o.orgLevel,
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
      return headers.map(function (h) { return h in rec ? rec[h] : ''; });
    });

    var existing = Math.max(0, sheet.getLastRow() - 1);
    if (existing > 0) {
      sheet.getRange(2, 1, existing, headers.length).clearContent();
    }
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

    // The join reads a cached bundle; without this the new rows are invisible
    // until the cache expires.
    HC.hcCacheInvalidateAll();

    console.log('Loaded ' + rows.length + ' org codes into ' + SHEET_NAMES.HC_ORGS);
    return {
      success: true,
      orgs: rows.length,
      message: 'Loaded ' + rows.length + ' org codes. Reload the HR Roster page.'
    };
  } catch (e) {
    console.error('loadRealOrgCodes failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

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
 * Seeds both HC tabs with FICTIONAL test data.
 *
 * REPLACES the contents of HC_Positions and HC_Orgs — it does not merge. This
 * is seed data for an empty or test environment, and a merge would make the
 * result depend on whatever was already there, which is the opposite of what a
 * reproducible test fixture needs.
 *
 * DO NOT RUN THIS AGAINST AN ENVIRONMENT WITH A REAL ROSTER.
 * ---------------------------------------------------------
 * The 16 positions below are invented people — Marguerite Okonkwo, Desmond
 * Whitaker and so on, all @example.gov. They exist to exercise the supervisor
 * walk, the grade comparison and the org join without needing real HR data.
 *
 * They are also, until the roster is imported, what the per-capita budget
 * split, the public org chart and the supervisor-based site access gate all
 * read. @clolry: "please make sure that when we seed the HR roster that we
 * remove ALL test records and are relying only on the sheet identified in the
 * system properties."
 *
 * The real roster comes from 40_domain/HCRosterSync.importRoster, which reads
 * the FAS_HRLinks_Feed Script Property and removes these fixtures as part of
 * the import. THAT is the function to run on a real deployment; this one is
 * for a test environment only.
 *
 * TWO GUARDS, BECAUSE `force` IS NOT ENOUGH
 * -----------------------------------------
 * The existing `force` flag stops an accidental overwrite, but `force: true`
 * is exactly what someone types when they are determined, and it would then
 * replace a real 900-person roster with 16 fictional people — silently
 * revoking site access for every supervisor and skewing every budget
 * allocation.
 *
 * So this additionally REFUSES, even with force, when the existing rows look
 * real: non-@example.gov addresses, or more positions than the fixture holds.
 * Overwriting a real roster with test data has no legitimate use, and an
 * explicit refusal costs a minute while the alternative costs a day of
 * confusion about why nobody can sign in.
 *
 * @param {boolean} [force=false] overwrite existing FIXTURE rows
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

    // THE REAL-DATA REFUSAL, checked before `force` is consulted.
    //
    // Sampling the email column rather than counting rows, because the
    // decisive question is whether these are invented people. An
    // @example.gov address is RFC 2606 reserved and can never be a GSA
    // mailbox, so anything else is a real person.
    if (existingPositions > 0) {
      var emailCol = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_POSITIONS]
        .indexOf('Email_Address') + 1;
      var realLooking = 0;
      if (emailCol > 0) {
        var emails = posSheet
          .getRange(2, emailCol, existingPositions, 1).getValues();
        emails.forEach(function (r) {
          var e = String(r[0] || '').trim().toLowerCase();
          if (e && e.indexOf('@example.gov') === -1 &&
              e.indexOf('@example.com') === -1) {
            realLooking++;
          }
        });
      }

      if (realLooking > 0 || existingPositions > HC_SEED_POSITIONS.length) {
        return {
          success: false,
          aborted: true,
          error: 'REFUSED: ' + SHEET_NAMES.HC_POSITIONS + ' holds ' +
                 existingPositions + ' positions, ' + realLooking +
                 ' with real email addresses. This function would replace ' +
                 'them with ' + HC_SEED_POSITIONS.length + ' FICTIONAL test ' +
                 'people, revoking supervisor-based LETS access and skewing ' +
                 'every per-capita budget allocation. There is no `force` for ' +
                 'this. To reload the real roster, run importRoster() — it ' +
                 'reads the FAS_HRLinks_Feed property and removes test ' +
                 'records as part of the import.'
        };
      }
    }

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

    // Mirrors HC.resolveOrgByCode's longest-prefix rule. A different rule here
    // would report problems the join does not actually have, or miss ones it
    // does.
    function _resolveOrgCode_(code, known) {
      var c = String(code || '').trim().toUpperCase();
      if (!c) return null;
      if (known[c]) return c;
      var best = null;
      Object.keys(known).forEach(function (key) {
        if (c.indexOf(key) !== 0) return;
        if (best && key.length <= best.length) return;
        best = key;
      });
      return best;
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

      // 3 — org code that resolves to no HC_Orgs row, even by prefix.
      //
      // Codes are hierarchical: FCA0A sits under FCA under FC, and only the
      // four top-level codes carry a budget office key. So an unresolvable
      // code is one that matches no ancestor at all — a typo, not a sub-org.
      //
      // Does NOT list every known code. With @clolry's 137 real codes loaded
      // a full list makes the banner unreadable, and the roster page shows one
      // of these per bad row.
      if (pos.orgCode && !_resolveOrgCode_(pos.orgCode, orgCodes)) {
        var _tops = Object.keys(orgCodes).filter(function (k) { return k.length <= 3; }).sort();
        problems.push('Position ' + pos.positionNumber + ' has Org_Code "' + pos.orgCode +
                      '" which matches no known org code. Codes are hierarchical, so a ' +
                      'sub-org resolves to its parent — FCA0A attributes to FCA — but ' +
                      'this one matches none of ' +
                      (_tops.length ? _tops.join(', ') : 'the loaded codes') +
                      ', so business unit and sector will be blank. Fix the code in ' +
                      'HC_Positions, or add an HC_Orgs row if the org is genuinely new. ' +
                      '(' + Object.keys(orgCodes).length + ' codes loaded — run ' +
                      'loadRealOrgCodes() if that looks too few.)');
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
        // Resolve the position's code, so someone in FCA0A counts toward FCA.
        return _resolveOrgCode_(x.orgCode, orgCodes) === org.orgCode &&
               x.grade === '15' && x.occupancyStatus !== 'VACANT';
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

/**
 * Empties HC_Positions. Keeps HC_Orgs.
 *
 * @clolry: "Remove all data in the existing HC sheet - I added our team for
 * testing purposes."
 *
 * WHY A DEDICATED FUNCTION RATHER THAN LETTING THE IMPORT DO IT
 * ------------------------------------------------------------
 * importRoster already replaces every row, so this looks redundant. It is not,
 * for two reasons.
 *
 * First, runRosterImport REFUSES when the preview reports removals that are
 * not test data — 8 of @clolry's 24 rows are hand-entered team members with
 * real @gsa.gov addresses, so identifySeedRows correctly declines to treat
 * them as fixtures. That refusal is right in general: a real person silently
 * dropped from the roster loses supervisor-based LETS access. The answer is a
 * deliberate clear, not a weaker refusal.
 *
 * Second, clearing and importing are different decisions with different
 * evidence. Mixing them would mean the only way to discard test data is to run
 * a 1,046-row import, and the only way to see what was discarded is to read
 * the import's output afterwards.
 *
 * WHY HC_Orgs IS LEFT ALONE
 * -------------------------
 * HC_Orgs is REFERENCE data reconstructed from an authoritative list of 137 org
 * codes; HC_Positions is PEOPLE. Clearing the orgs here would be the
 * destructive mistake it would look like a convenience: the per-capita budget
 * split walks each position's parent chain to the nearest SERVICE_CENTER row in
 * HC_Orgs, so an empty HC_Orgs makes every allocation zero. loadRealOrgCodes
 * rebuilds it; this must not quietly undo that.
 *
 * WHAT IT PRINTS BEFORE DELETING
 * ------------------------------
 * Every row it is about to remove, named, with its org code and whether it
 * looks like a fixture. An admin running this on the wrong environment should
 * see 1,046 real names scroll past and stop, and the only way that is possible
 * is if the names are printed BEFORE the write rather than counted after it.
 *
 * @param {boolean} [confirm=false] must be true. The Run button passes no
 *        arguments, so a misclick in the editor lists the rows and stops.
 * @returns {Object} { success, removed, rows, message }
 * @editor
 */
function clearHCPositions(confirm) {
  // FAILS CLOSED. My first version read
  //   (typeof _hcAdminGuard_ === 'function') ? _hcAdminGuard_() : null
  // which SKIPS the admin check entirely if the guard is missing, and then
  // deletes every row in the roster. For a destructive function the absence
  // of a guard must mean "refuse", never "proceed unguarded".
  //
  // _hcAdminGuard_ lives in 40_domain/HCAdmin.js and Apps Script hoists
  // top-level declarations across every file, so it is present in practice.
  // That is exactly why the fail-open was invisible: it would never have
  // triggered until someone split the files differently.
  if (typeof _hcAdminGuard_ !== 'function') {
    return {
      success: false,
      error: 'The HR admin guard (_hcAdminGuard_, 40_domain/HCAdmin.js) is ' +
             'unavailable, so this cannot verify the caller is an ' +
             'administrator. Refusing to clear the roster.'
    };
  }
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  // Serialized against saveHCPosition and importRoster: both read the roster
  // to validate, and a concurrent clear would have them validate against a
  // half-empty table.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
  } catch (e) {
    return { success: false, error: 'Another HR edit is in progress. Try again in a moment.' };
  }

  try {
    if (!TRAVEL_DB_SPREADSHEET_ID) {
      return { success: false, error: 'TRAVEL_DB_SPREADSHEET_ID is not set.' };
    }

    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.HC_POSITIONS);
    if (!sheet) {
      return {
        success: false,
        error: SHEET_NAMES.HC_POSITIONS + ' tab not found. Run ' +
               'setupTravelDatabase() first.'
      };
    }

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_POSITIONS];
    var lastRow = sheet.getLastRow();
    var count = Math.max(0, lastRow - 1);

    if (!count) {
      console.log('clearHCPositions: ' + SHEET_NAMES.HC_POSITIONS +
                  ' is already empty.');
      return { success: true, removed: 0, rows: [], message: 'Already empty.' };
    }

    // Read and print BEFORE deciding, so a dry run is as informative as the
    // real one.
    var col = {};
    headers.forEach(function (h, i) { col[h] = i; });
    var data = sheet.getRange(2, 1, count, headers.length).getValues();

    var rows = data.map(function (r) {
      var email = String(r[col['Email_Address']] || '').trim().toLowerCase();
      return {
        positionNumber: String(r[col['Position_Number']] || '').trim(),
        employeeName: String(r[col['Employee_Name']] || '').trim(),
        orgCode: String(r[col['Org_Code']] || '').trim(),
        emailAddress: email,
        createdBy: String(r[col['Created_By']] || '').trim(),
        // Stated per row so the distinction @clolry hit — 16 fixtures and 8
        // hand-entered team members — is visible rather than inferred.
        looksLikeFixture: email.indexOf('@example.gov') > -1 ||
                          email.indexOf('@example.com') > -1 ||
                          String(r[col['Created_By']] || '').toLowerCase() === 'hc-seed'
      };
    });

    var fixtures = rows.filter(function (r) { return r.looksLikeFixture; }).length;

    console.log('=== clearHCPositions ===');
    console.log(count + ' row(s) in ' + SHEET_NAMES.HC_POSITIONS + ': ' +
                fixtures + ' fictional fixture(s), ' + (count - fixtures) +
                ' with real addresses.');
    console.log('');
    rows.forEach(function (r) {
      console.log('  ' + (r.looksLikeFixture ? '[fixture] ' : '[real]    ') +
                  (r.positionNumber || '(no PN)') + '  ' +
                  (r.employeeName || '(no name)') + '  ' +
                  (r.orgCode || '(no org)') +
                  (r.emailAddress ? ('  ' + r.emailAddress) : ''));
    });
    console.log('');

    if (confirm !== true) {
      // NOT AN ERROR. The Run button passes no arguments, so this is the
      // expected first outcome: it lists what would go and stops. Returning
      // success:false would make a correct dry run look like a failure.
      console.log('NOTHING REMOVED — this was a dry run.');
      console.log('To remove all ' + count + ' row(s), call ' +
                  'clearHCPositions(true) from a wrapper, or run ' +
                  'runClearHCPositions() in 99_triggers/Diagnostics.js.');
      return {
        success: true, removed: 0, rows: rows, dryRun: true,
        message: count + ' row(s) listed above. Nothing removed.'
      };
    }

    sheet.getRange(2, 1, count, headers.length).clearContent();

    // The HC bundle is cached for six hours. Without this the access gate, the
    // org chart and the budget dashboard all keep serving the rows that were
    // just deleted, and an admin reasonably concludes the clear did nothing.
    try { new TravelDB().invalidate(SHEET_NAMES.HC_POSITIONS); } catch (e) { /* non-fatal */ }
    try { HC.hcCacheInvalidateAll(); } catch (e) { /* non-fatal */ }

    console.log('REMOVED ' + count + ' row(s). HC_Orgs was not touched.');
    console.log('Next: runRosterPreview() then runRosterImport() in ' +
                '99_triggers/Diagnostics.js.');

    return {
      success: true, removed: count, rows: rows, dryRun: false,
      message: 'Removed ' + count + ' position(s). HC_Orgs untouched.'
    };
  } catch (error) {
    console.error('clearHCPositions failed: ' + error.message);
    return { success: false, error: error.message };
  } finally {
    try { lock.releaseLock(); } catch (e) { /* already released */ }
  }
}
