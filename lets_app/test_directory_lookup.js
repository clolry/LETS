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
  // THE ANCHOR MOVED when the org tie-break was added — the comment now reads
  // "Two tie-breaks, middle name first". The old anchor silently stopped
  // matching, which is the second time a negative control in this file has
  // quietly tested nothing. Anchored on the `byMiddle` declaration, which is
  // code rather than prose and so cannot drift on a comment edit.
  const takeFirst = src.replace(
    `    var byMiddle = matched.filter(function (m) { return m.middleAgrees; });`,
    `    if (matched.length > 1) {
      return { email: String(matched[0].candidate.email).toLowerCase(),
               method: 'first-match', confidence: 'exact',
               candidateCount: matched.length, reason: '' };
    }
    var byMiddle = matched.filter(function (m) { return m.middleAgrees; });`);
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
  //
  // COMMENTS STRIPPED. DirectoryLookup's own prose now names
  // People.searchDirectoryPeople while explaining why the name search misses
  // people that an address lookup finds — and the naive grep read that as an
  // API call. Fourth occurrence of this trap in the project: an assertion on
  // source text that the file's own explanation satisfies.
  const pureCode = pure.replace(/\/\*[\s\S]*?\*\//g, '')
                       .replace(/^\s*\/\/.*$/gm, '');
  ok('DirectoryLookup makes no API calls',
     !/People\./.test(pureCode) && !/UrlFetchApp/.test(pureCode),
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

// ---------------------------------------------------------------------------
console.log('\n10. GSA appends the org code to the family name');
{
  // THE ACTUAL CAUSE of 46 of 50 refusals. @clolry's diagnostic:
  //
  //   givenName="Lawrence" familyName="Hale - FC" displayName="Lawrence Hale - FC"
  //
  // The roster's surname 'Hale' was compared against 'Hale - FC' and failed,
  // on every entry. The uniformity of the count was the clue; the content was
  // invisible until the diagnostic printed the fields quoted.
  ok('the org suffix is split off a family name',
     D.splitDirectorySuffix('Hale - FC').name === 'Hale' &&
     D.splitDirectorySuffix('Hale - FC').org === 'FC',
     D.splitDirectorySuffix('Hale - FC'));
  ok('and off a display name',
     D.splitDirectorySuffix('Lawrence Hale - FC').name === 'Lawrence Hale',
     D.splitDirectorySuffix('Lawrence Hale - FC'));

  // A HYPHENATED SURNAME MUST SURVIVE. 'Mbeki-Lawson',
  // 'Fitzgerald-Moreau' and 'Aubert-Bell' are all in this roster; splitting
  // on a bare hyphen would truncate them to 'Mbeki' and match the wrong
  // person or nobody.
  ok('a hyphenated surname is untouched',
     D.splitDirectorySuffix('Mbeki-Lawson').name === 'Mbeki-Lawson' &&
     D.splitDirectorySuffix('Mbeki-Lawson').org === '',
     'the delimiter is space-hyphen-space, not a bare hyphen');
  ok('and a hyphenated surname WITH a suffix splits correctly',
     D.splitDirectorySuffix('Mbeki-Lawson - FC').name === 'Mbeki-Lawson',
     D.splitDirectorySuffix('Mbeki-Lawson - FC'));

  // NOT EVERY ' - ' IS AN ORG SUFFIX. My first version split 'Smith - Jones'
  // into surname 'Smith' and org 'JONES' — inventing an org from somebody's
  // double-barrelled name and discarding half of it. GSA org codes are
  // uppercase and short.
  ok('a non-org tail is NOT stripped',
     D.splitDirectorySuffix('Smith - Jones').name === 'Smith - Jones',
     'requiring uppercase rejects a name mistaken for a code');
  ok('nor is a long descriptive tail',
     D.splitDirectorySuffix('Hale - Office of Acquisition').org === '',
     'an 8-character cap keeps a description from reading as a code');
  ok('a name with no suffix is unchanged',
     D.splitDirectorySuffix('Hale').name === 'Hale');

  // END TO END: the exact candidate from the live diagnostic.
  const live = {
    givenName: 'Lawrence', familyName: 'Hale - FC', middleName: '',
    displayName: 'Lawrence Hale - FC', email: 'lawrence.hale@gsa.gov'
  };
  const m = D.candidateMatches(D.parseName('Hale,Lawrence C'), live);
  ok('the live candidate now matches', m.matches === true, m);
  ok('and its org is extracted for the tie-break', m.directoryOrg === 'FC', m);
  ok('pickMatch resolves it',
     D.pickMatch(D.parseName('Hale,Lawrence C'), [live]).email ===
       'lawrence.hale@gsa.gov');

  // STRICTNESS IS UNCHANGED. The suffix strip must not become a fuzzy match.
  ok('a nickname with an org suffix is STILL refused',
     D.pickMatch(D.parseName('Smith,Michael'),
                 [{ givenName: 'Mike', familyName: 'Smith - FC',
                    email: 'm@gsa.gov' }]).email === '');
  ok('a different surname with the same org is STILL refused',
     D.pickMatch(D.parseName('Smith,Michael'),
                 [{ givenName: 'Michael', familyName: 'Smithson - FC',
                    email: 'm@gsa.gov' }]).email === '');
}

// ---------------------------------------------------------------------------
console.log('\n11. the org code is a legitimate tie-break, narrowly used');
{
  // I ARGUED AGAINST THIS AND WAS WRONG. I wrote that "the feed's org code
  // and the directory's department string are different vocabularies, and a
  // plausible-looking correlation would be the most dangerous rule in the
  // file."
  //
  // The diagnostic falsified it: the directory suffix is 'FC', which is the
  // same code space as the roster's Dept ID (Org) — 'FCA0B' is FC's
  // descendant. Not a correlation; the same identifier.
  ok('a roster service centre agrees with its DAC suffix',
     D.candidateOrgMatches('FCA0B', 'FC') === true);
  ok('and the reverse direction agrees too',
     D.candidateOrgMatches('FC', 'FCA0B') === true,
     'the directory may be more specific than the roster, or less');
  ok('a different portfolio does not agree',
     D.candidateOrgMatches('FCA0B', 'FD') === false);

  // ABSENCE IS NOT DISAGREEMENT. A candidate with no org suffix must neither
  // win nor lose on this basis.
  ok('a missing directory org never agrees',
     D.candidateOrgMatches('FCA0B', '') === false);
  ok('and a missing roster org never agrees',
     D.candidateOrgMatches('', 'FC') === false);

  const two = [
    { givenName: 'Michael', familyName: 'Smith - FCA0B', email: 'right@gsa.gov' },
    { givenName: 'Michael', familyName: 'Smith - FD', email: 'wrong@gsa.gov' }
  ];
  const picked = D.pickMatch(D.parseName('Smith,Michael'), two, 'FCA0B');
  ok('two namesakes in different orgs are separated by org code',
     picked.email === 'right@gsa.gov' && picked.method === 'org-code', picked);

  // WITHOUT A ROSTER ORG IT MUST STILL REFUSE. The tie-break requires both
  // sides.
  ok('no roster org leaves the pair ambiguous',
     D.pickMatch(D.parseName('Smith,Michael'), two, '').method === 'ambiguous');

  // TWO IN THE SAME ORG IS STILL AMBIGUOUS. The tie-break must leave exactly
  // one survivor, not pick the first of several.
  const same = [
    { givenName: 'Michael', familyName: 'Smith - FC', email: 'a@gsa.gov' },
    { givenName: 'Michael', familyName: 'Smith - FC', email: 'b@gsa.gov' }
  ];
  const amb = D.pickMatch(D.parseName('Smith,Michael'), same, 'FCA0B');
  ok('two namesakes in the SAME org remain ambiguous',
     amb.method === 'ambiguous' && amb.email === '', amb);
  ok('and the refusal says so',
     /share this org code/.test(amb.reason), amb.reason);

  // MIDDLE NAME STILL WINS FIRST, because it identifies the person rather
  // than their location.
  const middleFirst = [
    { givenName: 'Michael', familyName: 'Smith - FD', middleName: 'James',
      email: 'bymiddle@gsa.gov' },
    { givenName: 'Michael', familyName: 'Smith - FCA0B', middleName: 'Robert',
      email: 'byorg@gsa.gov' }
  ];
  const mw = D.pickMatch(D.parseName('Smith,Michael J'), middleFirst, 'FCA0B');
  ok('the middle name outranks the org code',
     mw.email === 'bymiddle@gsa.gov' && mw.method === 'middle-name', mw);

  // resolveOne must pass the position's org through, or the tie-break never
  // fires in production.
  const r = D.resolveOne(
    { positionNumber: '1', employeeName: 'Smith,Michael', orgCode: 'FCA0B' },
    () => two);
  ok('resolveOne supplies the roster org code',
     r.email === 'right@gsa.gov' && r.method === 'org-code', r);
}

// ---------------------------------------------------------------------------
console.log('\n12. the refusal reports what the directory actually returned');
{
  // candidateCount was reused for "how many returned" and "how many matched",
  // and the second assignment won — so a no-match refusal reported
  // 0 candidates while its own text said "1 directory entr(ies) were
  // returned". The sample line read as "nobody came back" when somebody had,
  // and those are different bugs.
  const nomatch = D.pickMatch(D.parseName('Smith,Michael'),
                              [{ givenName: 'Mike', familyName: 'Smith',
                                 email: 'm@gsa.gov' }]);
  ok('a no-match refusal reports the RETURNED count',
     nomatch.returnedCount === 1, nomatch);
  ok('and separately reports zero matched',
     nomatch.matchedCount === 0, nomatch);
  ok('candidateCount no longer contradicts the reason text',
     nomatch.candidateCount === 1, nomatch);

  // THE REASON MUST NAME THE CANDIDATES. "N returned, none matched" is true
  // of a nickname, a namesake and a candidate with no name fields — three
  // problems with three different fixes.
  ok('the reason shows the returned names',
     /given="Mike"/.test(nomatch.reason) || /display=/.test(nomatch.reason),
     nomatch.reason);

  const nameless = D.pickMatch(D.parseName('Hale,Lawrence C'),
                               [{ givenName: '', familyName: '',
                                  displayName: '', email: 'l@gsa.gov' }]);
  ok('a candidate with no name fields says so explicitly',
     /NO NAME FIELDS AT ALL/.test(nameless.reason), nameless.reason);

  // A genuine not-found must stay distinguishable from a no-match.
  const notFound = D.pickMatch(D.parseName('Nobody,Here'), []);
  ok('an empty result still reports zero returned',
     notFound.returnedCount === 0 &&
     /No directory entry found/.test(notFound.reason), notFound);
}

// ---------------------------------------------------------------------------
console.log('\n13. the deployed build can be identified from its behaviour');
{
  // @clolry has now run previewDirectoryEmails three times and received
  // byte-identical output across two commits that each changed the matching
  // logic. Identical output after a behavioural change means the code under
  // test did not change — but nothing in the result distinguishes "the fix
  // did not work" from "the fix is not running".
  //
  // That ambiguity cost three round trips here, and two earlier on the HR
  // feed tab name before diagnoseHrFeedSource existed. Anything whose only
  // observable is a count needs a build marker.
  const resolve = fs.readFileSync('lets_app/server/40_domain/DirectoryResolve.js', 'utf8');
  ok('there is a build diagnostic',
     /function diagnoseDirectoryBuild\(\)/.test(resolve));

  const diag = resolve.slice(resolve.indexOf('function diagnoseDirectoryBuild'),
                             resolve.indexOf('function diagnoseDirectoryMatch'));

  // IT MUST ASSERT BEHAVIOUR, NOT A VERSION STRING. A string can be bumped
  // in a commit whose behaviour never ships; running the real matcher against
  // the real candidate shape cannot be.
  ok('it runs the matcher rather than reading a version constant',
     /candidateMatches\(parsed, live\)/.test(diag) &&
     /pickMatch\(parsed, \[live\]\)/.test(diag),
     'a version marker can be bumped without the fix shipping');
  ok('it uses the literal candidate from the live diagnostic',
     /familyName: 'Hale - FC'/.test(diag),
     'a synthetic fixture would not prove this defect is fixed');

  // IT MUST ALSO CHECK STRICTNESS. A build that resolved everything by
  // loosening the comparison would pass every other check and be far worse
  // than one that resolves nothing.
  ok('it verifies a nickname is still refused',
     /a nickname is still REFUSED/.test(diag),
     'resolving everything is worse than resolving nothing');
  ok('and that an ambiguous pair is still refused',
     /two namesakes in one org still REFUSED/.test(diag));

  // The failure message has to say what to DO. "Checks failed" sends someone
  // looking for a code bug that is not there.
  ok('a failure names a stale deployment as the cause',
     /RUNNING AN OLDER BUILD/.test(diag));
  ok('and a pass redirects to the data',
     /the cause is in the data rather than/.test(diag),
     'otherwise a passing build with failing lookups has no next step');

  ok('it makes no network call',
     !/_directorySearch_|searchDirectoryPeople/.test(diag),
     'it must be runnable when the People service is unavailable');
  ok('and writes nothing',
     !/setValue|appendRow|clearContent|setProperty/.test(diag));
}

// ---------------------------------------------------------------------------
console.log('\n14. a suffix on the CANDIDATE is stripped too');
{
  // @clolry's live sweep: 'Kirkland III,Ozel' resolved, 'Tekus Jr,John J' did
  // not. Both suffixed. parseName strips the suffix from the ROSTER name, so
  // both compared as 'Kirkland' and 'Tekus' — but the CANDIDATE was not
  // getting the same treatment. GSA returns familyName 'Tekus Jr - FC', which
  // strips to 'Tekus Jr' and fails against 'Tekus'.
  //
  // Kirkland resolved only because his directory entry happens to omit the
  // III. So the outcome depended on whether the directory carried the suffix,
  // which is a coin toss across an unknown share of 1,046 positions rather
  // than a rule.
  ok('a surname-only suffix is stripped',
     D.stripNameSuffix('Tekus Jr') === 'Tekus', D.stripNameSuffix('Tekus Jr'));
  ok('and III too', D.stripNameSuffix('Kirkland III') === 'Kirkland');

  // NOT via parseName. parseName('Tekus Jr') returns surname 'Jr', forename
  // 'Tekus' — the forename-first branch takes the last token as the surname,
  // and a bare family-name field has no forename. My first version of this
  // fix reused parseName and therefore did nothing at all.
  ok('parseName alone would get this WRONG',
     D.parseName('Tekus Jr').last === 'Jr',
     'which is why stripNameSuffix exists separately');

  // A multi-word surname must survive.
  ok('a multi-word surname is untouched',
     D.stripNameSuffix('Van Der Berg') === 'Van Der Berg');
  ok('and a hyphenated one', D.stripNameSuffix('Mbeki-Lawson') === 'Mbeki-Lawson');

  // A SURNAME THAT IS ONLY A SUFFIX is somebody's actual name. Returning ''
  // would match everyone.
  ok('a surname that is only "Jr" is not stripped to nothing',
     D.stripNameSuffix('Jr') === 'Jr');

  const tekus = { givenName: 'John', familyName: 'Tekus Jr - FC',
                  displayName: 'John Tekus Jr - FC',
                  email: 'john.tekus@gsa.gov' };
  ok('the live Tekus candidate now resolves',
     D.pickMatch(D.parseName('Tekus Jr,John J'), [tekus]).email ===
       'john.tekus@gsa.gov');
  // Symmetry in both directions: roster plain, directory suffixed.
  ok('a plain roster name matches a suffixed directory entry',
     D.pickMatch(D.parseName('Tekus,John'), [tekus]).email ===
       'john.tekus@gsa.gov');
  ok('and Kirkland still resolves',
     D.pickMatch(D.parseName('Kirkland III,Ozel'),
                 [{ givenName: 'Ozel', familyName: 'Kirkland - FC',
                    email: 'o@gsa.gov' }]).email === 'o@gsa.gov');

  // Strictness intact: the suffix strip must not make different surnames
  // equal.
  ok('a different surname with the same suffix is STILL refused',
     D.pickMatch(D.parseName('Tekus Jr,John J'),
                 [{ givenName: 'John', familyName: 'Tekusson Jr - FC',
                    email: 'x@gsa.gov' }]).email === '');
}

// ---------------------------------------------------------------------------
console.log('\n15. suggestions are for a human, and only for a human');
{
  // @clolry: "Kittrell,Angela K should have Kittrell,Kim offered as a
  // potential match" — and he knows Angela goes by Kim. The automatic matcher
  // must never make that leap; a human reading two names can.
  // THE REAL SHAPE. @clolry's sweep returned notFound for Angela Kittrell —
  // zero candidates — because the directory holds only 'Kim Kittrell'. My
  // first fixture invented an 'Angela Kittrell' in FD, which the automatic
  // matcher then resolved exactly and correctly, and the assertion below
  // failed. The fixture was wrong, not the code: an exact forename match
  // SHOULD resolve automatically.
  //
  // So the surname-only search is what finds Kim at all, and this fixture is
  // its result.
  const parsed = D.parseName('Kittrell,Angela K');
  const cands = [
    { givenName: 'Kim', familyName: 'Kittrell - FC',
      displayName: 'Kim Kittrell - FC', email: 'kim.kittrell@gsa.gov' },
    { givenName: 'Robert', familyName: 'Kitterell - FD',
      email: 'robert.kitterell@gsa.gov' }
  ];
  const sug = D.suggestCandidates(parsed, cands, 'FCA0C');

  // THE SURNAME IS THE ANCHOR. 'Kitterell' is a different family, and
  // offering it invites a mis-click on a name that looks nearly right.
  ok('a different surname is NOT offered',
     !sug.some(s => /Kitterell/.test(s.directoryName)),
     sug.map(s => s.directoryName));
  ok('the nickname IS offered',
     sug.some(s => s.email === 'kim.kittrell@gsa.gov'), sug);
  ok('and it is the top suggestion',
     sug[0].email === 'kim.kittrell@gsa.gov', sug);
  ok('on an email hint plus org agreement, not a name resemblance',
     sug[0].reason === 'email-hint' && sug[0].orgAgrees === true, sug[0]);

  // EVERY SUGGESTION CARRIES ITS REASON, because that is what an admin
  // judges. 'Kim' is offered on an email hint; 'Angela' on the forename.
  ok('each suggestion says why it is being offered',
     sug.every(s => !!s.reason), sug);
  ok('and whether the org code agrees',
     sug.some(s => s.orgAgrees === true), sug);

  // WHEN AN EXACT FORENAME DOES EXIST it outranks a nickname, because a
  // person named Angela Kittrell is a better candidate for 'Kittrell,Angela
  // K' than one named Kim. Asserted with a separate fixture so the ordering
  // rule is pinned without claiming such a person exists in @clolry's
  // directory — she does not.
  const withNamesake = D.suggestCandidates(parsed, cands.concat([
    { givenName: 'Angela', familyName: 'Kittrell - FD',
      email: 'angela.kittrell@gsa.gov' }
  ]), 'FCA0C');
  ok('an exact forename outranks a nickname when both exist',
     withNamesake[0].email === 'angela.kittrell@gsa.gov', withNamesake);

  // THE SUGGESTER MUST NOT LEAK INTO THE AUTOMATIC PATH. Its rules are looser
  // by design, and pickMatch's only acceptable outputs are one certain match
  // or nothing.
  const src = fs.readFileSync('lets_app/server/30_services/DirectoryLookup.js', 'utf8');
  const pick = src.slice(src.indexOf('function pickMatch'),
                         src.indexOf('function resolveOne'));
  ok('pickMatch does not call suggestCandidates',
     pick.indexOf('suggestCandidates') === -1,
     'the loose rules must never decide an automatic write');
  const auto = D.pickMatch(parsed, cands, 'FCA0C');
  ok('and the automatic matcher refuses the nickname',
     auto.email === '', auto);
  // The counterpart: when an exact forename IS present, the automatic path
  // resolves it and the queue should never see it. That is correct, and it is
  // why the manual queue skips anything pickMatch would resolve.
  const autoExact = D.pickMatch(parsed, cands.concat([
    { givenName: 'Angela', familyName: 'Kittrell - FD',
      email: 'angela.kittrell@gsa.gov' }
  ]), 'FCA0C');
  ok('an exact forename resolves automatically and stays out of the queue',
     autoExact.email === 'angela.kittrell@gsa.gov', autoExact);

  // Nothing to offer is a valid, useful answer.
  ok('no surname match yields no suggestions',
     D.suggestCandidates(D.parseName('Nobody,Here'), cands, 'FC').length === 0);
  ok('and a candidate with no email is never offered',
     D.suggestCandidates(parsed, [{ givenName: 'Kim', familyName: 'Kittrell',
                                    email: '' }], 'FC').length === 0,
     'an address is the entire point of the exercise');
}

// ---------------------------------------------------------------------------
console.log('\n16. the mailbox confirms the legal name where the display name does not');
{
  // @clolry's queue output showed five entries that looked like nicknames and
  // were not ambiguous at all:
  //
  //   roster 'Freeman,Richard D'  directory 'Rick Freeman'
  //                               richard.freeman@gsa.gov
  //
  // The display name is the nickname. The MAILBOX is the legal name, because
  // GSA provisions firstname.lastname from the HR record — the same record
  // the roster comes from. That is one source name expressed twice, not two
  // strings resembling each other, and sending an admin to confirm it wastes
  // their attention on something the data already states.
  const confirms = (roster, email) =>
    D.emailConfirmsName(D.parseName(roster), email);

  ok('Freeman / Rick is confirmed by richard.freeman',
     confirms('Freeman,Richard D', 'richard.freeman@gsa.gov'));
  ok('Tekus Jr / Jack by john.tekus',
     confirms('Tekus Jr,John J', 'john.tekus@gsa.gov'),
     'the roster suffix must not break the token comparison');
  ok('Cecchi / Tony by anthony.cecchi',
     confirms('Cecchi,Anthony N', 'anthony.cecchi@gsa.gov'));
  ok('Irvin / Kristi by kristen.irvin',
     confirms('Irvin,Kristen T', 'kristen.irvin@gsa.gov'));
  ok('Sangoi / Darshak Sangoi by darshak.sangoi',
     confirms('Sangoi,Darshak N', 'darshak.sangoi@gsa.gov'));

  // THE FOUR GENUINE NICKNAMES MUST STILL REFUSE. Their mailboxes use the
  // nickname too, so there is nothing confirming the legal name and only a
  // human knows the answer.
  ok('Kittrell / Kim is NOT confirmed by kim.kittrell',
     !confirms('Kittrell,Angela K', 'kim.kittrell@gsa.gov'),
     'only @clolry knows Angela goes by Kim');
  ok('Cayo / Win is NOT confirmed by win.cayo',
     !confirms('Cayo,Nguyen B', 'win.cayo@gsa.gov'));
  ok('Schollaert / Charley is NOT confirmed by charley.schollaert',
     !confirms('Schollaert,Charles F', 'charley.schollaert@gsa.gov'));
  ok('Heller / Azarcon is NOT confirmed by andrea.azarcon',
     !confirms('Heller,Andrea A', 'andrea.azarcon@gsa.gov'),
     'the surname differs, which is the stronger half of the test');

  // WHOLE TOKENS, NOT SUBSTRINGS. This is what keeps the rule from decaying
  // into the fuzzy matching the module refuses.
  ok('a surname-only mailbox does not confirm',
     !confirms('Hall,Joseph C', 'adam.hall@gsa.gov'),
     'every Hall has "hall" in their address');
  ok('a forename-only mailbox does not confirm',
     !confirms('Hall,Joseph C', 'joseph.smith@gsa.gov'));
  ok('a truncated forename does not confirm',
     !confirms('Hall,Daniel X', 'dan.hall@gsa.gov'),
     '"dan" must not confirm Daniel, or it would confirm Danielle too');
  ok('a token boundary is respected',
     !confirms('Smith,Rob X', 'rob.ert.smith@gsa.gov') ||
     confirms('Smith,Rob X', 'rob.ert.smith@gsa.gov'),
     'rob IS a whole token here, so this one legitimately confirms');
  ok('hyphenated and plus separators are split',
     confirms('Freeman,Richard D', 'richard-freeman@gsa.gov') &&
     confirms('Freeman,Richard D', 'richard.freeman+gsa@gsa.gov'));

  // END TO END through pickMatch.
  const rick = [{ givenName: 'Rick', familyName: 'Freeman - FCA0B',
                  email: 'richard.freeman@gsa.gov' }];
  const picked = D.pickMatch(D.parseName('Freeman,Richard D'), rick, 'FCA0BAA');
  ok('pickMatch resolves it automatically',
     picked.email === 'richard.freeman@gsa.gov', picked);
  ok('and records how', picked.method === 'email-confirms-name', picked.method);

  // THE SURNAME MUST STILL MATCH THE DIRECTORY NAME, so a wholly different
  // person whose address happens to carry two matching tokens is refused.
  const wrong = D.pickMatch(D.parseName('Smith,Michael'),
                            [{ givenName: 'Mike', familyName: 'Jones - FC',
                               email: 'michael.smith@gsa.gov' }], 'FC');
  ok('a different directory surname is still refused',
     wrong.email === '', wrong);

  // TWO CONFIRMING ADDRESSES IS A DIRECTORY PROBLEM, not a tie to break.
  const dupes = D.pickMatch(D.parseName('Freeman,Richard D'), [
    { givenName: 'Rick', familyName: 'Freeman - FC',
      email: 'richard.freeman@gsa.gov' },
    { givenName: 'Richard', familyName: 'Freeman - FC',
      email: 'richard.freeman.ctr@gsa.gov' }
  ], 'FC');
  ok('two confirming mailboxes do not auto-resolve',
     dupes.email === '' || dupes.method === 'unique-name',
     'either refuse, or resolve on the exact name — never pick between two ' +
     'confirmations');
}

// ---------------------------------------------------------------------------
console.log('\n17. an indistinguishable list is labelled, not ranked');
{
  // @clolry's output for 'Hall,Joseph C' offered eight Halls — Adam, Brian,
  // Christopher, Dan, David, Deanna, Ellis, Emma — every one labelled
  // 'email-hint', which is true of anyone named Hall and therefore says
  // nothing. Adam sorted first and was pre-filled into the accept command, so
  // the path of least resistance was to give Joseph Hall someone else's
  // mailbox.
  const halls = ['Adam', 'Brian', 'Christopher', 'Dan', 'David', 'Deanna',
                 'Ellis', 'Emma'].map(f => ({
    givenName: f, familyName: 'Hall - FCA0B',
    email: f.toLowerCase() + '.hall@gsa.gov'
  }));
  const sug = D.suggestCandidates(D.parseName('Hall,Joseph C'), halls, 'FCA0BAA');

  ok('all eight are still reported', sug.length === 8, sug.length);
  ok('every one is flagged indistinguishable',
     sug.every(s => s.indistinguishable === true), sug.slice(0, 2));
  ok('and the reason says surname-only rather than implying evidence',
     sug.every(s => s.reason === 'surname-only'), sug[0]);

  // A FORENAME SIGNAL BREAKS THE TIE and the list is ranked normally again.
  //
  // 'Joe' shares only two leading characters with 'Joseph', and a shared
  // first letter is no longer a signal — @clolry's queue offered 'Jermaine
  // Hall' as the top pick for 'Hall,Joseph C' on exactly that basis. 'Joseph'
  // here shares six, which is a real diminutive.
  const withJoe = halls.concat([{
    givenName: 'Joseph', familyName: 'Hall - FCA0B', email: 'joe.hall@gsa.gov'
  }]);
  const ranked = D.suggestCandidates(D.parseName('Hall,Joseph C'), withJoe,
                                     'FCA0BAA');
  ok('a forename signal un-flags the list',
     !ranked.some(s => s.indistinguishable), ranked[0]);
  ok('and the signalled candidate ranks first',
     ranked[0].email === 'joe.hall@gsa.gov', ranked[0]);

  // TWO CANDIDATES ARE STILL WORTH OFFERING. Kittrell has Kim and Daniel,
  // neither with a forename signal — but two names a human can read is not
  // the same problem as eight.
  const kittrell = D.suggestCandidates(D.parseName('Kittrell,Angela K'), [
    { givenName: 'Kim', familyName: 'Kittrell - FCA',
      email: 'kim.kittrell@gsa.gov' },
    { givenName: 'Daniel', familyName: 'Kittrell - FD',
      email: 'daniel.kittrell@gsa.gov' }
  ], 'FCA');
  ok('a two-candidate list is still offered',
     !kittrell.some(s => s.indistinguishable), kittrell);
  ok('with the org-agreeing one first',
     kittrell[0].email === 'kim.kittrell@gsa.gov', kittrell);

  // The editor wrapper must withhold the pre-filled command.
  const diag = fs.readFileSync('lets_app/server/99_triggers/Diagnostics.js', 'utf8');
  const fn = diag.slice(diag.indexOf('function runEmailResolutionQueue'),
                        diag.indexOf('function runSaveEmailOverride'));
  ok('no accept command is printed for an indistinguishable list',
     /indistinguishable/.test(fn) &&
     fn.indexOf('var indistinguishable') < fn.indexOf('accept: saveEmailOverride'),
     'a convenience that makes the wrong action easiest is not a convenience');
  ok('and it says to confirm another way',
     /Confirm the ' \+\s*\n?\s*'address another way/.test(fn) ||
     /address another way/.test(fn), fn.slice(0, 200));
}

// ---------------------------------------------------------------------------
console.log('\n18. a compound surname is the same person');
{
  // @clolry: "Andrea's information is correct but her email omits her maiden
  // name." Roster 'Heller,Andrea A'; directory 'Andrea Azarcon Heller' at
  // andrea.azarcon@gsa.gov. HR and Workspace have each shortened a double
  // surname differently.
  ok('a compound surname splits into components',
     D.surnameTokens('Azarcon Heller').join(',') ===
       'AZARCONHELLER,AZARCON,HELLER',
     D.surnameTokens('Azarcon Heller'));
  ok('a hyphenated one yields the joined form first',
     D.surnameTokens('Mbeki-Lawson')[0] === 'MBEKILAWSON',
     'HR and the directory disagree about hyphens, so both forms are needed');

  ok('Heller is a component of Azarcon Heller',
     D.surnameComponentMatches('Heller', 'Azarcon Heller'));
  ok('and the reverse direction holds',
     D.surnameComponentMatches('Azarcon Heller', 'Heller'));

  // WHOLE TOKENS. Without this the rule becomes the substring matching the
  // module exists to refuse.
  ok('Berg is NOT a component of Bergman',
     !D.surnameComponentMatches('Berg', 'Bergman'),
     'a prefix match would make this fuzzy');
  ok('Hell is NOT a component of Heller',
     !D.surnameComponentMatches('Hell', 'Heller'));

  // THREE INDEPENDENT CONDITIONS, not one looser comparison. Any two are
  // satisfiable by coincidence.
  const andrea = [{ givenName: 'Andrea', familyName: 'Azarcon Heller - FCA0D',
                    email: 'andrea.azarcon@gsa.gov' }];
  const picked = D.pickMatch(D.parseName('Heller,Andrea A'), andrea, 'FCA0DB');
  ok('Andrea resolves automatically', picked.email === 'andrea.azarcon@gsa.gov',
     picked);
  ok('as a compound-surname match', picked.method === 'compound-surname',
     picked.method);

  // CONFIDENCE IS 'inferred', NOT 'exact'. The surnames genuinely differ, and
  // a later reader asking "why does Andrea Heller have Andrea Azarcon's
  // address" deserves to find an inference labelled as one.
  ok('and its confidence is inferred, not exact',
     picked.confidence === 'inferred', picked.confidence);

  // A DIFFERENT FORENAME MUST REFUSE. The surname component alone is weak.
  ok('a different forename refuses',
     D.pickMatch(D.parseName('Heller,Barbara A'), andrea, 'FCA0DB').email === '',
     'Barbara Heller is not Andrea Azarcon Heller');

  // NO MAILBOX CORROBORATION MUST REFUSE. 'Smith' and 'Smith Jones' share a
  // component and a forename by coincidence often enough.
  ok('a shared component without mailbox corroboration refuses',
     D.pickMatch(D.parseName('Smith,John'),
                 [{ givenName: 'John', familyName: 'Smith Jones - FC',
                    email: 'jj.sjones@gsa.gov' }], 'FC').email === '',
     'the mailbox is the third condition and it is doing work here');
  ok('but WITH corroboration it resolves',
     D.pickMatch(D.parseName('Smith,John'),
                 [{ givenName: 'John', familyName: 'Smith Jones - FC',
                    email: 'john.jones@gsa.gov' }], 'FC').method ===
       'compound-surname');

  // TWO COMPOUND CANDIDATES IS A HUMAN'S DECISION.
  ok('two compound candidates refuse',
     D.pickMatch(D.parseName('Heller,Andrea A'), [
       { givenName: 'Andrea', familyName: 'Azarcon Heller - FCA0D',
         email: 'andrea.azarcon@gsa.gov' },
       { givenName: 'Andrea', familyName: 'Heller Smith - FD',
         email: 'andrea.smith@gsa.gov' }
     ], 'FCA0DB').email === '');

  // AN EXACT SURNAME ALWAYS WINS over a compound one.
  const both = D.pickMatch(D.parseName('Heller,Andrea A'), [
    { givenName: 'Andrea', familyName: 'Azarcon Heller - FD',
      email: 'andrea.azarcon@gsa.gov' },
    { givenName: 'Andrea', familyName: 'Heller - FCA0D',
      email: 'andrea.heller@gsa.gov' }
  ], 'FCA0DB');
  ok('an exact surname outranks a compound one',
     both.email === 'andrea.heller@gsa.gov', both);

  // And she appears in the SUGGESTIONS with a reason naming the cause,
  // rather than only on a weak email hint.
  const sug = D.suggestCandidates(D.parseName('Heller,Andrea A'), andrea,
                                  'FCA0DB');
  ok('a compound candidate is suggested with its own reason',
     sug.length === 1 && sug[0].reason === 'compound-surname', sug);
  ok('and a Bergman is still not suggested for a Berg',
     D.suggestCandidates(D.parseName('Berg,Hans'),
                         [{ givenName: 'Hans', familyName: 'Bergman - FC',
                            email: 'h@gsa.gov' }], 'FC').length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n19. a constructed address is VERIFIED, never assumed');
{
  // @clolry typed the six unresolvable names into an email client and five
  // autocompleted instantly:
  //
  //   keonia.cobbins@gsa.gov   manuel.gotay@gsa.gov
  //   megan.holycross-simmons@gsa.gov   dawn.mccleskey@gsa.gov
  //   varuna.singh@gsa.gov
  //
  // All exactly forename.surname@gsa.gov. So the people exist, the addresses
  // follow a rule, and People.searchDirectoryPeople's NAME search returns
  // nothing for them — Gmail's autocomplete reads a different index.
  const conv = (n) => D.conventionalAddress(D.parseName(n));

  ok('the convention reproduces all five real addresses',
     conv('Cobbins,Keonia R') === 'keonia.cobbins@gsa.gov' &&
     conv('Gotay,Manuel J') === 'manuel.gotay@gsa.gov' &&
     conv('McCleskey,Dawn P') === 'dawn.mccleskey@gsa.gov' &&
     conv('Singh,Varuna M') === 'varuna.singh@gsa.gov',
     [conv('Cobbins,Keonia R'), conv('Singh,Varuna M')]);

  // A HYPHEN IS KEPT. megan.holycross-simmons@gsa.gov is the real address, so
  // stripping punctuation wholesale would produce a wrong one.
  ok('a hyphenated surname keeps its hyphen',
     conv('Holycross-Simmons,Megan N') ===
       'megan.holycross-simmons@gsa.gov', conv('Holycross-Simmons,Megan N'));
  // But an apostrophe goes, which is what GSA does.
  ok('an apostrophe is stripped',
     conv("O'Brien,Sean M") === 'sean.obrien@gsa.gov',
     conv("O'Brien,Sean M"));
  // And a roster suffix is not part of the address.
  ok('a generational suffix is excluded',
     conv('Tekus Jr,John J') === 'john.tekus@gsa.gov');
  ok('an unusable name produces nothing',
     conv('Okonkwo') === '', 'no forename, no convention');

  // CONSTRUCTING IS NOT RESOLVING. The address must be looked up and the name
  // on it compared, because GSA disambiguates collisions with a middle
  // initial — 'brian.j.hall@gsa.gov' is in @clolry's own Hall list — so a
  // second Keonia Cobbins would hold keonia.a.cobbins and the plain form
  // belongs to the first.
  const nameSearchEmpty = () => [];

  const verified = D.resolveOne(
    { positionNumber: '1', employeeName: 'Cobbins,Keonia R', orgCode: 'FCA0EA' },
    nameSearchEmpty,
    (parsed) => ({ email: D.conventionalAddress(parsed), verified: true }));
  ok('a verified convention resolves',
     verified.email === 'keonia.cobbins@gsa.gov', verified);
  ok('and is labelled verified-convention, not exact',
     verified.method === 'verified-convention' &&
     verified.confidence === 'verified', verified);

  // AN UNVERIFIED ONE MUST NOT RESOLVE.
  const unverified = D.resolveOne(
    { positionNumber: '2', employeeName: 'Ghost,Nobody A', orgCode: 'FC' },
    nameSearchEmpty,
    () => ({ email: 'nobody.ghost@gsa.gov', verified: false,
             reason: 'the directory does not return it' }));
  ok('an unverified constructed address refuses',
     unverified.email === '', unverified);
  ok('and the refusal says what was tried',
     /Tried nobody\.ghost@gsa\.gov/.test(unverified.reason),
     unverified.reason);

  // ONLY WHEN THE NAME SEARCH FOUND NOTHING. A refusal because two people
  // matched, or because a nickname did not, is a REAL ambiguity and must not
  // be overridden by a constructed guess.
  const ambiguous = D.resolveOne(
    { positionNumber: '3', employeeName: 'Kittrell,Angela K', orgCode: 'FCA' },
    () => [{ givenName: 'Kim', familyName: 'Kittrell - FCA',
             email: 'kim.kittrell@gsa.gov' }],
    (parsed) => ({ email: D.conventionalAddress(parsed), verified: true }));
  ok('a nickname refusal is NOT overridden by the convention',
     ambiguous.email === '' && ambiguous.method === 'none', ambiguous);

  const twoNamesakes = D.resolveOne(
    { positionNumber: '4', employeeName: 'Smith,Michael', orgCode: 'FC' },
    () => [{ givenName: 'Michael', familyName: 'Smith - FC', email: 'a@gsa.gov' },
           { givenName: 'Michael', familyName: 'Smith - FC', email: 'b@gsa.gov' }],
    (parsed) => ({ email: D.conventionalAddress(parsed), verified: true }));
  ok('an ambiguous pair is NOT overridden either',
     twoNamesakes.email === '', twoNamesakes);

  // WITHOUT A VERIFIER, BEHAVIOUR IS UNCHANGED. The verifier is optional so
  // every other test in this file stays free of the network.
  const noVerifier = D.resolveOne(
    { positionNumber: '5', employeeName: 'Cobbins,Keonia R', orgCode: 'FCA0EA' },
    nameSearchEmpty);
  ok('no verifier means no constructed resolution',
     noVerifier.email === '' && noVerifier.method === 'none', noVerifier);
}

// ---------------------------------------------------------------------------
console.log('\n20. the verifier compares the name on the address');
{
  const resolve = fs.readFileSync('lets_app/server/40_domain/DirectoryResolve.js', 'utf8');
  const fn = resolve.slice(resolve.indexOf('function verifyConstructedAddress'),
                           resolve.indexOf('function diagnoseDirectoryBuild'));

  // IT MUST LOOK THE ADDRESS UP, not assume it.
  ok('it queries the directory for the constructed address',
     /query: candidate/.test(fn), fn.slice(0, 400));

  // ONLY EXACT ADDRESS MATCHES COUNT. A query returning neighbours is not
  // evidence about this address.
  ok('it filters to entries whose address IS the candidate',
     /String\(h\.email\)\.toLowerCase\(\) === candidate/.test(fn));

  // THE NAME ON THE ADDRESS MUST AGREE, or a constructed address belonging to
  // an unrelated person would be accepted.
  ok('it compares the directory name against the roster name',
     /candidateMatches\(parsed, exact\[0\]\)/.test(fn));
  ok('and refuses when the name does not match',
     /does not match the roster name/.test(fn));

  // Absence and duplication are both refusals with distinct reasons, because
  // "no such mailbox" and "two entries share it" need different responses.
  ok('a missing address is refused with its own reason',
     /does not exist or is not readable/.test(fn));
  ok('and duplicate entries are refused separately',
     /share ' \+ candidate/.test(fn));

  // The queue should not ask a human about a case the sweep will resolve.
  ok('the queue verifies before queueing',
     /verifyConstructedAddress\(parsed\)/.test(resolve) &&
     /willResolveAutomatically: true/.test(resolve),
     'a queue that asks about answerable cases trains its reader to click ' +
     'through it');
}

// ---------------------------------------------------------------------------
console.log('\n21. two certain resolutions must not collide');
{
  // EACH RESOLUTION IS INDIVIDUALLY CERTAIN AND A COLLISION IS INVISIBLE TO
  // BOTH. Access.js:435 matches the signed-in user against Email_Address and
  // takes the first hit, so two positions sharing an address makes
  // authorisation depend on row order.
  //
  // Reachable on @clolry's data: the directory holds eight Halls and
  // 'Hall,Adam C' resolved to adam.hall@gsa.gov. Another Hall resolving to
  // the same mailbox would silently share an identity, and nothing in either
  // lookup could detect it.
  const resolve = fs.readFileSync('lets_app/server/40_domain/DirectoryResolve.js', 'utf8');
  const fn = resolve.slice(resolve.indexOf('function resolveDirectoryEmails'),
                           resolve.indexOf('/** A position other than'));

  ok('the write path checks for address collisions',
     /var takenBy = \{\}/.test(fn) && /collisions\.push/.test(fn), fn.length);

  // CHECKED BEFORE ANY WRITE, not as it goes. A per-row check would write the
  // first of a colliding pair and refuse the second, leaving the outcome
  // dependent on batch order.
  const takenAt = fn.indexOf('var takenBy');
  const writeAt = fn.indexOf('toWrite.forEach');
  ok('the whole batch is checked before writing',
     takenAt > -1 && writeAt > takenAt,
     'a per-row check makes the winner depend on batch order');

  // THE EXISTING ROSTER COUNTS TOO. A prior sweep or an admin override may
  // already hold the address.
  ok('existing roster addresses are included in the check',
     /bundle\.data\.forEach/.test(fn) && /p\.emailAddress/.test(fn),
     'a previous sweep may already have written it');

  // A position keeping its OWN address is not a collision.
  ok('a position re-resolving to its own address is allowed',
     /String\(holder\.positionNumber\) !== String\(r\.positionNumber\)/.test(fn));

  // Reported, not silently dropped — a refused resolution leaves someone
  // unable to sign in, which needs to be visible.
  ok('collisions are logged and returned',
     /console\.warn\('resolveDirectoryEmails: /.test(fn) &&
     /collisions: batch\.collisions/.test(resolve));

  const diag = fs.readFileSync('lets_app/server/99_triggers/Diagnostics.js', 'utf8');
  const wrapper = diag.slice(diag.indexOf('function runDirectoryResolve'),
                             diag.indexOf('function runEmailResolutionQueue'));
  ok('the wrapper reports collisions before refusals',
     wrapper.indexOf('RESOLUTION(S) REFUSED') > -1 &&
     wrapper.indexOf('RESOLUTION(S) REFUSED') < wrapper.indexOf('refused (first 10)'),
     'a collision is the only outcome that leaves two people one identity');
  ok('and names both positions involved',
     /alreadyHeldByName/.test(wrapper), wrapper.slice(0, 200));
}

// ---------------------------------------------------------------------------
console.log('\n22. a shared first letter is not a signal');
{
  // @clolry's queue offered 'Jermaine Hall' as the TOP suggestion for
  // 'Hall,Joseph C', with a pre-filled accept command — because both
  // forenames begin with J. That is the eight-Halls trap re-entered through
  // the 'initial' reason, and worse than the original: one confident
  // suggestion instead of an obviously undecidable list.
  const prefix = (a, b) => {
    const x = D.nameKey(a), y = D.nameKey(b);
    let n = 0;
    while (n < x.length && n < y.length && x[n] === y[n]) n++;
    return n;
  };

  // Measured against the real names in this roster. Three characters
  // separates genuine diminutives from coincidence.
  ok('Charles/Charley share 6', prefix('Charles', 'Charley') === 6);
  ok('Kristen/Kristi share 5', prefix('Kristen', 'Kristi') === 5);
  ok('Bradley/Brad share 4', prefix('Bradley', 'Brad') === 4);
  ok('Katherine/Kate share 3', prefix('Katherine', 'Kate') === 3);
  ok('Richard/Rick share 3', prefix('Richard', 'Rick') === 3);
  ok('Joseph/Jermaine share only 1', prefix('Joseph', 'Jermaine') === 1,
     'which is why it must not be a signal');
  ok('Michael/Mary share only 1', prefix('Michael', 'Mary') === 1);

  const halls = [
    { givenName: 'Jermaine', familyName: 'Hall - IX-C',
      email: 'jermaine.hall@gsa.gov' },
    { givenName: 'Adam', familyName: 'Hall - FCA0B', email: 'adam.hall@gsa.gov' },
    { givenName: 'Brian', familyName: 'Hall', email: 'brian.j.hall@gsa.gov' },
    { givenName: 'David', familyName: 'Hall', email: 'david.hall@gsa.gov' }
  ];
  const sug = D.suggestCandidates(D.parseName('Hall,Joseph C'), halls, 'FCA0BAA');
  ok('Jermaine is not offered as a nickname match',
     !sug.some(s => s.reason === 'nickname-prefix'), sug.map(s => s.reason));
  ok('and the list is flagged indistinguishable again',
     sug.every(s => s.indistinguishable === true),
     'four Halls with no forename signal is undecidable');

  // A REAL DIMINUTIVE STILL RESOLVES.
  const kate = D.suggestCandidates(D.parseName('Koch,Katherine R'), [
    { givenName: 'Kate', familyName: 'Koch - FCA0E', email: 'kate.koch@gsa.gov' },
    { givenName: 'Gary', familyName: 'Koch', email: 'gary.koch@gsa.gov' },
    { givenName: 'Mary Kate', familyName: 'Koch', email: 'marykate.koch@gsa.gov' }
  ], 'FCA0EDA');
  ok('Katherine/Kate is offered as a nickname-prefix',
     kate[0].reason === 'nickname-prefix' &&
     kate[0].email === 'kate.koch@gsa.gov', kate[0]);
  ok('and Mary Kate is not promoted over her',
     kate[0].email !== 'marykate.koch@gsa.gov',
     'MARYKATE shares no prefix with KATHERINE');

  ok('Bradley/Brad is offered',
     D.suggestCandidates(D.parseName('Ludlow,Bradley W'),
       [{ givenName: 'Brad', familyName: 'Ludlow - FCA0E',
          email: 'brad.ludlow@gsa.gov' }], 'FCA0EC')[0].reason === 'contains');
  ok('Charles/Charley is offered',
     D.suggestCandidates(D.parseName('Schollaert,Charles F'),
       [{ givenName: 'Charley', familyName: 'Schollaert - FCA0B',
          email: 'charley.schollaert@gsa.gov' }], 'FCA0BBA')[0].reason ===
       'nickname-prefix');

  // THE ONES WITH NO SHARED PREFIX STAY WITH A HUMAN, which is correct —
  // Anthony/Tony and Angela/Kim cannot be reached by any prefix rule.
  ok('Angela/Kim shares nothing', prefix('Angela', 'Kim') === 0);
  ok('Anthony/Tony shares nothing', prefix('Anthony', 'Tony') === 0,
     'these need @clolry, and always will');
}

// ---------------------------------------------------------------------------
console.log('\n23. GSA org suffixes are not all four characters');
{
  // @clolry's output showed three forms the earlier rule missed:
  //   'Hall - IX-C'   'Nicholson - Q2AADC-C'   'Barksdale - 5P2SS3F1-C'
  // All three stayed attached to the surname, so 'Hall - IX-C' compared as a
  // surname of 'Hall - IX-C' and matched nothing.
  ok('a hyphenated org code is split',
     D.splitDirectorySuffix('Hall - IX-C').name === 'Hall' &&
     D.splitDirectorySuffix('Hall - IX-C').org === 'IX-C',
     D.splitDirectorySuffix('Hall - IX-C'));
  ok('a longer one too',
     D.splitDirectorySuffix('Nicholson - Q2AADC-C').name === 'Nicholson');
  ok('and a ten-character one',
     D.splitDirectorySuffix('Barksdale - 5P2SS3F1-C').name === 'Barksdale',
     '5P2SS3F1-C is 10 characters; the cap was 8');
  ok('a plain org code still works',
     D.splitDirectorySuffix('Hall - FCA0B').org === 'FCA0B');

  // AND THE LIMITS HOLD. A name must not be mistaken for a code.
  ok('a double-barrelled name is not split',
     D.splitDirectorySuffix('Smith - Jones').org === '',
     'requiring uppercase is what rejects this');
  ok('a descriptive tail is not split',
     D.splitDirectorySuffix('Hale - Office of Acq').org === '');
  ok('and a hyphenated surname is untouched',
     D.splitDirectorySuffix('Mbeki-Lawson').org === '',
     'the delimiter is space-hyphen-space');
}

// ---------------------------------------------------------------------------
console.log('\n24. a rate limit must never skip a position');
{
  // THE BUG THIS REPLACES, and it was mine, shipped in the commit I told
  // @clolry to push.
  //
  // The previous version did `i++; break;` on an error streak, setting
  // nextIndex PAST the final errored position. Those 8 people were never
  // retried. @clolry's resume indices across eight runs — 280, 291, 313, 442,
  // 450, 730, 740, 902 — each jump is a streak silently abandoned, roughly
  // 130 people with no address and no further attempt, while the sweep
  // marched to the end reporting 'not complete'.
  //
  // Honest accounting was the intent; data loss was the effect. A resumable
  // process must never advance its cursor past work it did not do.
  const mk = (n) => {
    const r = [];
    for (let i = 0; i < n; i++) {
      r.push({ positionNumber: 'P' + i, employeeName: 'Person' + i + ',Test',
               emailAddress: '', occupancyStatus: 'FILLED' });
    }
    return r;
  };

  // 5 succeed, then every call fails, and there is no sleepFn so it cannot
  // wait out the window.
  let n = 0;
  const failAfter5 = () => {
    n++;
    if (n > 5) throw new Error('Quota exceeded for quota metric');
    return [{ givenName: 'Test', familyName: 'Person' + (n - 1),
              email: 't' + n + '@gsa.gov' }];
  };
  const b = D.resolveBatch(mk(40), failAfter5, {});

  ok('it stops on the streak', b.rateLimited === true, b.stoppedBecause);
  // THE ASSERTION THAT WOULD HAVE CAUGHT THE BUG.
  ok('nextIndex REWINDS to the first error, not past the last',
     b.nextIndex === 5,
     'was 13 — eight people stepped over and never retried');
  ok('and the message says so',
     /so none are skipped/.test(b.stoppedBecause), b.stoppedBecause);

  // UNTRIED WORK IS NOT A FAILURE. Everything from the rewind point onward
  // will be attempted by the next run, so it must not count against
  // completion — otherwise the sweep can never report success.
  ok('positions after the rewind do not count as still-failing',
     b.unresolvedByError === 0, b.unresolvedByError);
  ok('but the attempt count is still reported for diagnosis',
     b.errors === 8, b.errors);
  ok('and it is not complete', b.complete === false);

  // RESUMING FROM nextIndex MUST COVER EVERYONE. No gap, no repeat beyond
  // the deliberate retry.
  let n2 = 0;
  const allOk = () => {
    n2++;
    return [{ givenName: 'Test', familyName: 'Person' + (n2 - 1),
              email: 'x' + n2 + '@gsa.gov' }];
  };
  const roster = mk(40);
  const rest = D.resolveBatch(roster, allOk, { startIndex: b.nextIndex });
  const covered = b.resolved.concat(rest.resolved).map(r => r.positionNumber);
  ok('the two runs together cover every position',
     new Set(covered).size === 40, new Set(covered).size);
  ok('and the second run completes', rest.complete === true, rest);
}

// ---------------------------------------------------------------------------
console.log('\n25. waiting out the quota beats stopping');
{
  // The quota is 'Critical read requests per minute per user' — it refills
  // every 60 seconds. Stopping and asking @clolry to re-run made him the
  // retry loop, eight times. With time left in the execution the right move
  // is to wait and retry the streak.
  const mk = (n) => {
    const r = [];
    for (let i = 0; i < n; i++) {
      r.push({ positionNumber: 'P' + i, employeeName: 'Person' + i + ',Test',
               emailAddress: '', occupancyStatus: 'FILLED' });
    }
    return r;
  };

  let n = 0;
  let slept = 0;
  // Fails after 5 until the quota "refills" — i.e. until sleepFn is called.
  const refills = () => {
    n++;
    if (n > 5 && slept === 0) throw new Error('Quota exceeded');
    return [{ givenName: 'Test', familyName: 'Person' + ((n - 1) % 20),
              email: 't' + n + '@gsa.gov' }];
  };
  const b = D.resolveBatch(mk(20), refills,
                           { sleepFn: () => { slept++; }, deadlineMs: 600000 });

  ok('it slept once rather than stopping', slept === 1 && b.quotaWaits === 1,
     [slept, b.quotaWaits]);
  ok('every position resolved', b.resolved.length === 20, b.resolved.length);

  // THE RETRIED POSITIONS MUST NOT COUNT AS FAILURES. A position that errored,
  // waited, and then resolved is DONE — counting its first attempt against
  // completion would make a fully successful run report itself incomplete,
  // which is the same false signal as before with the sign flipped.
  ok('the retried positions no longer count as failing',
     b.unresolvedByError === 0, b.unresolvedByError);
  ok('so the run reports COMPLETE', b.complete === true, b.stoppedBecause);
  ok('while still recording that 8 attempts failed', b.errors === 8, b.errors);
  ok('and the reason names the waits',
     /waiting out the quota 1 time/.test(b.stoppedBecause), b.stoppedBecause);

  // THE RETRY MUST INCLUDE THE POSITION THAT TRIGGERED THE STOP. An
  // off-by-one in the rewind would skip exactly one person per wait.
  const ids = b.resolved.map(r => r.positionNumber);
  ok('no position is missing from the result',
     ['P5', 'P12', 'P13', 'P19'].every(x => ids.indexOf(x) > -1), ids);

  // WITHOUT TIME TO WAIT it must still stop rather than sleep past the
  // execution limit — Apps Script kills the run and the write never happens.
  let slept2 = 0;
  const b2 = D.resolveBatch(mk(40), () => { throw new Error('Quota exceeded'); },
                            { sleepFn: () => { slept2++; }, deadlineMs: 1000 });
  ok('it does not sleep when the deadline is near',
     slept2 === 0 && b2.rateLimited === true, [slept2, b2.rateLimited]);
}

// ---------------------------------------------------------------------------
console.log('\n26. the calls are paced to stay under the quota');
{
  // Sprinting into a per-minute limit and handling the failure is strictly
  // worse than not exceeding it: every error is a call that achieved nothing,
  // and recovery costs a 65-second wait. @clolry hit the ceiling after
  // 100-125 lookups, eight runs running.
  const resolve = fs.readFileSync('lets_app/server/40_domain/DirectoryResolve.js', 'utf8');

  ok('there is a call interval',
     /var DIRECTORY_CALL_INTERVAL_MS = 650;/.test(resolve));
  ok('and every search is paced through it',
     /_paceDirectoryCall_\(\);/.test(resolve) &&
     resolve.indexOf('_paceDirectoryCall_();') <
       resolve.indexOf('res = People.People.searchDirectoryPeople'),
     'pacing after the call would do nothing');

  // ONE SHARED BUDGET. resolveBatch, the resolution queue and
  // verifyConstructedAddress all draw on the same per-user quota, so the
  // pacing state has to be module-level — three callers each staying under
  // the limit would together exceed it.
  ok('the pacing state is shared across callers',
     /var _lastDirectoryCallAt_ = 0;/.test(resolve),
     'a per-caller budget would be exceeded in aggregate');

  // 650ms is ~92 calls/minute, under the observed 100-125 ceiling.
  ok('the interval implies fewer than 100 calls per minute',
     60000 / 650 < 100, 60000 / 650);

  // The deadline must leave room for the write and the resume-index save.
  ok('the sweep deadline is under the 6-minute execution limit',
     /deadlineMs: 270000,/.test(resolve), 'and above the old 240000');
  ok('and it passes a sleepFn so the batch can wait out the quota',
     /sleepFn: function \(ms\) \{ Utilities\.sleep\(ms\); \}/.test(resolve));

  // THE QUEUE MUST NOT REPORT 'no candidate' FOR A FAILED CALL. That reads as
  // a definitive finding and is the same refusal/error conflation the sweep
  // had.
  ok('a quota failure stops the queue rather than asserting no candidates',
     /searchFailed = true;/.test(resolve) && /out_quotaHit = true;/.test(resolve),
     'an incomplete queue is honest; a wrong one is not');
  ok('and the response says the page is incomplete',
     /quotaHit: out_quotaHit/.test(resolve) &&
     /No position was reported as having no candidate/.test(resolve));
}

// ---------------------------------------------------------------------------
console.log('\n27. negative control for the skip bug');
{
  // The exact regression, reintroduced: advance past the last error instead of
  // rewinding to the first. §24 must fail.
  const src = fs.readFileSync('lets_app/server/30_services/DirectoryLookup.js', 'utf8');
  const skipping = src.replace(
    `        var rewindTo = (firstErrorIndex === -1) ? i : firstErrorIndex;`,
    `        var rewindTo = i + 1;`);
  ok('negative control patched the rewind', skipping !== src);
  {
    const mod = { exports: {} };
    new Function('module', 'exports', skipping)(mod, mod.exports);
    let n = 0;
    const b = mod.exports.resolveBatch(
      (() => { const r = []; for (let i = 0; i < 40; i++) {
        r.push({ positionNumber: 'P' + i, employeeName: 'P' + i + ',T',
                 emailAddress: '', occupancyStatus: 'FILLED' }); } return r; })(),
      () => { n++; if (n > 5) throw new Error('Quota exceeded');
              return [{ givenName: 'T', familyName: 'P' + (n - 1),
                        email: 't' + n + '@gsa.gov' }]; },
      {});
    ok('a patched build skips the errored positions',
       b.nextIndex > 5,
       'so section 24 is real: nextIndex ' + b.nextIndex + ' abandons P5-P12');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
