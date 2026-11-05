/**
 * Automated Verification Script for HCData's chunked cache.
 *
 * WHY THIS EXISTS
 * ---------------
 * @clolry's roster import produced:
 *
 *   HC: payload 514154 bytes exceeds the 90000-byte cache limit for
 *   "hc_bundle_v1". Serving uncached.
 *
 * 1,046 positions is 514KB — 5.7x CacheService's single-entry cap. The guard
 * did its job: it refused the put rather than letting CacheService reject it
 * silently, and it named the fix. But "serving uncached" means _buildBundle_
 * reads both HC tabs and re-runs the org join on EVERY call, and hcGetBundle is
 * called by the access gate on every page load, by both reviewer dashboards, by
 * the budget dashboard and by the org chart.
 *
 * Several seconds of sheet reads per page, forever, is not a stable state — and
 * it presents as "the app got slow" rather than as a cache that stopped
 * working.
 *
 * THE FAILURE THIS GUARDS AGAINST
 * -------------------------------
 * A truncated roster is valid JSON of the right shape. A reader that found
 * chunk 0 and assumed the rest were present would deserialize, say, 900 of
 * 1,046 people — and that is indistinguishable from 146 people having left.
 * Nothing would error. The access gate would deny those people, the org chart
 * would omit them, and every per-capita budget share would shift.
 *
 * CacheService evicts individual entries under memory pressure, so a partial
 * chunk set is not a hypothetical. §3 is the section that matters.
 *
 * Run: node lets_app/test_hc_chunked_cache.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else {
    console.log('  FAIL', n, x === undefined ? '' : String(x).slice(0, 300));
    fails++;
  }
};

/**
 * A CacheService stand-in that records calls and can evict.
 *
 * Mimics the two behaviors that matter: a 100KB per-entry cap that REJECTS
 * rather than truncating, and independent expiry of individual keys.
 */
function makeCache() {
  const store = {};
  const calls = { put: 0, putAll: 0, get: 0, getAll: 0, removeAll: 0 };
  return {
    store, calls,
    put(k, v) {
      calls.put++;
      if (String(v).length > 100000) {
        throw new Error('Argument too large: value');
      }
      store[k] = String(v);
    },
    putAll(obj) {
      calls.putAll++;
      Object.keys(obj).forEach((k) => {
        if (String(obj[k]).length > 100000) {
          throw new Error('Argument too large: value');
        }
        store[k] = String(obj[k]);
      });
    },
    get(k) { calls.get++; return k in store ? store[k] : null; },
    getAll(keys) {
      calls.getAll++;
      const out = {};
      keys.forEach((k) => { if (k in store) out[k] = store[k]; });
      return out;
    },
    remove(k) { delete store[k]; },
    removeAll(keys) { calls.removeAll++; keys.forEach((k) => delete store[k]); },
    evict(k) { delete store[k]; }
  };
}

/** Loads HCData.js with a stubbed CacheService. */
function loadHC(cache) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt, parseFloat,
    RegExp, Error, Boolean,
    CacheService: { getScriptCache: () => cache },
    SpreadsheetApp: { openById: () => { throw new Error('no sheet in this test'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';", ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Cache.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/20_data/HCData.js', 'utf8'), ctx,
                  { filename: 'HCData.js' });
  return vm.runInContext('HC', ctx);
}

/** A roster of n positions, realistically shaped. */
function roster(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      positionNumber: '9000' + String(i).padStart(4, '0'),
      reportsToPositionNumber: i > 0 ? '90000000' : '',
      employeeId: String(i).padStart(7, '0'),
      employeeName: 'Surname' + i + ',Forename M',
      emailAddress: '',
      orgCode: 'FCBAB',
      officeTitle: 'Contract Specialist',
      grade: '13',
      supervisoryStatus: '8',
      occupancyStatus: 'FILLED',
      lcat: '1102',
      locationCode: 'DC-CENTRAL',
      dutyStationAddress: '1800 F Street NW',
      dutyStationCity: 'Washington',
      dutyStationState: 'DC',
      officeCode: 'IDV',
      businessUnit: 'IDV',
      sector: 'ASD',
      division: 'Acquisition Service Center 1'
    });
  }
  return out;
}

console.log('--- HC chunked cache test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. the real payload size is past the single-entry cap');
{
  // 1,046 positions produced 514,154 bytes in @clolry's live run. The fixture
  // here is the same order of magnitude, which is the point: a test that only
  // exercised small payloads would never reach the chunking path.
  const big = JSON.stringify(roster(1046));
  ok('a 1,046-position roster exceeds 90,000 bytes', big.length > 90000,
     big.length);
  ok('and exceeds CacheService\'s 100,000-byte hard cap too', big.length > 100000,
     big.length + ' bytes — chunking is not optional at this size');

  const cache = makeCache();
  const HC = loadHC(cache);
  ok('HC exposes the chunked helpers', typeof HC._cachePutChunked === 'function');
}

// ---------------------------------------------------------------------------
console.log('\n2. a large value round-trips exactly');
{
  const cache = makeCache();
  const HC = loadHC(cache);
  const data = roster(1046);

  const wrote = HC._cachePutChunked('hc_bundle_v1', data, 21600);
  ok('the write succeeds', wrote === true);

  // ONE ROUND TRIP, not one per chunk. A loop of put() calls over 7 chunks is
  // 7 round trips on every cache write, which at this size costs more than it
  // saves.
  ok('it uses a single putAll', cache.calls.putAll === 1 && cache.calls.put === 0,
     cache.calls);

  const chunkKeys = Object.keys(cache.store).filter((k) => /__c\d+$/.test(k));
  ok('the value is split across several chunks', chunkKeys.length >= 6,
     chunkKeys.length);
  ok('every chunk is within the per-entry cap',
     chunkKeys.every((k) => cache.store[k].length <= 90000),
     chunkKeys.map((k) => cache.store[k].length));

  const back = HC._cacheGetChunked('hc_bundle_v1');
  ok('the read returns an array', Array.isArray(back), typeof back);
  ok('with every position', back && back.length === 1046, back && back.length);
  ok('and byte-identical content',
     JSON.stringify(back) === JSON.stringify(data));

  // The field values must survive, not just the count — a roster whose grades
  // came back wrong would fail every string comparison in Access.js.
  ok('field values survive the round trip',
     back[0].grade === '13' && back[0].positionNumber === '90000000' &&
     back[1045].employeeName === 'Surname1045,Forename M',
     back[1045]);
}

// ---------------------------------------------------------------------------
console.log('\n3. a partial chunk set is a MISS, never a partial roster');
{
  // THE SECTION THAT MATTERS. CacheService evicts individual entries under
  // pressure. A reader that returned what it found would deserialize a
  // truncated roster — valid JSON, right shape, wrong number of people — and
  // that is indistinguishable from staff having left. The access gate would
  // deny them and every per-capita share would shift, with nothing in error.
  const cache = makeCache();
  const HC = loadHC(cache);
  HC._cachePutChunked('hc_bundle_v1', roster(1046), 21600);

  const chunkKeys = Object.keys(cache.store).filter((k) => /__c\d+$/.test(k));
  ok('there are chunks to evict', chunkKeys.length >= 3, chunkKeys.length);

  // Evict a MIDDLE chunk — the case a naive implementation gets wrong,
  // because chunk 0 is present and the loop finds data.
  cache.evict(chunkKeys[2]);
  ok('losing one middle chunk yields null, not a short array',
     HC._cacheGetChunked('hc_bundle_v1') === null,
     'returning the surviving chunks would serve a truncated roster');

  // The LAST chunk is the other dangerous case: everything parses up to a
  // truncation point.
  const cache2 = makeCache();
  const HC2 = loadHC(cache2);
  HC2._cachePutChunked('hc_bundle_v1', roster(1046), 21600);
  const keys2 = Object.keys(cache2.store).filter((k) => /__c\d+$/.test(k));
  cache2.evict(keys2[keys2.length - 1]);
  ok('losing the LAST chunk also yields null',
     HC2._cacheGetChunked('hc_bundle_v1') === null);

  // No manifest means no safe reassembly, even with every chunk present.
  const cache3 = makeCache();
  const HC3 = loadHC(cache3);
  HC3._cachePutChunked('hc_bundle_v1', roster(1046), 21600);
  cache3.evict('hc_bundle_v1__m');
  ok('losing the manifest yields null even with all chunks present',
     HC3._cacheGetChunked('hc_bundle_v1') === null,
     'without the expected count there is no way to know the set is complete');

  // A LENGTH MISMATCH is the backstop: if a chunk were somehow truncated
  // rather than evicted, the count check would pass and the content would be
  // short.
  const cache4 = makeCache();
  const HC4 = loadHC(cache4);
  HC4._cachePutChunked('hc_bundle_v1', roster(1046), 21600);
  const keys4 = Object.keys(cache4.store).filter((k) => /__c\d+$/.test(k));
  cache4.store[keys4[1]] = cache4.store[keys4[1]].slice(0, 100);
  ok('a truncated chunk is detected by total length',
     HC4._cacheGetChunked('hc_bundle_v1') === null,
     'the manifest records the byte length for exactly this case');

  // An absent value is a plain miss, not an error.
  const cache5 = makeCache();
  const HC5 = loadHC(cache5);
  ok('an empty cache yields null',
     HC5._cacheGetChunked('hc_bundle_v1') === null);
}

// ---------------------------------------------------------------------------
console.log('\n4. invalidation removes the chunks, not just the single key');
{
  // Without this, clearing the cache after a roster import removes the
  // single-entry key and leaves the chunk set live for six hours — and
  // hcGetBundle reads chunked FIRST, so it would keep serving the pre-import
  // roster. The invalidation would appear to work while the app showed old
  // data, which is worse than it plainly failing.
  const cache = makeCache();
  const HC = loadHC(cache);
  HC._cachePutChunked('hc_bundle_v1', roster(1046), 21600);
  ok('chunks exist before invalidation',
     Object.keys(cache.store).some((k) => /__c\d+$/.test(k)));

  HC.hcCacheInvalidateAll();
  ok('no chunk survives invalidation',
     !Object.keys(cache.store).some((k) => /__c\d+$/.test(k)),
     Object.keys(cache.store));
  ok('and no manifest survives either',
     !Object.keys(cache.store).some((k) => /__m$/.test(k)),
     Object.keys(cache.store));

  // ORPHANED CHUNKS from an interrupted write must also go, or a later read
  // could reassemble a mixture of two generations.
  const cache2 = makeCache();
  const HC2 = loadHC(cache2);
  cache2.store['hc_bundle_v1__c0'] = 'orphan';
  cache2.store['hc_bundle_v1__c7'] = 'orphan';
  HC2._cacheRemoveChunked('hc_bundle_v1');
  ok('orphaned chunks with no manifest are removed',
     !Object.keys(cache2.store).some((k) => /__c\d+$/.test(k)),
     Object.keys(cache2.store));
}

// ---------------------------------------------------------------------------
console.log('\n5. a shrinking roster cannot leave a mixed-generation read');
{
  // Writing N chunks over a previous set of N+2 leaves two orphans. The
  // manifest's count would stop the reader seeing them — until the next write
  // produced a LONGER value, at which point the reader would reassemble part
  // of one generation and part of another. Clearing before writing makes that
  // impossible rather than improbable.
  const cache = makeCache();
  const HC = loadHC(cache);

  HC._cachePutChunked('hc_bundle_v1', roster(1046), 21600);
  const bigCount = Object.keys(cache.store).filter((k) => /__c\d+$/.test(k)).length;

  HC._cacheRemoveChunked('hc_bundle_v1');
  HC._cachePutChunked('hc_bundle_v1', roster(200), 21600);
  const smallCount = Object.keys(cache.store).filter((k) => /__c\d+$/.test(k)).length;

  ok('a smaller roster uses fewer chunks', smallCount < bigCount,
     [bigCount, smallCount]);
  ok('and no orphan from the larger write remains',
     Object.keys(cache.store).filter((k) => /__c\d+$/.test(k)).length === smallCount);

  const back = HC._cacheGetChunked('hc_bundle_v1');
  ok('the read returns exactly the smaller roster', back.length === 200,
     back.length);

  // And the real entry points clear before writing.
  const src = fs.readFileSync('lets_app/server/20_data/HCData.js', 'utf8');
  const refresh = src.slice(src.indexOf('function hcRefreshBundleCache'),
                            src.indexOf('function hcCacheInvalidateAll'));
  ok('hcRefreshBundleCache clears stale chunks BEFORE writing',
     refresh.indexOf('_cacheRemoveChunked_') > -1 &&
     refresh.indexOf('_cacheRemoveChunked_') < refresh.indexOf('_cachePutChunked_'),
     'clearing after the write would delete what was just stored');
}

// ---------------------------------------------------------------------------
console.log('\n6. hcGetBundle falls back and forward correctly');
{
  const src = fs.readFileSync('lets_app/server/20_data/HCData.js', 'utf8');
  const fn = src.slice(src.indexOf('function hcGetBundle'),
                       src.indexOf('function hcGetOrgHierarchy'));

  // CHUNKED FIRST. A deploy that switches to chunking leaves a single-entry
  // value live for up to six hours, and a small-roster environment still
  // writes one — so both must be read, chunked first because it is the newer
  // and larger form.
  ok('it tries the chunked read first',
     fn.indexOf('_cacheGetChunked_') < fn.indexOf('_cacheGet_(CACHE_KEY_BUNDLE)'),
     fn.slice(0, 400));
  ok('and still reads a single-entry value',
     /_cacheGet_\(CACHE_KEY_BUNDLE\)/.test(fn),
     'discarding a warm single-entry cache would be a needless regression');

  // The single put is TRIED FIRST on write: it is one round trip and most
  // deployments fit. Chunking is the fallback, keyed off _cachePut_ returning
  // false rather than throwing.
  ok('it writes a single entry when it fits, chunks when it does not',
     /if \(!_cachePut_\(CACHE_KEY_BUNDLE/.test(fn) &&
     /_cachePutChunked_\(CACHE_KEY_BUNDLE/.test(fn), fn);

  // _cachePut_ must keep returning false rather than throwing, or the
  // fallback above never runs.
  const put = src.slice(src.indexOf('function _cachePut_'),
                        src.indexOf('// INTERNAL — chunked cache'));
  ok('_cachePut_ reports oversize by returning false',
     /return false;/.test(put) && !/throw/.test(put),
     'the chunking fallback is driven by that return value');
}

// ---------------------------------------------------------------------------
console.log('\n7. negative controls (the suite must be able to fail)');
{
  const src = fs.readFileSync('lets_app/server/20_data/HCData.js', 'utf8');
  const build = (patched) => {
    const cache = makeCache();
    const sandbox = {
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt,
      parseFloat, RegExp, Error, Boolean,
      CacheService: { getScriptCache: () => cache },
      SpreadsheetApp: { openById: () => { throw new Error('no sheet'); } },
      PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';", ctx);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Cache.js', 'utf8'), ctx);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js', 'utf8'), ctx);
    vm.runInContext(patched, ctx, { filename: 'HCData.patched.js' });
    return { HC: vm.runInContext('HC', ctx), cache };
  };

  // 7a — return whatever chunks are present instead of failing the read. §3
  // must catch this.
  const lenient = src.replace(
    `        if (part === null || part === undefined) return null;
        parts.push(part);`,
    `        if (part === null || part === undefined) continue;
        parts.push(part);`);
  ok('negative control patched the missing-chunk check', lenient !== src);
  {
    const { HC, cache } = build(lenient);
    HC._cachePutChunked('hc_bundle_v1', roster(1046), 21600);
    const keys = Object.keys(cache.store).filter((k) => /__c\d+$/.test(k));
    cache.evict(keys[keys.length - 1]);
    let got = null;
    try { got = HC._cacheGetChunked('hc_bundle_v1'); } catch (e) { got = 'threw'; }
    // Either it serves a short roster or the JSON fails to parse. Both are
    // wrong; §3's assertion is what prevents them.
    ok('a patched build does NOT return the full roster',
       got === null || got === 'threw' || (Array.isArray(got) && got.length < 1046),
       'so section 3 is real: a truncated roster would read as staff departures');
  }

  // 7b — drop the length check, keeping the count check. A truncated chunk
  // then passes.
  const noLength = src.replace(
    `      if (raw.length !== manifest.length) {`,
    `      if (false) {`);
  ok('negative control patched the length check', noLength !== src);
  {
    const { HC, cache } = build(noLength);
    HC._cachePutChunked('hc_bundle_v1', roster(1046), 21600);
    const keys = Object.keys(cache.store).filter((k) => /__c\d+$/.test(k));
    cache.store[keys[1]] = cache.store[keys[1]].slice(0, 100);
    let got;
    try { got = HC._cacheGetChunked('hc_bundle_v1'); } catch (e) { got = 'threw'; }
    ok('a patched build fails to detect a truncated chunk',
       got !== null || got === 'threw',
       'so the length check in section 3 is doing real work');
  }

  // 7c — invalidate the single key only. §4 must catch it.
  const partialClear = src.replace(
    `      _cacheRemoveChunked_(CACHE_KEY_BUNDLE);
      console.log('HC.hcCacheInvalidateAll: cleared');`,
    `      console.log('HC.hcCacheInvalidateAll: cleared');`);
  ok('negative control patched the invalidation', partialClear !== src);
  {
    const { HC, cache } = build(partialClear);
    HC._cachePutChunked('hc_bundle_v1', roster(1046), 21600);
    HC.hcCacheInvalidateAll();
    ok('a patched build leaves chunks behind after invalidation',
       Object.keys(cache.store).some((k) => /__c\d+$/.test(k)),
       'so section 4 is real: the app would serve the pre-import roster');
  }
}

// ---------------------------------------------------------------------------
console.log('\n8. the designed path does not log as a failure');
{
  // @clolry's log, on every single run:
  //
  //   HC: payload 514154 bytes exceeds the 90000-byte cache limit for
  //   "hc_bundle_v1". Serving uncached.           <- console.warn
  //   HC: cached 1046 positions in chunks.        <- console.log
  //
  // The chunking WORKED. The warning above it says it did not, and 'Serving
  // uncached' is a specific false claim: the bundle was cached. A log that
  // cries wolf on its own healthy path is how a genuine warning gets scrolled
  // past — and this one appears on every page load.
  const src = fs.readFileSync('lets_app/server/20_data/HCData.js', 'utf8');
  const put = src.slice(src.indexOf('function _cachePut_'),
                        src.indexOf('// INTERNAL — chunked cache'));

  // The caller that is about to chunk SAYS SO, and the size report drops to
  // log level for that caller only.
  ok('_cachePut_ takes a flag for a following chunked write',
     /chunkFallbackFollows/.test(put), put.slice(0, 300));
  ok('an expected oversize is logged, not warned',
     /if \(chunkFallbackFollows\) \{\s*\n\s*console\.log\(/.test(put),
     'the oversize branch is the normal path for a 514KB roster');
  ok('and it says chunking follows rather than "Serving uncached"',
     /chunking instead/.test(put), put.slice(0, 600));

  // STILL A WARNING WHEN NOTHING WILL CHUNK. A caller with no fallback that
  // silently served uncached would be the original bug, and that path is
  // live: CACHE_KEY_ORGS and CACHE_KEY_META are written without a fallback.
  ok('an oversize with no fallback is still a warning',
     /console\.warn\(\s*\n?\s*'HC: payload '/.test(put) &&
     /Serving uncached/.test(put),
     'orgs and meta have no chunked fallback, so for them it is real');

  const fn = src.slice(src.indexOf('function hcGetBundle'),
                       src.indexOf('function hcGetOrgHierarchy'));
  ok('hcGetBundle declares that it will chunk',
     /_cachePut_\(CACHE_KEY_BUNDLE, built\.positions, CACHE_CONFIG\.TTL\.LONG,\s*\n?\s*true\)/
       .test(fn), fn.slice(0, 600));

  // AND THE REAL FAILURE IS NOW VISIBLE. Previously, if BOTH the single put
  // and the chunked put failed, the single put's warning was the only signal
  // and it had already been discounted as noise — so total cache failure and
  // the healthy path logged almost the same thing.
  ok('failing both ways warns',
     /could not cache the bundle in a single entry OR/.test(fn),
     'neither form stored anything; every call re-reads both HC tabs');

  const refresh = src.slice(src.indexOf('function hcRefreshBundleCache'),
                            src.indexOf('function hcCacheInvalidateAll'));
  ok('hcRefreshBundleCache declares it too',
     /CACHE_CONFIG\.TTL\.LONG,\s*\n?\s*true\)/.test(refresh),
     'the warming trigger runs hourly and logged the same false warning');

  // BEHAVIORAL, NOT JUST TEXTUAL. The assertions above read source; these
  // two run it, because the log LEVEL is the whole fix and a regex on the
  // source could pass while the branch did something else.
  const runPut = (text) => {
    const warnings = [];
    const logs = [];
    const cache = makeCache();
    const sandbox = {
      console: {
        log: (m) => logs.push(String(m)),
        warn: (m) => warnings.push(String(m)),
        error() {}
      },
      JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt,
      parseFloat, RegExp, Error, Boolean,
      CacheService: { getScriptCache: () => cache },
      SpreadsheetApp: { openById: () => { throw new Error('no sheet'); } },
      PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';", ctx);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Cache.js', 'utf8'), ctx);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js', 'utf8'), ctx);
    vm.runInContext(text, ctx, { filename: 'HCData.undertest.js' });
    return { HC: vm.runInContext('HC', ctx), warnings, logs };
  };

  {
    const { HC, warnings, logs } = runPut(src);
    const stored = HC._cachePut('hc_bundle_v1', roster(1046), 21600, true);
    ok('an oversize put still returns false so the caller chunks',
       stored === false);
    ok('and emits NO warning when a chunked write follows',
       warnings.length === 0, warnings);
    ok('but does report the size at log level',
       logs.some((l) => /exceeds the/.test(l) && /chunking instead/.test(l)),
       logs);

    // The no-fallback caller — orgs, meta — must still be warned.
    const { HC: H2, warnings: w2 } = runPut(src);
    H2._cachePut('hc_orgs_v1', roster(1046), 21600);
    ok('a caller with no fallback is still warned',
       w2.some((w) => /Serving uncached/.test(w)), w2);
  }

  // NEGATIVE CONTROL: drop the flag and the healthy path warns again.
  const noFlag = src.replace(
    `      if (!_cachePut_(CACHE_KEY_BUNDLE, built.positions, CACHE_CONFIG.TTL.LONG,
                      true)) {`,
    `      if (!_cachePut_(CACHE_KEY_BUNDLE, built.positions, CACHE_CONFIG.TTL.LONG)) {`);
  ok('negative control patched the flag', noFlag !== src);
  {
    // Call _cachePut_ with an oversize payload exactly as the patched caller
    // would, minus the flag.
    const { HC, warnings } = runPut(noFlag);
    HC._cachePut('hc_bundle_v1', roster(1046), 21600);
    ok('a build without the flag warns on the designed path',
       warnings.some((w) => /Serving uncached/.test(w)),
       'so section 8 is real: this fired on every page load');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
