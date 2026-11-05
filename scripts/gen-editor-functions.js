#!/usr/bin/env node
/**
 * Generates docs/EDITOR_FUNCTIONS.md — the index of every function meant to be
 * run by hand from the Apps Script editor, with the file and line to find it.
 *
 * WHY THIS IS GENERATED AND NOT WRITTEN
 * -------------------------------------
 * @clolry: "when you tell me to run a function, please tell me which file it's
 * in - there are over 100 and so it's a lot to look through."
 *
 * There are 606 top-level functions across 60-odd server files, 68 of them
 * tagged @editor. A hand-maintained list would be wrong within a week — and a
 * stale index is worse than none, because it sends someone to a file that no
 * longer holds the function and they conclude the function is gone.
 *
 * So it is derived from the source and CI fails if the committed copy is out
 * of date. The guard is the point: without it this file becomes a lie on the
 * first refactor.
 *
 * WHAT COUNTS AS AN EDITOR FUNCTION
 * ---------------------------------
 * The @editor tag in the JSDoc block immediately above a top-level `function`
 * declaration. @client functions are reachable from the browser via
 * google.script.run and @server ones are internal; neither is something to
 * select from the editor's dropdown, and listing all 606 would recreate the
 * problem this solves.
 *
 * Run: node scripts/gen-editor-functions.js
 *      node scripts/gen-editor-functions.js --check   (CI: exit 1 if stale)
 */

const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join('lets_app', 'server');
const OUT = path.join('docs', 'EDITOR_FUNCTIONS.md');

/**
 * Groups, in the order a reader needs them rather than alphabetically.
 *
 * Keyed by a predicate on the file path. The first match wins, so the order of
 * this array is load-bearing.
 */
const GROUPS = [
  {
    title: 'Setting up — run once, in this order',
    note: 'A new or rebuilt environment needs these, in sequence. ' +
          '`setupTravelDatabase` creates every tab; nothing else works until ' +
          'it has run.',
    match: (f, n) => /91_setup\/Database\.js/.test(f) ||
                     n === 'hcLoadRealOrgCodes' || n === 'loadRealOrgCodes'
  },
  {
    title: 'HR roster — the FAS HRLinks feed',
    note: 'The roster drives approval routing, supervisor-based site access ' +
          'and every per-capita budget figure. Run the diagnostic first if ' +
          'anything is unexpected: it reports which code version is actually ' +
          'deployed.',
    match: (f) => /HCRosterSync\.js|HCSeed\.js/.test(f)
  },
  {
    title: 'Email address corrections',
    note: 'The HR feed is authoritative — measured coverage is 821 of 821 ' +
          'named rows — so these are for the exception. An override is the ' +
          'ONLY correction that survives the next import: a hand edit to ' +
          'HC_Positions is cleared and rewritten by importRoster.',
    match: (f) => /EmailOverrides\.js/.test(f)
  },
  {
    title: 'Budget',
    match: (f) => /BudgetAdmin\.js|BudgetBackfill\.js|SetAsideRelease\.js|BudgetDashboard\.js/.test(f)
  },
  {
    title: 'Reference data syncs and their triggers',
    note: 'Per diem rates and GSA City Pair airfares. Each ' +
          '`install…Trigger` removes its own prior trigger first, so running ' +
          'one twice does not create two schedules.',
    match: (f) => /CityPairSync\.js|PerDiemSync\.js|PerDiemGSA\.js/.test(f)
  },
  {
    // MUST PRECEDE the Diagnostics group below. These live in Diagnostics.js
    // but one of them WRITES, and the Diagnostics heading promises they do
    // not.
    // A generated document that makes a false safety claim is worse than one
    // that is merely incomplete — someone runs `runRosterImport` believing
    // the heading.
    title: 'Editor runners — wrappers for functions that take arguments',
    note: 'The Apps Script Run button passes no arguments, so these wrap the ' +
          'functions that need them. **`runRosterImport` WRITES DATA.** The ' +
          'others write nothing. Each wrapper prints its result, because a ' +
          'value returned to the Run button is never displayed.',
    match: (f, n) => /Diagnostics\.js/.test(f) && /^run[A-Z]/.test(n)
  },
  {
    title: 'Diagnostics — safe to run any time, write nothing',
    note: 'Start with `diagAll`. These read and report; none of them change data.',
    match: (f) => /Diagnostics\.js/.test(f)
  },
  {
    title: 'Cache warming and adoption checks',
    note: 'Mostly internal verification used while refactoring. ' +
          '`forceRefreshHCStaffingBundle` is the one worth knowing: it ' +
          'rebuilds the HC cache after a roster change.',
    match: (f) => /CacheWarming\.js/.test(f)
  },
  {
    title: 'Testing and routing simulation',
    note: 'Simulations do not submit anything. The FAS tracker test functions ' +
          'DO write a row — read their comments before running them.',
    match: (f) => /Submission\.js|FASTrackerTest\.js/.test(f)
  },
  { title: 'Everything else', match: () => true }
];

/** Extracts @editor-tagged top-level functions from one file. */
function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const m = /^function\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/.exec(lines[i]);
    if (!m) continue;

    // The JSDoc block must end on the line directly above. A blank line
    // between the comment and the declaration means the comment belongs to
    // something else, and claiming otherwise would mis-tag functions.
    let j = i - 1;
    if (j < 0 || lines[j].trim() !== '*/') continue;
    let k = j;
    while (k >= 0 && !lines[k].trim().startsWith('/**')) k--;
    if (k < 0) continue;

    const block = lines.slice(k, j + 1).join('\n');
    if (!/@editor\b/.test(block)) continue;

    // The first prose line of the block is the summary. Tags and separator
    // rules are skipped so the summary is a sentence, not '----'.
    let summary = '';
    for (const raw of lines.slice(k + 1, j)) {
      const t = raw.replace(/^\s*\*\s?/, '').trim();
      if (!t || t.startsWith('@') || /^[-=]{3,}$/.test(t)) continue;
      summary = t;
      break;
    }

    out.push({
      name: m[1],
      args: m[2].trim(),
      file: file.split(path.sep).join('/'),
      line: i + 1,
      summary: summary.replace(/\|/g, '\\|')
    });
  }
  return out;
}

function walk(dir, acc = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  });
  return acc;
}

function render(fns) {
  const byGroup = GROUPS.map((g) => ({ group: g, items: [] }));
  fns.forEach((fn) => {
    for (let i = 0; i < GROUPS.length; i++) {
      if (GROUPS[i].match(fn.file, fn.name)) { byGroup[i].items.push(fn); break; }
    }
  });

  const L = [];
  L.push('# Editor functions');
  L.push('');
  L.push('Every function meant to be run by hand from the Apps Script editor,');
  L.push('with the file and line to find it.');
  L.push('');
  L.push('**This file is generated.** Run `node scripts/gen-editor-functions.js`');
  L.push('after adding or moving an `@editor` function; CI fails if it is stale.');
  L.push('A hand-maintained index would be wrong within a week, and a stale index');
  L.push('is worse than none — it sends a reader to a file that no longer holds the');
  L.push('function, and they conclude the function is gone.');
  L.push('');
  L.push('## How to run one');
  L.push('');
  L.push('1. Open the Apps Script project (Extensions → Apps Script, or script.google.com).');
  L.push('2. Open the file named in the table below from the left-hand file list.');
  L.push('3. Choose the function in the dropdown at the top, then **Run**.');
  L.push('4. Read **Execution log** for the output.');
  L.push('');
  L.push('Functions taking arguments cannot be run from the dropdown directly —');
  L.push('the editor passes no parameters. Call them from a one-line wrapper, or');
  L.push('use the argument-free variant where one is listed.');
  L.push('');

  byGroup.forEach(({ group, items }) => {
    if (!items.length) return;
    L.push('## ' + group.title);
    L.push('');
    if (group.note) { L.push(group.note); L.push(''); }
    L.push('| Function | File | Line | What it does |');
    L.push('|---|---|---:|---|');
    items.sort((a, b) => a.file === b.file ? a.line - b.line
                                          : a.file.localeCompare(b.file));
    items.forEach((f) => {
      const sig = '`' + f.name + '(' + (f.args ? '…' : '') + ')`';
      L.push('| ' + sig + ' | `' + f.file + '` | ' + f.line + ' | ' +
             (f.summary || '—') + ' |');
    });
    L.push('');
  });

  L.push('---');
  L.push('');
  L.push('Generated from the `@editor` JSDoc tag across `' +
         SERVER_DIR.split(path.sep).join('/') + '/**/*.js`.');
  L.push('');
  return L.join('\n');
}

const fns = walk(SERVER_DIR).sort().flatMap(scanFile);
const text = render(fns);

if (process.argv.indexOf('--check') > -1) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (existing !== text) {
    console.error('docs/EDITOR_FUNCTIONS.md is out of date.');
    console.error('Run: node scripts/gen-editor-functions.js');
    process.exit(1);
  }
  console.log('docs/EDITOR_FUNCTIONS.md is current (' + fns.length + ' functions).');
  process.exit(0);
}

fs.writeFileSync(OUT, text);
console.log('Wrote ' + OUT + ' — ' + fns.length + ' editor functions.');
