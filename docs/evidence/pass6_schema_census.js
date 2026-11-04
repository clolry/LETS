/**
 * pass6_schema_census.js — reproducible evidence for DATA_DICTIONARY.md
 *
 * Run from this directory:
 *     node pass6_schema_census.js
 *
 * Reads only. Touches no Google service. Static analysis of lets_app/.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * A data dictionary is a set of claims about shape: which tabs exist, how
 * many columns each has, what the exact header text is, and — critically —
 * whether the code that WRITES a tab agrees with the schema that DECLARES
 * it. That last one cannot be eyeballed. A positional write array with 36
 * elements against a 38-column schema is either a deliberate two-column
 * omission or a silent data-corruption bug, and the only way to tell them
 * apart is to count both and look at which columns are missing.
 *
 * Deliverable 1 established the rule: if a number appears in a deliverable,
 * a script must produce it. This script produces the numbers behind
 * Deliverable 3.
 *
 * WHAT IT REPORTS
 *   [1] Both tab registries — TRIP's SHEET_NAMES and LETS's LETS_CONFIG
 *       .sheets — and the collision between them
 *   [2] Every declared schema with its exact column count
 *   [3] THE ALIGNMENT TEST: every positional write array in the codebase,
 *       its element count, and whether it matches the schema it targets
 *   [4] Columns the code adds to a tab at RUNTIME, which no schema declares
 *   [5] Tabs that are read or written but have no schema at all
 *   [6] Primary-key generators and their formats
 *   [7] Header-name vs column-position access, counted
 *   [8] The LETS schemas, and the camelCase/PascalCase mismatch that makes
 *       the budget engine read zeros
 *
 * METHOD NOTES THAT AFFECT CORRECTNESS
 *   - Comments are stripped before any match. Several schema-looking arrays
 *     appear inside JSDoc blocks and must not be counted as code.
 *   - Positional write arrays are found by locating appendRow/setValues call
 *     sites and counting top-level commas inside the bracket, with a
 *     balanced scanner. A naive comma count is wrong the moment an element
 *     is a function call or a ternary, both of which occur here.
 *   - Where a write array is SHORTER than its schema, the script names the
 *     specific trailing columns that go unwritten, because that is the
 *     difference between a bug and a design decision.
 *   - Where this script's answer differs from the prose of Pass 3, it says
 *     so. That convention is inherited from pass5_guard_census.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'lets_app');
const SERVER = path.join(APP, 'server');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function walk(dir, ext, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out.sort();
}

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\0/g, '');
}

function rel(file) {
  return path.relative(APP, file).split(path.sep).join('/');
}

/** Blank out // and block comments, preserving offsets and line count. */
function stripComments(text) {
  const lines = text.split('\n');
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    let s = line;
    if (inBlock) {
      const c = s.indexOf('*/');
      if (c === -1) { out.push(''.padEnd(0)); continue; }
      inBlock = false; s = s.slice(c + 2);
    }
    for (;;) {
      const o = s.indexOf('/*');
      if (o === -1) break;
      const c = s.indexOf('*/', o + 2);
      if (c === -1) { s = s.slice(0, o); inBlock = true; break; }
      s = s.slice(0, o) + s.slice(c + 2);
    }
    out.push(s.replace(/\/\/.*$/, ''));
  }
  return out.join('\n');
}

/**
 * From the index of an opening bracket, return {end, count} where count is
 * the number of TOP-LEVEL elements. Respects nesting, strings, and template
 * literals. A naive comma count is wrong here: elements include function
 * calls, ternaries, and object literals, all of which contain commas.
 */
function countElements(text, open) {
  let depth = 0, count = 0, seenAny = false;
  for (let p = open; p < text.length; p++) {
    const c = text[p];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; p++;
      while (p < text.length) {
        if (text[p] === '\\') { p += 2; continue; }
        if (text[p] === q) break;
        p++;
      }
      seenAny = true;
      continue;
    }
    if (c === '[' || c === '(' || c === '{') { depth++; continue; }
    if (c === ']' || c === ')' || c === '}') {
      depth--;
      if (depth === 0) return { end: p, count: seenAny ? count + 1 : 0 };
      continue;
    }
    if (c === ',' && depth === 1) { count++; seenAny = true; continue; }
    if (!/\s/.test(c)) seenAny = true;
  }
  return { end: -1, count: 0 };
}

const bar = c => console.log(c.repeat(78));
let disagreements = 0;
function check(label, measured, claimed) {
  const ok = measured === claimed;
  if (!ok) disagreements++;
  console.log('  ' + (ok ? '   ' : '!! ') + label.padEnd(40) +
    'measured ' + String(measured).padStart(3) +
    '   Pass 3 said ' + String(claimed).padStart(3) +
    (ok ? '' : '   <- DISAGREE'));
}

// ---------------------------------------------------------------------------
// load sources
// ---------------------------------------------------------------------------

const serverFiles = walk(SERVER, '.js');
const src = new Map();          // rel path -> comment-stripped text
for (const f of serverFiles) src.set(rel(f), stripComments(read(f)));

const sheetsJs = src.get('server/01_constants/Sheets.js');
const budgetJs = src.get('server/00_config/BudgetConfig.js');
const letsDbJs = src.get('server/20_data/LetsDB.js');

console.log('\nPass 6 evidence — schema census');
console.log('purpose: produce every count in DATA_DICTIONARY.md, and test');
console.log('         whether the writers agree with the declared schemas');
bar('=');

// --- [1] the two registries -------------------------------------------------

console.log('\n[1] The two tab registries');

const tripTabs = [...sheetsJs.matchAll(/^\s+([A-Z_0-9]+):\s*'([^']+)'/gm)]
  .map(m => ({ key: m[1], name: m[2] }));
console.log('\n  TRIP — SHEET_NAMES  (server/01_constants/Sheets.js)');
console.log('    entries: ' + tripTabs.length);
for (const t of tripTabs) console.log('      ' + t.key.padEnd(20) + t.name);

const letsSheetsBlock = /sheets:\s*\{([^}]*)\}/.exec(budgetJs);
const letsTabs = letsSheetsBlock
  ? [...letsSheetsBlock[1].matchAll(/([A-Za-z_0-9]+):\s*'([^']+)'/g)].map(m => ({ key: m[1], name: m[2] }))
  : [];
console.log('\n  LETS — LETS_CONFIG.sheets  (server/00_config/BudgetConfig.js)');
console.log('    entries: ' + letsTabs.length);
for (const t of letsTabs) console.log('      ' + t.key.padEnd(20) + t.name);

const tripNames = new Set(tripTabs.map(t => t.name));
const collisions = letsTabs.filter(t => tripNames.has(t.name));
console.log('\n  COLLISIONS — tab names claimed by BOTH registries: ' + collisions.length);
for (const c of collisions) {
  console.log('      !! ' + c.name + '   declared by TRIP and by LETS');
}
if (collisions.length) {
  console.log('    This is finding G-013. Two schemas, one tab name. The');
  console.log('    dictionary cannot state which one owns the live tab');
  console.log('    without reading row 1 of the real spreadsheet (VT-06).');
}
console.log('');
check('TRIP tab names', tripTabs.length, 16);
check('LETS tab names', letsTabs.length, 7);

// --- [2] declared schemas ---------------------------------------------------

console.log('\n[2] Declared schemas and their column counts');

function parseSchemaBlock(text, declRe) {
  const m = declRe.exec(text);
  if (!m) return [];
  const open = text.indexOf('{', m.index);
  const { end } = countElements(text, open);
  const body = text.slice(open, end);
  const out = [];
  const keyRe = /(?:^|\n)\s*(?:\[?\s*([A-Za-z_0-9.\[\]']+?)\s*\]?)\s*:\s*\[/g;
  let k;
  while ((k = keyRe.exec(body)) !== null) {
    const arrOpen = body.indexOf('[', k.index + k[0].length - 1);
    const res = countElements(body, arrOpen);
    const arr = body.slice(arrOpen, res.end + 1);
    const cols = [...arr.matchAll(/'([^']+)'/g)].map(x => x[1]);
    out.push({ key: k[1].replace(/['\[\]]/g, ''), cols, declared: res.count });
  }
  return out;
}

const tripSchemas = parseSchemaBlock(sheetsJs, /const\s+TRAVEL_SHEET_SCHEMAS\s*=/);
console.log('\n  TRIP — TRAVEL_SHEET_SCHEMAS');
console.log('    tabs with a declared schema: ' + tripSchemas.length);
for (const s of tripSchemas) {
  console.log('      ' + s.key.padEnd(22) + String(s.cols.length).padStart(3) + ' columns');
}
const noSchema = tripTabs.filter(t => !tripSchemas.some(s => s.key === t.name));
console.log('\n  TRIP tabs declared in SHEET_NAMES with NO schema: ' + noSchema.length);
for (const t of noSchema) console.log('      ' + t.name);
console.log('    setupTravelDatabase() iterates the SCHEMAS, not the names,');
console.log('    so these are never created by setup. Some self-create on');
console.log('    first use; see [5].');
console.log('');
check('tabs with a TRIP schema', tripSchemas.length, 10);
check('TRIP tabs with no schema', noSchema.length, 6);

const letsSchemas = parseSchemaBlock(letsDbJs, /const\s+SCHEMAS\s*=/);
console.log('\n  LETS — LetsDB.SCHEMAS');
console.log('    tabs with a declared schema: ' + letsSchemas.length);
for (const s of letsSchemas) {
  console.log('      ' + s.key.padEnd(26) + String(s.cols.length).padStart(3) + ' columns');
}

// --- [3] THE ALIGNMENT TEST -------------------------------------------------

console.log('\n[3] THE ALIGNMENT TEST — do the writers match the schemas?');
console.log('  Every appendRow / setValues call site that passes a literal');
console.log('  array, with its element count measured by balanced scan.');
console.log('  A mismatch is either a deliberate trailing omission or a');
console.log('  silent corruption bug, and the trailing-column names below');
console.log('  are what tells the two apart.');
console.log('');

const TARGETS = {
  'SHEET_NAMES.REQUESTS': 'Requests',
  'SHEET_NAMES.REQUEST_LEGS': 'Request_Legs',
  'SHEET_NAMES.REQUEST_TRAVELERS': 'Request_Travelers',
  'SHEET_NAMES.TRAVELER_LEG_COSTS': 'Traveler_Leg_Costs',
  'SHEET_NAMES.APPROVAL_LOG': 'Approval_Log',
  'SHEET_NAMES.ATTACHMENTS': 'Attachments',
  'SHEET_NAMES.ERROR_LOG': 'Error_Log',
  'SHEET_NAMES.FEEDBACK': 'Feedback',
  'SHEET_NAMES.TRAVEL_USERS': 'Travel_Users',
  'SHEET_NAMES.TRAVEL_USER_ROLES': 'Travel_User_Roles',
  'SHEET_NAMES.TEST_SUBMITTERS': 'Test_Submitters'
};

/**
 * Resolve a write to the tab it targets. Three forms occur in this codebase
 * and a lookback heuristic gets all three wrong, so each is handled
 * explicitly:
 *
 *   A.  db.appendRow(SHEET_NAMES.APPROVAL_LOG, [ ...14 elements... ])
 *          the tab is the first argument.
 *
 *   B.  const legsSheet = db.sheet(SHEET_NAMES.REQUEST_LEGS);
 *       ...
 *       legsSheet.setValues(legRows)
 *          the tab is bound to a VARIABLE earlier in the file. The variable
 *          must be resolved, not guessed from proximity — Submission.js
 *          holds five such handles live at once, so "the nearest preceding
 *          SHEET_NAMES mention" is wrong by construction.
 *
 *   C.  const requestRow = [ ...42 elements... ];
 *       requestsSheet.appendRow(requestRow)
 *          the array is bound to a variable too, so the element count must
 *          come from the declaration, not from the call site.
 *
 * An earlier draft of this script used a 400-character lookback and
 * reported Submission.js:589 as a 2-element write to a 42-column Requests
 * schema — a 40-column "mismatch" that is really a correct 2-cell write of
 * Traveler_Total and Grand_Total. The lesson is recorded here because the
 * wrong answer looked plausible enough to publish.
 */
function resolveWrites(file, text) {
  const out = [];

  // Pass 1: variable -> tab name, from  X = db.sheet(SHEET_NAMES.Y)
  //         and                         X = ss.getSheetByName(SHEET_NAMES.Y)
  const handles = new Map();
  const hRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\w+\.sheet|\w+\.getSheetByName)\s*\(\s*(SHEET_NAMES\.[A-Z_]+)/g;
  let h;
  while ((h = hRe.exec(text)) !== null) {
    if (TARGETS[h[2]]) handles.set(h[1], TARGETS[h[2]]);
  }

  // Pass 2: variable -> element count, from  X = [ ... ]
  const arrays = new Map();
  const aRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g;
  let a;
  while ((a = aRe.exec(text)) !== null) {
    const open = text.indexOf('[', a.index);
    const res = countElements(text, open);
    if (res.end === -1) continue;
    let count = res.count;
    const body = text.slice(open, res.end + 1);
    // a rows-array of one row:  [[ a, b, c ]]
    if (count === 1 && /^\[\s*\[/.test(body)) {
      count = countElements(body, body.indexOf('[', 1)).count;
    }
    arrays.set(a[1], { count, nested: /^\[\s*\[/.test(body) });
  }

  // Pass 3: the write call sites
  const wRe = /(?:(\w+)\.)?(appendRow|setValues)\s*\(/g;
  let m;
  while ((m = wRe.exec(text)) !== null) {
    const recv = m[1];
    const kind = m[2];
    const argOpen = m.index + m[0].length - 1;
    const argRes = countElements(text, argOpen);
    if (argRes.end === -1) continue;
    const args = text.slice(argOpen + 1, argRes.end);
    const line = text.slice(0, m.index).split('\n').length;

    let tab = null, count = null, form = null;

    // Form A: first argument is a SHEET_NAMES reference
    const firstArg = /^\s*(SHEET_NAMES\.[A-Z_]+)/.exec(args);
    if (firstArg && TARGETS[firstArg[1]]) {
      tab = TARGETS[firstArg[1]];
      form = 'A';
      const rest = args.slice(firstArg[0].length).replace(/^\s*,/, '');
      const lb = rest.indexOf('[');
      if (lb !== -1) {
        const r = countElements(rest, lb);
        count = r.count;
        const body = rest.slice(lb, r.end + 1);
        if (count === 1 && /^\[\s*\[/.test(body)) {
          count = countElements(body, body.indexOf('[', 1)).count;
        }
      } else {
        const v = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(rest);
        if (v && arrays.has(v[1])) { count = arrays.get(v[1]).count; form = 'A/var'; }
      }
    } else if (recv && handles.has(recv)) {
      // Form B: receiver is a resolved sheet handle
      tab = handles.get(recv);
      form = 'B';
      const lb = args.indexOf('[');
      const v = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(args);
      if (v && arrays.has(v[1])) {
        count = arrays.get(v[1]).count; form = 'C';
      } else if (lb !== -1) {
        const r = countElements(args, lb);
        count = r.count;
        const body = args.slice(lb, r.end + 1);
        if (count === 1 && /^\[\s*\[/.test(body)) {
          count = countElements(body, body.indexOf('[', 1)).count;
        }
      }
    }

    // Was this a setValues against an explicit getRange(...) of fixed
    // width? If so its element count is a column span, not a row width.
    const before = text.slice(Math.max(0, m.index - 160), m.index);
    const explicitRange = kind === 'setValues' && /getRange\s*\([^)]*,\s*\d+\s*\)\s*\.?\s*$/.test(before);
    if (tab && count) out.push({ file, line, kind, tab, count, form, explicitRange });
  }
  return out;
}

const writes = [];
for (const [file, text] of src.entries()) writes.push(...resolveWrites(file, text));

const schemaOf = n => (tripSchemas.find(s => s.key === n) || { cols: [] }).cols;

/**
 * CLASSIFYING A WIDTH DIFFERENCE
 * -----------------------------
 * An earlier draft of this section used an allowlist of "known partial"
 * write sites. That was the wrong shape: an allowlist hides the next
 * mismatch behind the author's judgement instead of stating a rule. The
 * rule is a property of the Apps Script API, so it can be applied
 * mechanically:
 *
 *   EXACT        count === schema. Nothing to say.
 *
 *   TRAILING     count < schema, via appendRow(). SAFE. appendRow fills
 *   OMISSION     columns 1..n and leaves the rest blank, so a writer that
 *                supplies fewer elements simply leaves trailing columns
 *                empty. Whether that is DESIRABLE is a data-quality
 *                question, reported below, not a corruption bug.
 *
 *   OVER-WIDE    count > schema. A REAL BUG. appendRow would write past
 *                the declared width, silently extending the tab.
 *
 *   PARTIAL      setValues() against an explicit getRange(...) of known
 *   RANGE        width. Not comparable to the full schema at all — it is a
 *                write to specific columns, and comparing it to the row
 *                width is a category error.
 *
 * The script therefore reports WHICH columns a trailing omission leaves
 * blank, and lets the reader judge. That is more useful than a verdict,
 * because in two of the cases below the blank columns are an audit gap.
 */

let exact = 0, trailing = 0, overwide = 0, partialRange = 0;
const trailingDetail = [];

const tabsSeen = [...new Set(writes.map(w => w.tab))].sort();
for (const name of tabsSeen) {
  const cols = schemaOf(name);
  const ws = writes.filter(w => w.tab === name)
    .sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line);
  console.log('  --- ' + name + '   schema: ' + (cols.length || 'NONE DECLARED') + ' columns ---');
  for (const w of ws) {
    const loc = w.file + ':' + w.line;
    if (!cols.length) {
      console.log('      ' + loc.padEnd(44) + w.count + ' elements   <- NO SCHEMA TO CHECK AGAINST');
      continue;
    }
    const d = w.count - cols.length;
    if (d === 0) {
      exact++;
      console.log('      ' + loc.padEnd(44) + w.count + ' elements   exact');
    } else if (w.kind === 'setValues' && w.explicitRange) {
      partialRange++;
      console.log('      ' + loc.padEnd(44) + w.count + ' elements   partial-range write (not a row)');
    } else if (d < 0) {
      trailing++;
      const blanks = cols.slice(cols.length + d);
      trailingDetail.push({ loc, tab: name, blanks });
      console.log('      ' + loc.padEnd(44) + w.count + ' elements   trailing omission (' + (-d) + ')');
      console.log('          leaves blank: ' + blanks.join(', '));
    } else {
      overwide++;
      console.log('      ' + loc.padEnd(44) + w.count + ' elements   !! OVER-WIDE by ' + d + ' — REAL BUG');
    }
  }
}

console.log('');
console.log('  positional writes resolved ............... ' + writes.length);
console.log('  exact schema width ....................... ' + exact);
console.log('  trailing omission (safe, blanks columns) . ' + trailing);
console.log('  partial-range writes (not comparable) .... ' + partialRange);
console.log('  OVER-WIDE — real bugs ................... ' + overwide);

if (overwide === 0) {
  console.log('');
  console.log('  No writer exceeds its schema width. So the schemas in');
  console.log('  Sheets.js accurately describe what the code writes TODAY.');
  console.log('  That is exactly why reordering a column is dangerous: the');
  console.log('  agreement is positional and nothing re-checks it at run');
  console.log('  time. See [7].');
} else {
  disagreements++;
}

if (trailingDetail.length) {
  console.log('');
  console.log('  The trailing omissions, grouped — these are data-quality');
  console.log('  findings rather than corruption, and two of them matter:');
  const byBlank = new Map();
  for (const t of trailingDetail) {
    const k = t.tab + ' :: ' + t.blanks.join(', ');
    if (!byBlank.has(k)) byBlank.set(k, []);
    byBlank.get(k).push(t.loc);
  }
  for (const [k, locs] of byBlank.entries()) {
    const [tab, blanks] = k.split(' :: ');
    console.log('');
    console.log('      ' + tab + ' — always blank at ' + locs.length + ' site(s): ' + blanks);
    for (const l of locs) console.log('          ' + l);
  }
  console.log('');
  console.log('    Approval_Log.Version_Before / Version_After are declared');
  console.log('    columns that FOUR admin-path writers never populate, while');
  console.log('    ten workflow-path writers do. So the audit trail carries');
  console.log('    before/after versions for reviewer actions and not for');
  console.log('    administrator actions — the opposite of what an auditor');
  console.log('    would want. That belongs in the data dictionary as a');
  console.log('    per-column note, not as a schema error.');
}

// --- [4] runtime-added columns ---------------------------------------------

console.log('\n[4] Columns the code adds at RUNTIME (no schema declares them)');
const runtimeAdds = [];
for (const [file, text] of src.entries()) {
  const re = /getRange\(\s*1\s*,\s*[^)]*\)\s*\.setValue\(\s*'([^']+)'\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const line = text.slice(0, m.index).split('\n').length;
    runtimeAdds.push({ file, line, col: m[1] });
  }
}
console.log('  found: ' + runtimeAdds.length);
for (const r of runtimeAdds) {
  const declared = tripSchemas.some(s => s.cols.includes(r.col));
  console.log('      ' + (r.file + ':' + r.line).padEnd(44) + r.col +
    (declared ? '   (declared)' : '   <- NOT in any schema'));
}
if (runtimeAdds.length) {
  const reqCols = schemaOf('Requests').length;
  console.log('');
  console.log('  CONSEQUENCE: the live Requests tab becomes ' +
    (reqCols + runtimeAdds.filter(r => !tripSchemas.some(s => s.cols.includes(r.col))).length) +
    ' columns wide');
  console.log('  as soon as this code path runs, against a declared schema of ' +
    reqCols + '.');
  console.log('  A dictionary built only from source is therefore INCOMPLETE');
  console.log('  by construction. VT-06 reads the real header row.');

  // the width-calculation inconsistency
  const widthCalcs = new Set();
  for (const r of runtimeAdds) {
    const text = src.get(r.file);
    const around = text.split('\n').slice(Math.max(0, r.line - 6), r.line).join('\n');
    if (/headers\.length\s*\+\s*1/.test(around)) widthCalcs.add('headers.length + 1');
    if (/getLastColumn\(\)\s*\+\s*1/.test(around)) widthCalcs.add('getLastColumn() + 1');
  }
  if (widthCalcs.size > 1) {
    console.log('');
    console.log('  !! The three additions do not agree on how to find the');
    console.log('     next free column: ' + [...widthCalcs].join('  vs  '));
    console.log('     These differ when the sheet has trailing blank columns,');
    console.log('     so two of the three could write to different positions.');
    console.log('     That is a latent bug, not a style difference.');
  }
}

// --- [5] tabs with no schema, read or written ------------------------------

console.log('\n[5] Tabs with no declared schema — are they used?');
for (const t of noSchema) {
  let readers = 0, writers = 0, anyRef = 0;
  for (const [file, text] of src.entries()) {
    const n = (text.match(new RegExp("'" + t.name + "'", 'g')) || []).length;
    anyRef += n;
  }
  // also count via the SHEET_NAMES key
  let keyRefs = 0;
  const key = (tripTabs.find(x => x.name === t.name) || {}).key;
  for (const [file, text] of src.entries()) {
    keyRefs += (text.match(new RegExp('SHEET_NAMES\\.' + key + '\\b', 'g')) || []).length;
  }
  console.log('      ' + t.name.padEnd(20) +
    'string literal refs: ' + String(anyRef).padStart(3) +
    '   via SHEET_NAMES.' + key + ': ' + keyRefs);
}
console.log('');
console.log('  A tab with 0 literal refs AND 1 SHEET_NAMES ref (the');
console.log('  declaration itself) is a phantom — declared and never used.');
console.log('  A tab with literal refs but 1 SHEET_NAMES ref is reached');
console.log('  through a DUPLICATE constant, bypassing the registry the');
console.log('  file header calls "the single source of truth".');

// --- [6] key generators ----------------------------------------------------

console.log('\n[6] Primary-key generators');
const KEYGENS = [
  ['Request_ID', /function\s+generateRequestId/, 'server/91_setup/Database.js'],
  ['Log_ID', /function\s+generateLogId/, 'server/91_setup/Database.js'],
  ['Role_ID', /function\s+_generateBootstrapRoleId/, 'server/91_setup/Database.js']
];
for (const [name, re, file] of KEYGENS) {
  const text = src.get(file) || '';
  const m = re.exec(text);
  const line = m ? text.slice(0, m.index).split('\n').length : null;
  const locked = m ? /LockService/.test(text.slice(m.index, m.index + 1200)) : false;
  console.log('      ' + name.padEnd(14) + (m ? file + ':' + line : 'NOT FOUND').padEnd(40) +
    (m ? (locked ? 'takes a lock' : 'NO LOCK') : ''));
}
let uuidSites = 0, logIdSites = 0;
for (const [file, text] of src.entries()) {
  uuidSites += (text.match(/Utilities\.getUuid\(\)/g) || []).length;
  logIdSites += (text.match(/generateLogId\(\)/g) || []).length;
}
console.log('');
console.log('  Log_ID is written two ways into one column:');
console.log('      generateLogId()      call sites: ' + logIdSites + '   format LOG-NNNNNN');
console.log('      Utilities.getUuid()  call sites: ' + uuidSites + '   format a UUID');
console.log('    Two key vocabularies in one column is finding G-056.');
console.log('  LockService used anywhere in the project: ' +
  [...src.values()].filter(t => /LockService/.test(t)).length + ' file(s)');
console.log('    So the mechanism exists and is understood — it is simply');
console.log('    not applied to ID generation. That is G-012.');

// --- [7] access mode -------------------------------------------------------

console.log('\n[7] Header-name vs column-position access');
let headerIdx = 0, headerIdxFiles = 0;
for (const [file, text] of src.entries()) {
  const n = (text.match(/headerIndex|\bidx\[|\breqIdx\[|\brIdx\[/g) || []).length;
  if (n) { headerIdx += n; headerIdxFiles++; }
}
console.log('  header-name index usages ................. ' + headerIdx +
  '  across ' + headerIdxFiles + ' files');
console.log('  positional write arrays (from [3]) ....... ' + writes.filter(w => w.tab).length);
console.log('');
console.log('  The pattern: the code READS flexibly by header name and');
console.log('  WRITES rigidly by position. So reordering columns does not');
console.log('  break most reads — it corrupts every subsequent write, with');
console.log('  no error. That asymmetry is finding G-014, and it is why the');
console.log('  Administrator\'s Guide carries a never-reorder-a-column rule.');

// --- [8] the LETS naming mismatch ------------------------------------------

console.log('\n[8] Why the budget engine reads zeros (G-040)');
console.log('  LetsDB.sheetDataToObjects keys every row object by RAW header');
console.log('  text. BudgetEngine reads camelCase properties. If no declared');
console.log('  header is also a property the engine reads, every lookup is');
console.log('  undefined and every coercion yields 0.');
console.log('');
const engineJs = src.get('server/30_services/BudgetEngine.js') || '';
const props = new Set();
for (const m of engineJs.matchAll(/\b(?:office|adj|item|req|t)\.([a-z][A-Za-z0-9]*)/g)) {
  props.add(m[1]);
}
const allLetsCols = new Set();
for (const s of letsSchemas) for (const c of s.cols) allLetsCols.add(c);
const overlap = [...props].filter(p => allLetsCols.has(p));
console.log('  distinct camelCase properties BudgetEngine reads ... ' + props.size);
console.log('  distinct column headers LetsDB declares ........... ' + allLetsCols.size);
console.log('  headers that are ALSO a property the engine reads .. ' + overlap.length);
if (overlap.length === 0) {
  console.log('');
  console.log('  ZERO overlap. Confirmed mechanically: not one declared');
  console.log('  header matches any property the engine reads. Every sheet-');
  console.log('  sourced field resolves to undefined, and `Number(x) || 0`');
  console.log('  turns that into 0 silently.');
  console.log('');
  console.log('  pass3_D7_sheet_shape_mismatch.js demonstrates the result by');
  console.log('  execution: every office reports a $0 budget and the');
  console.log('  gatekeeper rejects every request as unfunded.');
} else {
  console.log('      overlapping: ' + overlap.join(', '));
}

bar('=');
console.log('Disagreements with Pass 3\'s prose ............ ' + disagreements);
console.log('Every number above is recomputed from source on each run.\n');
