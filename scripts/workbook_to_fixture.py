#!/usr/bin/env python3
"""
Converts Chiquita's reconciliation workbook to the JSON fixture that
test_travel_import.js §21 reads.

WHY THIS EXISTS
---------------
§21 is the measured section: it runs the real workbook through the real import
engine and asserts the figures — 28 in-scope requests at $46,196.19, 10 expense
reports at $16,863.62, the $1,164.39 variance gap, and the Patnaik near-miss.
A behaviour change shows up as one of those numbers moving.

It cannot read the .xlsx directly, because the workbook is deliberately NOT in
the repository: ~1,900 real traveller names, 823 real GSA email addresses and
274 employee IDs across its tabs. Finding G-056 already flags six real
employees' addresses in test fixtures as a problem; committing this would be a
far larger instance, and git history cannot be taken back.

So §21 reads a JSON conversion from /tmp and SKIPS when it is absent. That
keeps a fresh checkout green while letting anyone with the workbook re-run the
measured assertions. This script is the conversion, written down rather than
left as a one-off so it does not have to be reinvented.

THE OUTPUT PATH IS /tmp ON PURPOSE. It must not be inside the repository, or
the next `git add -A` commits 1,900 names. The CI guard
"no real personal data enters the repository" would catch the workbook itself,
but not a JSON file nobody thought to name.

WHY NO openpyxl
---------------
This container has no third-party Python packages, and adding a dependency to
run one test fixture is a poor trade. An .xlsx is a zip of XML, so the reader
below is ~40 lines of stdlib. It handles the two things that actually matter
here:

  shared strings   most cell text lives in xl/sharedStrings.xml, not inline
  cell types       t="s" means "index into shared strings", not "the string s"

It does NOT convert dates. Serials are passed through as the raw numbers the
spreadsheet holds, because that is exactly what the browser's parser sends
(raw: true) and what TravelImport.toDateString is built to accept. Formatting
them here would test a different input than production receives.

USAGE
-----
    python3 scripts/workbook_to_fixture.py \
        "_Expense Report Calculations File for LETS.xlsx"

    node lets_app/test_travel_import.js     # §21 now runs instead of skipping

Run with no argument and it looks for the workbook in the repository root.
"""

import json
import os
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
R_ID = '{%s}id' % NS['r']
M = '{%s}' % NS['m']

# The tabs the importer reads, plus the two it reconciles against.
#
# 'Summary' is excluded: it is a filtered VIEW of Combined, so including it
# would let a test assert the same figures twice and call that corroboration.
WANTED = {
    'TravelRequest': 0,      # tab name -> header row index (0-based)
    'Expense': 0,
    'Combined': 0,
    'OfficeSymbol': 0,
    'OffSymbolOverride': 0,
}

OUT_PATH = '/tmp/opencode/fy27_workbook.json'


def col_letters(ref):
    """'BC12' -> 'BC'"""
    m = re.match(r'([A-Z]+)', ref or '')
    return m.group(1) if m else ''


def col_number(letters):
    """'A' -> 1, 'AA' -> 27. For sorting columns into sheet order."""
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def load_workbook(path):
    z = zipfile.ZipFile(path)

    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    target_for = {r.get('Id'): r.get('Target') for r in rels}

    sheets = []
    for s in wb.find('m:sheets', NS):
        sheets.append((s.get('name'), target_for.get(s.get(R_ID))))

    # Shared strings. Most text in an xlsx lives here and the cell only holds
    # an index; reading the cell value alone yields integers where you expect
    # names.
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        ss = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in ss:
            shared.append(''.join(t.text or '' for t in si.iter(M + 't')))

    return z, sheets, shared


def read_rows(z, target, shared):
    """Returns a list of {column letter: value} dicts, in sheet row order."""
    path = target if target.startswith('xl/') else 'xl/' + target.lstrip('/')
    root = ET.fromstring(z.read(path))

    out = []
    for row in root.iter(M + 'row'):
        cells = {}
        for c in row:
            ref = c.get('r') or ''
            letters = col_letters(ref)
            ctype = c.get('t')
            v = c.find('m:v', NS)
            inline = c.find('m:is', NS)

            if ctype == 's' and v is not None:
                # An index into shared strings, not the literal 's'.
                try:
                    val = shared[int(v.text)]
                except (ValueError, IndexError):
                    val = ''
            elif ctype == 'inlineStr' and inline is not None:
                val = ''.join(t.text or '' for t in inline.iter(M + 't'))
            elif v is not None:
                val = v.text
            else:
                val = ''
            cells[letters] = val
        out.append(cells)
    return out


def to_table(rows, header_index):
    """
    Column-letter dicts -> {headers, rows} with header-keyed row objects.

    Matches the shape the browser posts: SheetJS's sheet_to_json produces
    header-keyed objects, so the fixture and production feed the engine the
    same thing.
    """
    if len(rows) <= header_index:
        return {'headers': [], 'rows': []}

    header_row = rows[header_index]
    letters = sorted((k for k, v in header_row.items() if v not in ('', None)),
                     key=col_number)
    headers = [header_row[k] for k in letters]

    data = []
    for row in rows[header_index + 1:]:
        rec = {}
        for letter, name in zip(letters, headers):
            val = row.get(letter, '')
            rec[name] = '' if val is None else val
        # A wholly empty row is spreadsheet padding, not a record. The
        # Combined tab has 2,384 XML rows and 28 real ones.
        if any(v not in ('', None) for v in rec.values()):
            data.append(rec)
    return {'headers': headers, 'rows': data}


def main():
    if len(sys.argv) > 1:
        path = sys.argv[1]
    else:
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidates = [f for f in os.listdir(here)
                      if 'Expense Report Calculations' in f and f.endswith(('.xlsx', '.xls'))]
        if not candidates:
            print('Could not find the workbook. Pass its path as an argument.',
                  file=sys.stderr)
            print('Expected a file matching "*Expense Report Calculations*.xlsx" '
                  'in the repository root.', file=sys.stderr)
            return 1
        path = os.path.join(here, candidates[0])

    if not os.path.exists(path):
        print('No such file: ' + path, file=sys.stderr)
        return 1

    z, sheets, shared = load_workbook(path)
    found = {name: target for name, target in sheets}

    missing = [t for t in WANTED if t not in found]
    if missing:
        print('This workbook is missing: ' + ', '.join(missing), file=sys.stderr)
        print('It has: ' + ', '.join(found.keys()), file=sys.stderr)
        return 1

    out = {}
    for tab, header_index in WANTED.items():
        rows = read_rows(z, found[tab], shared)
        out[tab] = to_table(rows, header_index)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w') as fh:
        json.dump(out, fh)

    print('Wrote ' + OUT_PATH)
    for tab in WANTED:
        print('    %-20s %5d rows, %2d columns'
              % (tab, len(out[tab]['rows']), len(out[tab]['headers'])))
    print()
    print('Now run:  node lets_app/test_travel_import.js')
    print('§21 should report 28 in-scope requests and 10 expense reports.')
    print()
    print('NOTE: the fixture holds real traveller names and email addresses.')
    print('It is written to /tmp deliberately. Do not copy it into the repo.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
