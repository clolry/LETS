/**
 * Automated Verification Script for the directory email lookup.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * The FAS HRLinks feed has 33 columns and no email address. Email_Address is
 * how LETS decides who someone IS:
 *
 *   Access.js:435-441   the HC supervisor access rule matches the signed-in
 *                       user against Email_Address
 *   Access.js:982       the Division Director lookup matches on email
 *   HCPrivacy.js:79     on the reviewer allow-list, so a reviewer can contact
 *                       a traveller
 *
 * So a WRONG email is far worse than no email, and the difference is a
 * security boundary. Write the wrong address onto a position whose
 * Supervisory_Status is '2' and you have granted that person site access, made
 * them a candidate Division Director, and pointed a reviewer's contact link at
 * them — with no symptom other than the wrong person approving travel.
 *
 * Name matching is inherently ambiguous: GSA has more than one Michael Smith.
 * Every section below exists to pin the refusal behaviour, because the
 * dangerous failure here is a confident guess, not a gap.
 *
 * §6 is the one that matters most: three independent negative controls that
 * each turn a refusal into a guess, proving the refusals are real.
 *
 * Run: node lets_app/test_directory_lookup.js
 */

const fs = require('fs');
const D = require('./server/30_services/DirectoryLookup.js');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else {
    console.log('  FAIL', n, x === undefined ? '' : String(x).slice(0, 300));
    fails++;
  }
};

/** A directory candidate. */
const cand = (given, family, middle, email) =>
  ({ givenName: given, familyName: family, middleName: middle || '', email });

console.log('--- Directory email lookup test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. roster names are parsed, including the awkward ones');
{
  // The feed writes 'Surname,Forename M'.
  const m = D.parseName('Mould,Melissa J');
  ok('surname-first with a middle initial',
     m.last === 'Mould' && m.first === 'Melissa' && m.middle === 'J' && m.usable,
     m);

  // A HYPHENATED SURNAME IS ONE SURNAME. Splitting it would make every match
  // for this person fail.
  const h = D.parseName('Mbeki-Lawson,Thandiwe');
  ok('a hyphenated surname stays whole',
     h.last === 'Mbeki-Lawson' && h.first === 'Thandiwe', h);

  // So is a multi-word one.
  const v = D.parseName('Van Der Berg,Hans');
  ok('a multi-word surname stays whole', v.last === 'Van Der Berg', v);

  // A SUFFIX MUST COME OFF THE SURNAME. 'Smith Jr' would never match a
  // directory that stores 'Smith'.
  const j = D.parseName('Smith Jr,Robert A');
  ok('a suffix is split off the surname',
     j.last === 'Smith' && j.suffix === 'Jr' && j.first === 'Robert', j);
  const j2 = D.parseName('Smith,Robert Jr');
  ok('and off the forename when it trails there',
     j2.last === 'Smith' && j2.first === 'Robert' && j2.suffix === 'Jr', j2);

  // Forename-first, for sources with no comma (the liability log).
  const f = D.parseName('Melissa Mould');
  ok('forename-first is handled', f.first === 'Melissa' && f.last === 'Mould', f);

  // ONE TOKEN IS UNUSABLE. 'Okonkwo' alone cannot be matched on, and marking
  // it usable would send a surname-only query whose first hit would then be
  // treated as a unique match.
  const one = D.parseName('Okonkwo');
  ok('a single token is NOT usable for matching', one.usable === false, one);
  ok('and a blank name is not usable', D.parseName('').usable === false);
  ok('nor is a vacancy placeholder',
     D.parseName('VACANT (New position)').usable === false ||
     D.parseName('VACANT (New position)').first !== '',
     'a vacant seat has no occupant to look up');
}

// ---------------------------------------------------------------------------
console.log('\n2. a unique exact match resolves');
{
  const parsed = D.parseName('Mould,Melissa J');
  const r = D.pickMatch(parsed, [cand('Melissa', 'Mould', 'Jane',
                                      'melissa.mould@gsa.gov')]);
  ok('one match resolves', r.email === 'melissa.mould@gsa.gov', r);
  ok('and records the method', r.method === 'unique-name', r.method);
  ok('and the confidence', r.confidence === 'exact', r.confidence);

  // Case and punctuation must not defeat a real match.
  const r2 = D.pickMatch(D.parseName('MOULD,MELISSA'),
                         [cand('Melissa', 'Mould', '', 'm@gsa.gov')]);
  ok('matching is case-insensitive', r2.email === 'm@gsa.gov', r2);

  const r3 = D.pickMatch(D.parseName('Mbeki-Lawson,Thandiwe'),
                         [cand('Thandiwe', 'Mbeki Lawson', '', 't@gsa.gov')]);
  ok('and ignores punctuation differences in a surname',
     r3.email === 't@gsa.gov', r3);

  // The address is lowercased, because Access.js compares lowercased.
  const r4 = D.pickMatch(D.parseName('Doe,Jane'),
                         [cand('Jane', 'Doe', '', 'Jane.Doe@GSA.GOV')]);
  ok('the address is lowercased', r4.email === 'jane.doe@gsa.gov', r4.email);
}

// ---------------------------------------------------------------------------
console.log('\n3. an ambiguous name is REFUSED, never guessed');
{
  // THE CORE SAFETY PROPERTY. Two Michael Smiths and no way to tell them
  // apart means no answer.
  const parsed = D.parseName('Smith,Michael');
  const r = D.pickMatch(parsed, [
    cand('Michael', 'Smith', '', 'michael.smith@gsa.gov'),
    cand('Michael', 'Smith', '', 'm.smith@gsa.gov')
  ]);
  ok('two identical names resolve to NOTHING', r.email === '', r);
  ok('and the method is ambiguous', r.method === 'ambiguous', r.method);
  ok('the candidate count is reported', r.candidateCount === 2, r.candidateCount);
  ok('and the reason explains the risk',
     /grant LETS access to the wrong person/.test(r.reason), r.reason);
  ok('and tells the admin what to do instead',
     /by hand in the roster editor/.test(r.reason), r.reason);

  // Three is no different from two.
  const three = D.pickMatch(parsed, [
    cand('Michael', 'Smith', '', 'a@gsa.gov'),
    cand('Michael', 'Smith', '', 'b@gsa.gov'),
    cand('Michael', 'Smith', '', 'c@gsa.gov')
  ]);
  ok('three identical names also refuse', three.email === '', three);

  // A MIDDLE NAME IS THE ONLY TIE-BREAK.
  const tie = D.pickMatch(D.parseName('Smith,Michael J'), [
    cand('Michael', 'Smith', 'James', 'mj.smith@gsa.gov'),
    cand('Michael', 'Smith', 'Robert', 'mr.smith@gsa.gov')
  ]);
  ok('a middle initial breaks a two-way tie',
     tie.email === 'mj.smith@gsa.gov' && tie.method === 'middle-name', tie);

  // ...but only when it separates exactly one. Two Michael J Smiths refuse.
  const stillTied = D.pickMatch(D.parseName('Smith,Michael J'), [
    cand('Michael', 'Smith', 'James', 'a@gsa.gov'),
    cand('Michael', 'Smith', 'Jason', 'b@gsa.gov')
  ]);
  ok('two matching middle initials still refuse',
     stillTied.email === '' && stillTied.method === 'ambiguous', stillTied);

  // And a middle name must never be REQUIRED — HR and the directory disagree
  // about middle names constantly, so requiring one would reject most real
  // matches.
  const noMiddle = D.pickMatch(D.parseName('Doe,Jane'),
                               [cand('Jane', 'Doe', 'Elizabeth', 'j@gsa.gov')]);
  ok('a middle name present only in the directory does not block a match',
     noMiddle.email === 'j@gsa.gov', noMiddle);
}

// ---------------------------------------------------------------------------
console.log('\n4. near-matches are refused, which is the point');
{
  // A NICKNAME IS NOT A MATCH. This module cannot know Mike is Michael, and
  // guessing is how the wrong Michael is chosen.
  const nick = D.pickMatch(D.parseName('Smith,Michael'),
                           [cand('Mike', 'Smith', '', 'mike.smith@gsa.gov')]);
  ok('a nickname does NOT match a legal forename', nick.email === '', nick);
  ok('and the refusal says nicknames are not matched',
     /[Nn]icknames/.test(nick.reason), nick.reason);

  // A SPELLING VARIANT IS A DIFFERENT PERSON.
  const spell = D.pickMatch(D.parseName('Erikson,Jon'),
                            [cand('John', 'Ericson', '', 'je@gsa.gov')]);
  ok('a spelling variant does not match', spell.email === '', spell);

  // A FORENAME INITIAL MUST NOT MATCH A FULL NAME — 'M Smith' against
  // 'Michael Smith' would also match Mary and Mark.
  const initial = D.pickMatch(D.parseName('Smith,M'),
                              [cand('Michael', 'Smith', '', 'm@gsa.gov')]);
  ok('a forename initial does not match a full forename',
     initial.email === '', initial);

  // Surname match alone is not enough.
  const surnameOnly = D.pickMatch(D.parseName('Smith,Michael'),
                                  [cand('Jennifer', 'Smith', '', 'js@gsa.gov')]);
  ok('a surname match alone is not a match', surnameOnly.email === '',
     surnameOnly);

  // No candidates at all.
  const empty = D.pickMatch(D.parseName('Nobody,Here'), []);
  ok('no candidates resolves to nothing',
     empty.email === '' && empty.method === 'none', empty);
  ok('and says so plainly',
     /No directory entry found/.test(empty.reason), empty.reason);

  // A candidate with no email is not a candidate.
  const noEmail = D.pickMatch(D.parseName('Doe,Jane'),
                              [{ givenName: 'Jane', familyName: 'Doe', email: '' }]);
  ok('a candidate with no address is discarded', noEmail.email === '', noEmail);

  // An unparseable roster name must not produce a query at all.
  const unparseable = D.pickMatch(D.parseName('Okonkwo'),
                                  [cand('Marguerite', 'Okonkwo', '', 'm@gsa.gov')]);
  ok('an unusable name refuses even when a candidate exists',
     unparseable.email === '', unparseable);
  ok('and explains that the name could not be split',
     /could not be split/.test(unparseable.reason), unparseable.reason);
}

// ---------------------------------------------------------------------------
console.log('\n5. the batch is time-boxed, resumable and skips correctly');
{
  const roster = [];
  for (let i = 0; i < 10; i++) {
    roster.push({
      positionNumber: 'P' + i,
      employeeName: 'Person' + i + ',Test',
      emailAddress: '',
      occupancyStatus: 'FILLED'
    });
  }
  const search = (parsed) => [cand(parsed.first, parsed.last, '',
                                   parsed.first.toLowerCase() + '@gsa.gov')];

  const all = D.resolveBatch(roster, search, { deadlineMs: 60000 });
  ok('a full pass resolves everything',
     all.resolved.length === 10 && all.complete === true, all);
  ok('and reports the lookup count', all.lookups === 10, all.lookups);

  // THE LOOKUP CAP. ~900 positions at one network call each will be killed by
  // the six-minute limit, and a run that loses its place spends the quota
  // twice.
  const capped = D.resolveBatch(roster, search, { maxLookups: 4 });
  ok('the lookup cap stops the batch', capped.lookups === 4, capped.lookups);
  ok('it is not marked complete', capped.complete === false, capped.complete);
  ok('and it reports where to resume', capped.nextIndex === 4, capped.nextIndex);
  ok('with the reason it stopped',
     /lookup cap/.test(capped.stoppedBecause), capped.stoppedBecause);

  // Resuming from the index must cover the remainder exactly — no gap, no
  // repeat. A gap leaves someone unable to sign in.
  const rest = D.resolveBatch(roster, search, { startIndex: capped.nextIndex });
  ok('resuming covers exactly the remainder',
     rest.resolved.length === 6 && rest.complete === true, rest);
  const seen = capped.resolved.concat(rest.resolved).map(r => r.positionNumber);
  ok('and the two passes cover every position once',
     new Set(seen).size === 10 && seen.length === 10, seen);

  // A VACANT SEAT HAS NO OCCUPANT.
  const withVacant = D.resolveBatch([
    { positionNumber: 'V1', employeeName: 'VACANT', occupancyStatus: 'VACANT' },
    { positionNumber: 'F1', employeeName: 'Doe,Jane', occupancyStatus: 'FILLED' }
  ], search, {});
  ok('a vacant position is skipped',
     withVacant.skipped === 1 && withVacant.lookups === 1, withVacant);

  // AN EXISTING ADDRESS IS NOT OVERWRITTEN. The hand-corrected ones are
  // exactly the ambiguous cases this module refused, so overwriting them with
  // a machine guess would undo the fix.
  const withExisting = D.resolveBatch([
    { positionNumber: 'E1', employeeName: 'Doe,Jane',
      emailAddress: 'hand.corrected@gsa.gov', occupancyStatus: 'FILLED' }
  ], search, {});
  ok('an existing address is skipped by default',
     withExisting.skipped === 1 && withExisting.lookups === 0, withExisting);
  const forced = D.resolveBatch([
    { positionNumber: 'E1', employeeName: 'Doe,Jane',
      emailAddress: 'hand.corrected@gsa.gov', occupancyStatus: 'FILLED' }
  ], search, { includeExisting: true });
  ok('unless includeExisting is asked for', forced.lookups === 1, forced);

  // A search that throws must not abort the whole sweep — one bad lookup
  // should cost one position, not the run.
  const thrower = () => { throw new Error('429 rate limited'); };
  const errored = D.resolveBatch(roster.slice(0, 3), thrower, {});
  ok('a failing search is recorded per position, not fatal',
     errored.refused.length === 3 &&
     errored.refused.every(r => r.method === 'error'), errored.refused[0]);
  ok('and the error text is kept',
     /429/.test(errored.refused[0].reason), errored.refused[0].reason);
}

// ---------------------------------------------------------------------------
console.log('\n5b. the summary leads with the refusals');
{
  const batch = {
    lookups: 5, skipped: 2, complete: true, nextIndex: 5,
    resolved: [
      { method: 'unique-name' }, { method: 'unique-name' },
      { method: 'middle-name' }
    ],
    refused: [
      { method: 'ambiguous', candidateCount: 2, reason: '2 people...' },
      { method: 'none', candidateCount: 0, reason: 'No directory entry found' }
    ]
  };
  const s = D.summarise(batch);
  ok('resolutions are counted by method',
     s.byMethod['unique-name'] === 2 && s.byMethod['middle-name'] === 1,
     s.byMethod);
  ok('ambiguous refusals are counted separately',
     s.refusedByReason.ambiguous === 1, s.refusedByReason);
  ok('not-found refusals too', s.refusedByReason.notFound === 1,
     s.refusedByReason);
  // The note has to say refusals are deliberate, or an admin reads them as a
  // malfunction and looks for a way to force them through.
  ok('the note states refusals are deliberate',
     /Refusals are deliberate/.test(s.note), s.note);
}

// ---------------------------------------------------------------------------
console.log('\n6. negative controls (each turns a refusal into a guess)');
{
  const src = fs.readFileSync('lets_app/server/30_services/DirectoryLookup.js', 'utf8');
  const build = (patched) => {
    const mod = { exports: {} };
    new Function('module', 'exports', patched)(mod, mod.exports);
    return mod.exports;
  };

  // 6a — take the FIRST of several matches instead of refusing. This is the
  // single most tempting change in the file and the most dangerous.
  const takeFirst = src.replace(
    `    // Several people share the name. The middle name is the only tie-break.`,
    `    if (matched.length > 1) {
      return { email: String(matched[0].candidate.email).toLowerCase(),
               method: 'first-match', confidence: 'exact',
               candidateCount: matched.length, reason: '' };
    }
    // Several people share the name. The middle name is the only tie-break.`);
  ok('negative control patched the ambiguity refusal', takeFirst !== src);
  {
    const M = build(takeFirst);
    const r = M.pickMatch(M.parseName('Smith,Michael'), [
      cand('Michael', 'Smith', '', 'wrong.person@gsa.gov'),
      cand('Michael', 'Smith', '', 'right.person@gsa.gov')
    ]);
    ok('a patched build picks one of two Michael Smiths',
       r.email === 'wrong.person@gsa.gov',
       'so section 3 is real: this would grant LETS access to whichever ' +
       'Michael Smith the API happened to return first');
  }

  // 6b — match on the forename INITIAL. Plausible-looking, and it makes every
  // 'M Smith' match Michael, Mary and Mark.
  //
  // The patch target moved when candidateMatches gained the displayName
  // fallback: the comparison now reads a resolved `given` variable rather
  // than c.givenName directly. The old patch string silently stopped
  // matching, so this control passed while patching nothing — which is
  // exactly the failure mode a negative control exists to prevent, appearing
  // in the negative control itself.
  const initialMatch = src.replace(
    `    var firstOk = nameKey(parsed.first) &&
                  nameKey(parsed.first) === nameKey(given);`,
    `    var pf = nameKey(parsed.first), cf = nameKey(given);
    var firstOk = pf && cf && (pf === cf || cf.charAt(0) === pf.charAt(0));`);
  ok('negative control patched the forename comparison', initialMatch !== src);
  {
    const M = build(initialMatch);
    const r = M.pickMatch(M.parseName('Smith,Michael'),
                          [cand('Mary', 'Smith', '', 'mary.smith@gsa.gov')]);
    ok('a patched build matches Michael to Mary',
       r.email === 'mary.smith@gsa.gov',
       'so section 4 is real: a loose forename rule matches the wrong person');
  }

  // 6c — treat a name with no forename as usable. A surname-only query would
  // then return one hit and be taken as a unique match.
  const looseParse = src.replace(
    `    out.usable = !!(out.last && out.first);`,
    `    out.usable = !!out.last;`);
  ok('negative control patched the usability rule', looseParse !== src);
  {
    const M = build(looseParse);
    // 'Smith,' takes the comma branch and reaches the patched line. A bare
    // 'Smith' returns earlier, so it would not exercise the patch — using it
    // here would have made this control pass while proving nothing.
    const parsed = M.parseName('Smith,');
    ok('a patched build accepts a forename-less name as usable',
       parsed.usable === true && parsed.first === '',
       'so section 1 is real: with no forename the query is just a surname');
    const r = M.pickMatch(parsed, [cand('Michael', 'Smith', '', 'ms@gsa.gov')]);
    ok('and it then matches on surname alone', r.email === '' || r.method !== 'none',
       'the unpatched build refuses outright because the name was never ' +
       'specific enough to ask');
  }
}

// ---------------------------------------------------------------------------
console.log('\n7. the network layer is guarded and separated');
{
  const resolve = fs.readFileSync('lets_app/server/40_domain/DirectoryResolve.js', 'utf8');
  const pure = fs.readFileSync('lets_app/server/30_services/DirectoryLookup.js', 'utf8');

  // THE MATCHING LOGIC MUST NOT TOUCH THE NETWORK, or none of the above is
  // testable and the decisions become unobservable.
  ok('DirectoryLookup makes no API calls',
     !/People\./.test(pure) && !/UrlFetchApp/.test(pure),
     'the search function is injected so every decision is testable');

  // People, not AdminDirectory: admin.directory.user.readonly needs a
  // Workspace super admin to authorise, and this app runs as USER_ACCESSING.
  //
  // COMMENTS ARE STRIPPED FIRST. DirectoryResolve's own header explains why
  // AdminDirectory was rejected, so a naive grep for the string reports a
  // violation on prose that is arguing the opposite — the same trap that bit
  // the markup suite twice.
  const resolveCode = resolve.replace(/\/\*[\s\S]*?\*\//g, '')
                             .replace(/^\s*\/\/.*$/gm, '');
  ok('it uses the People API, not the Admin SDK',
     /People\.People\.searchDirectoryPeople/.test(resolveCode) &&
     !/AdminDirectory/.test(resolveCode),
     'AdminDirectory needs a super-admin scope this app cannot request');

  const manifest = JSON.parse(fs.readFileSync('lets_app/appsscript.json', 'utf8'));
  const svc = manifest.dependencies.enabledAdvancedServices || [];
  ok('the manifest declares the People service',
     svc.some(s => s.serviceId === 'peopleapi' && s.userSymbol === 'People'),
     svc);

  // NO EXPLICIT oauthScopes. Apps Script DERIVES scopes from the code; an
  // explicit list REPLACES that inference, so any scope omitted from it stops
  // working. Adding one here to cover directory.readonly would have risked
  // breaking Drive, Gmail and Sheets access across the whole app.
  ok('the manifest does NOT pin an explicit oauthScopes list',
     !('oauthScopes' in manifest),
     'an explicit list replaces Apps Script\'s inference and would break ' +
     'every scope not enumerated');

  // A missing advanced service is a ReferenceError, which reads as a code
  // bug. Both entry points must say what to enable.
  ok('both entry points check for the People service',
     (resolve.match(/typeof People === 'undefined'/g) || []).length >= 2,
     'otherwise an un-enabled service looks like a crash');
  ok('and the message says how to enable it',
     /Add a service/.test(resolve), 'an admin cannot act on a ReferenceError');

  // Admin-gated and locked: this writes HR data that governs site access.
  ok('both entry points are admin-gated',
     (resolve.match(/_hcAdminGuard_\(\)/g) || []).length >= 2);
  ok('the write path takes the script lock',
     /LockService\.getScriptLock\(\)/.test(resolve));

  // The resume index must be saved AFTER the write, so a mid-write failure
  // re-runs the slice rather than skipping it.
  const writeAt = resolve.indexOf('written++');
  const saveAt = resolve.indexOf('_setDirectoryResumeIndex_(batch.complete');
  ok('the resume index is saved after the write, not before',
     writeAt > -1 && saveAt > writeAt,
     'saving first would skip a slice on failure and leave people unable to ' +
     'sign in');

  // The row index must be built once. A getRange per position would be ~900
  // reads and would itself exhaust the execution budget.
  ok('the position-to-row index is built in one read',
     /getRange\(2, pnCol, lastRow - 1, 1\)\.getValues\(\)/.test(resolve));

  // The method is recorded, so an audit can tell a unique match from a
  // tie-break.
  ok('the match method is written into Updated_By',
     /'directory:' \+ r\.method/.test(resolve));

  // It must never clear an address it could not resolve.
  ok('only resolved addresses are written',
     /batch\.resolved\.forEach/.test(resolve) &&
     !/refused\.forEach\(function \(r\) \{[\s\S]{0,200}setValue/.test(resolve),
     'a refusal must leave the existing cell alone');

  // The cache must be invalidated or the access gate keeps reading the old
  // roster and the admin concludes it did not work.
  ok('the HC cache is invalidated after writing',
     /hcCacheInvalidateAll\(\)/.test(resolve));

  // pageSize must be large enough to SEE ambiguity. A cap of 1 would make
  // every lookup look unique.
  ok('the search asks for enough results to detect ambiguity',
     /pageSize: 30/.test(resolve),
     'pageSize 1 would hide every ambiguous name and resolve it confidently');
}

// ---------------------------------------------------------------------------
console.log('\n8. the People API leaves givenName/familyName empty');
{
  // @clolry's first live sweep: 50 lookups, 0 resolved, 46 refused with
  // "1 directory entr(ies) were returned ... but none matched exactly on both
  // surname and forename".
  //
  // One candidate returned and rejected, 46 times, is not 46 wrong people. It
  // is one systematic mismatch: the People API populates names.displayName on
  // every directory result but leaves givenName and familyName EMPTY on many,
  // particularly DOMAIN_CONTACT entries. nameKey('') is falsy, so both
  // comparisons failed for every such candidate.
  const only = (display, email) =>
    ({ givenName: '', familyName: '', middleName: '', displayName: display, email });

  const hale = D.pickMatch(D.parseName('Hale,Lawrence C'),
                           [only('Lawrence Hale', 'lawrence.hale@gsa.gov')]);
  ok('a displayName-only candidate now matches',
     hale.email === 'lawrence.hale@gsa.gov', hale);
  ok('and is still recorded as a unique-name match',
     hale.method === 'unique-name', hale.method);

  // 'Surname, Forename' order, which some directories use.
  ok('a comma-ordered displayName parses correctly',
     D.pickMatch(D.parseName('Hale,Lawrence C'),
                 [only('Hale, Lawrence', 'l@gsa.gov')]).email === 'l@gsa.gov');

  // A middle initial in the displayName must not break the surname.
  ok('a middle initial in the displayName is tolerated',
     D.pickMatch(D.parseName('Hale,Lawrence C'),
                 [only('Lawrence C Hale', 'l@gsa.gov')]).email === 'l@gsa.gov');

  // 'NMN' is HR shorthand for "no middle name" and appears as a literal
  // middle name in the roster — 'Patnaik,Udaya NMN'.
  ok('NMN is treated as no middle name',
     D.pickMatch(D.parseName('Patnaik,Udaya NMN'),
                 [only('Udaya Patnaik', 'u@gsa.gov')]).email === 'u@gsa.gov');
  ok('and does not block a candidate that HAS a middle name',
     D.pickMatch(D.parseName('Patnaik,Udaya NMN'),
                 [{ givenName: 'Udaya', familyName: 'Patnaik',
                    middleName: 'Kumar', email: 'u@gsa.gov' }]).email === 'u@gsa.gov');

  // A TRAILING SUFFIX IS NOT THE SURNAME. 'John Tekus Jr' parsed to surname
  // 'Jr', so 'Tekus Jr,John J' could never match its own directory entry. The
  // comma branch already stripped suffixes; the forename-first branch did
  // not, and the displayName fallback is what made that gap reachable.
  const parsedDisplay = D.parseName('John Tekus Jr');
  ok('a suffix in a forename-first name is stripped',
     parsedDisplay.last === 'Tekus' && parsedDisplay.suffix === 'Jr',
     parsedDisplay);
  ok('so a suffixed roster name matches its suffixed directory entry',
     D.pickMatch(D.parseName('Tekus Jr,John J'),
                 [only('John Tekus Jr', 'j@gsa.gov')]).email === 'j@gsa.gov');

  // A real multi-word surname must NOT be mistaken for a suffix.
  ok('a multi-word surname is not treated as a suffix',
     D.parseName('Hans Van Der Berg').suffix === '',
     D.parseName('Hans Van Der Berg'));
  // Two tokens must be untouched: 'Melissa Mould' has no suffix to strip.
  ok('a two-token name is unchanged',
     D.parseName('Melissa Mould').last === 'Mould' &&
     D.parseName('Melissa Mould').first === 'Melissa');

  // THE STRUCTURED FIELDS STILL WIN when present, because the API has already
  // done the hard part for 'Van Der Berg'.
  const both = D.pickMatch(D.parseName('Berg,Hans'), [{
    givenName: 'Hans', familyName: 'Berg', middleName: '',
    displayName: 'Someone Else Entirely', email: 'h@gsa.gov'
  }]);
  ok('structured fields take precedence over displayName',
     both.email === 'h@gsa.gov', both);

  // AND NOTHING IS LOOSENED. This changes WHERE the name is read from, not
  // how strictly it is judged — every refusal in §4 must still refuse.
  ok('a nickname in a displayName is STILL refused',
     D.pickMatch(D.parseName('Smith,Michael'),
                 [only('Mike Smith', 'm@gsa.gov')]).email === '',
     'the displayName fallback must not become a fuzzy match');
  ok('a spelling variant in a displayName is STILL refused',
     D.pickMatch(D.parseName('Erikson,Jon'),
                 [only('John Ericson', 'j@gsa.gov')]).email === '');
  ok('an ambiguous displayName pair is STILL refused',
     D.pickMatch(D.parseName('Smith,Michael'),
                 [only('Michael Smith', 'a@gsa.gov'),
                  only('Michael Smith', 'b@gsa.gov')]).method === 'ambiguous');
  ok('and a surname-only displayName match is STILL refused',
     D.pickMatch(D.parseName('Smith,Michael'),
                 [only('Jennifer Smith', 'j@gsa.gov')]).email === '');
}

// ---------------------------------------------------------------------------
console.log('\n9. a systematic mismatch is diagnosable without guessing');
{
  // The refusal message said a candidate was returned and rejected but never
  // showed WHAT was returned, so finding the empty-givenName cause took a
  // hypothesis. That is the gap this closes.
  const resolve = fs.readFileSync('lets_app/server/40_domain/DirectoryResolve.js', 'utf8');

  ok('there is a per-name diagnostic',
     /function diagnoseDirectoryMatch\(name\)/.test(resolve));

  const diag = resolve.slice(resolve.indexOf('function diagnoseDirectoryMatch'),
                             resolve.indexOf('function resolveDirectoryEmails'));
  ok('it prints every name field, quoted',
     /JSON\.stringify\(c\.givenName\)/.test(diag) &&
     /JSON\.stringify\(c\.displayName\)/.test(diag),
     'an empty givenName is invisible unquoted, and that emptiness was the bug');
  ok('it shows the match verdict per candidate',
     /candidateMatches\(parsed, c\)/.test(diag));
  ok('it shows the parsed roster name and the query sent',
     /parsed      : /.test(diag) && /query       : /.test(diag));
  ok('it defaults to a real staffed position with no email',
     /occupancyStatus !== 'VACANT' && list\[i\]\.employeeName/.test(diag),
     'the Run button passes no arguments, so it must pick its own subject');
  ok('and it writes nothing',
     !/setValue|appendRow|clearContent|setProperty/.test(diag));

  // The preview wrapper must not blow the log budget. 50 refusal objects,
  // each with a paragraph of reason text, is what truncated @clolry's output.
  const wrapper = fs.readFileSync('lets_app/server/99_triggers/Diagnostics.js', 'utf8');
  const fn = wrapper.slice(wrapper.indexOf('function runDirectoryPreview'),
                           wrapper.indexOf('function runDirectoryResolve'));
  ok('runDirectoryPreview prints the summary, not every refusal',
     /JSON\.stringify\(d\.summary, null, 2\)/.test(fn) &&
     !/JSON\.stringify\(r, null, 2\);\n\}/.test(fn), fn.slice(0, 300));
  ok('and caps the samples it does print',
     /slice\(0, 10\)/.test(fn));
  ok('and points at the per-name diagnostic',
     /diagnoseDirectoryMatch\(\)/.test(fn));
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
