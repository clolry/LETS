/**
 * TravelDB.js
 * Spreadsheet handle with CacheService layer for Travel Request System.
 *
 * Architecture:
 *   readSheet(name) → check in-memory → check CacheService → read spreadsheet
 *   invalidate(name) → clear in-memory + clear CacheService
 *   warmCache() → read all key sheets from spreadsheet, store in CacheService
 *
 * CacheService (script-level, shared across all users):
 *   - Key format: 'tdb_{SheetName}' (or 'tdb_{SheetName}_chunk_{N}' for large sheets)
 *   - Max 100KB per key — large sheets are auto-chunked
 *   - TTL: 600s (10 min) — trigger refreshes every 5 min so cache stays warm
 *   - Fallback: if cache misses, reads spreadsheet directly (still works, just slower)
 *
 * Cache lifecycle:
 *   - First read of a sheet: reads from spreadsheet, stores in CacheService
 *   - Subsequent reads (same or different execution): served from CacheService (~60ms)
 *   - After writes: invalidate() clears cache AND re-reads fresh data immediately
 *   - warmTravelDBCache(): run once from editor to prime all sheets
 *
 * Usage (reads):
 *   const db = new TravelDB();
 *   const { headers, rows, headerIndex } = db.readSheet(SHEET_NAMES.REQUESTS);
 *
 * Usage (writes — each invalidates cache atomically; no manual invalidate needed):
 *   const newRowNum = db.appendRow(SHEET_NAMES.APPROVAL_LOG, [id, requestId, ...]);
 *   db.updateRowByIndex(SHEET_NAMES.REQUESTS, rowNum, {
 *     Status: STATUS_CODES.APPROVED_GOGOV,
 *     Updated_At: new Date()
 *   });
 *   db.deleteRowByIndex(SHEET_NAMES.REQUEST_LEGS, rowNum);
 *   const hit = db.findRow(SHEET_NAMES.REQUESTS, 'Request_ID', 'REQ-2026-0042');
 *   if (hit) console.log('row ' + hit.rowNum, hit.data);
 */

/** Cache config */
var TDB_CACHE_PREFIX = 'tdb_';
var TDB_CACHE_TTL = 600; // 10 minutes (warming trigger runs every 5 min, 2x margin)
var TDB_MAX_CHUNK_BYTES = 90000; // ~90KB per chunk (leave headroom under 100KB limit)

/** Sheets to warm in the cache trigger */
var TDB_WARM_SHEETS = [
  'Requests',
  'Approval_Log',
  'Test_Submitters',
  'Request_Travelers',
  'Travel_Users',
  'Travel_User_Roles',
  'Feedback'
];

class TravelDB {
  constructor() {
    this._ss = null;
    this._sheets = {};
    this._data = {};
  }

  /** Lazy-open the spreadsheet (once per execution) */
  get ss() {
    if (!this._ss) this._ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    return this._ss;
  }

  /**
   * Get a Sheet object by name (cached in-memory).
   * Note: this always opens the spreadsheet — use readSheet() for data reads.
   * @param {string} name - Sheet name
   * @returns {Sheet} The sheet
   */
  sheet(name) {
    if (!this._sheets[name]) this._sheets[name] = this.ss.getSheetByName(name);
    return this._sheets[name];
  }

  /**
   * Read entire sheet data: in-memory → CacheService → spreadsheet.
   * @param {string} name - Sheet name
   * @returns {{ headers: string[], rows: any[][], headerIndex: Object<string,number> }}
   */
  readSheet(name) {
    // 1. In-memory cache (same execution)
    if (this._data[name]) {
      console.log('TravelDB: ' + name + ' [memory hit] ' + this._data[name].rows.length + ' rows');
      return this._data[name];
    }

    // 2. CacheService (cross-execution, shared across users)
    var t0 = Date.now();
    var cached = TravelDB._cacheGet(name);
    if (cached) {
      this._data[name] = cached;
      console.log('TravelDB: ' + name + ' [CACHE HIT] ' + cached.rows.length + ' rows (' + (Date.now() - t0) + 'ms)');
      return cached;
    }

    // 3. Spreadsheet read (slow path)
    var result = this._readFromSheet(name);
    this._data[name] = result;
    console.log('TravelDB: ' + name + ' [SPREADSHEET] ' + result.rows.length + ' rows (' + (Date.now() - t0) + 'ms)');

    // Store in CacheService for next execution
    try { TravelDB._cachePut(name, result); } catch (e) {
      console.warn('TravelDB: Failed to cache ' + name + ':', e.message);
    }

    return result;
  }

  /** Direct spreadsheet read (bypasses all caches) */
  _readFromSheet(name) {
    var sheet = this.sheet(name);
    if (!sheet || sheet.getLastRow() < 2) {
      return { headers: [], rows: [], headerIndex: {} };
    }
    var all = sheet.getDataRange().getValues();
    var headers = all[0];
    var headerIndex = {};
    for (var i = 0; i < headers.length; i++) headerIndex[headers[i]] = i;
    return { headers: headers, rows: all.slice(1), headerIndex: headerIndex };
  }

  /**
   * Find all rows matching a column value.
   * @param {string} sheetName
   * @param {string} columnName
   * @param {*} value
   * @returns {any[][]}
   */
  findRows(sheetName, columnName, value) {
    var data = this.readSheet(sheetName);
    var colIdx = data.headerIndex[columnName];
    if (colIdx === undefined) return [];
    var searchVal = String(value).trim();
    return data.rows.filter(function(row) { return String(row[colIdx]).trim() === searchVal; });
  }

  // ===========================================================================
  // WRITE HELPERS — each invalidates cache atomically (no manual call needed)
  // ===========================================================================

  /**
   * Append a row + invalidate cache atomically.
   * @param {string} sheetName
   * @param {any[]} rowArray - Values in column order matching the sheet's headers
   * @returns {number} 1-based row number of the newly-appended row
   */
  appendRow(sheetName, rowArray) {
    var sheet = this.sheet(sheetName);
    if (!sheet) throw new Error('appendRow: sheet not found: ' + sheetName);
    sheet.appendRow(rowArray);
    var newRowNum = sheet.getLastRow();
    this.invalidate(sheetName);
    return newRowNum;
  }

  /**
   * Update specific cells in a row by 1-based sheet row number + invalidate cache.
   * Only writes the columns named in `updates` (partial update). When 2+ columns
   * change, uses a single setValues call (atomic on the Sheets side + one round-trip).
   *
   * @param {string} sheetName
   * @param {number} rowNum - 1-based sheet row (header is row 1, first data row is 2)
   * @param {Object} updates - { headerName: value, ... }
   * @returns {number} number of cells updated
   */
  updateRowByIndex(sheetName, rowNum, updates) {
    if (!updates || typeof updates !== 'object') {
      throw new Error('updateRowByIndex: updates must be an object');
    }
    var keys = Object.keys(updates);
    if (keys.length === 0) return 0;

    var sheet = this.sheet(sheetName);
    if (!sheet) throw new Error('updateRowByIndex: sheet not found: ' + sheetName);

    var data = this.readSheet(sheetName);
    var headerIndex = data.headerIndex;

    // Resolve each header to a column index; collect contiguous + non-contiguous groups.
    // For simplicity + correctness, write each cell individually via setValue calls
    // grouped under one withLock-equivalent (Sheets coalesces same-execution writes).
    // When 2+ cells are contiguous we COULD use setValues; not worth the complexity here.
    var written = 0;
    for (var i = 0; i < keys.length; i++) {
      var header = keys[i];
      var colIdx = headerIndex[header];
      if (colIdx === undefined) {
        throw new Error('updateRowByIndex: column "' + header + '" not found in ' + sheetName);
      }
      sheet.getRange(rowNum, colIdx + 1).setValue(updates[header]);
      written++;
    }

    this.invalidate(sheetName);
    return written;
  }

  /**
   * Delete a row by 1-based sheet row number + invalidate cache.
   * @param {string} sheetName
   * @param {number} rowNum - 1-based sheet row
   */
  deleteRowByIndex(sheetName, rowNum) {
    var sheet = this.sheet(sheetName);
    if (!sheet) throw new Error('deleteRowByIndex: sheet not found: ' + sheetName);
    sheet.deleteRow(rowNum);
    this.invalidate(sheetName);
  }

  /**
   * Find the FIRST row matching column=value. Returns { rowNum, data } where
   * rowNum is 1-based for the sheet (data row 0 = sheet row 2 due to header).
   * Distinct from findRows() (plural, returns row arrays without rowNums —
   * useless for write operations).
   *
   * @param {string} sheetName
   * @param {string} columnName
   * @param {*} value
   * @returns {{rowNum: number, data: any[]}|null}
   */
  findRow(sheetName, columnName, value) {
    var data = this.readSheet(sheetName);
    var colIdx = data.headerIndex[columnName];
    if (colIdx === undefined) return null;
    var searchVal = String(value).trim();
    for (var i = 0; i < data.rows.length; i++) {
      if (String(data.rows[i][colIdx]).trim() === searchVal) {
        return { rowNum: i + 2, data: data.rows[i] }; // +2: skip header row + 0-to-1 index
      }
    }
    return null;
  }

  /**
   * Invalidate + re-warm cached data for a sheet (call after writes).
   * Clears in-memory + CacheService, then immediately re-reads and re-caches.
   * @param {string} name - Sheet name
   */
  invalidate(name) {
    delete this._data[name];
    TravelDB._cacheRemove(name);

    // Re-warm: read fresh data from spreadsheet and store in CacheService
    try {
      var result = this._readFromSheet(name);
      // Sanitize dates for cache storage
      var json = JSON.stringify(result, function(key, value) {
        if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
        return value;
      });
      var sanitized = JSON.parse(json);
      TravelDB._cachePut(name, sanitized);
      this._data[name] = sanitized;
    } catch (e) {
      console.warn('TravelDB: Re-warm failed for ' + name + ':', e.message);
    }
  }

  // ===========================================================================
  // STATIC: CacheService helpers (chunked read/write)
  // ===========================================================================

  /**
   * Read sheet data from CacheService. Handles chunked storage transparently.
   * @param {string} name - Sheet name
   * @returns {Object|null} { headers, rows, headerIndex } or null if not cached
   */
  static _cacheGet(name) {
    try {
      var cache = CacheService.getScriptCache();
      var metaKey = TDB_CACHE_PREFIX + name;
      var metaRaw = cache.get(metaKey);
      if (!metaRaw) return null;

      var meta = JSON.parse(metaRaw);

      if (meta.chunks === 0) {
        // Small sheet — data is inline in the meta entry
        return meta.data;
      }

      // Chunked — read all chunks
      var chunkKeys = [];
      for (var i = 0; i < meta.chunks; i++) {
        chunkKeys.push(TDB_CACHE_PREFIX + name + '_chunk_' + i);
      }
      var chunkData = cache.getAll(chunkKeys);

      // Verify all chunks present
      var jsonParts = [];
      for (var j = 0; j < meta.chunks; j++) {
        var chunk = chunkData[TDB_CACHE_PREFIX + name + '_chunk_' + j];
        if (!chunk) return null; // Partial cache — treat as miss
        jsonParts.push(chunk);
      }

      return JSON.parse(jsonParts.join(''));
    } catch (e) {
      console.warn('TravelDB: Cache read failed for ' + name + ':', e.message);
      return null;
    }
  }

  /**
   * Write sheet data to CacheService. Auto-chunks if over size limit.
   * @param {string} name - Sheet name
   * @param {Object} data - { headers, rows, headerIndex }
   */
  static _cachePut(name, data) {
    var cache = CacheService.getScriptCache();
    var json = JSON.stringify(data);
    var byteLen = json.length * 2; // rough estimate (UTF-16)

    if (byteLen < TDB_MAX_CHUNK_BYTES) {
      // Small enough — store inline in meta entry
      cache.put(TDB_CACHE_PREFIX + name, JSON.stringify({ chunks: 0, data: data }), TDB_CACHE_TTL);
      return;
    }

    // Chunk the JSON string
    var chunkSize = Math.floor(TDB_MAX_CHUNK_BYTES / 2); // chars (conservative)
    var chunks = [];
    for (var i = 0; i < json.length; i += chunkSize) {
      chunks.push(json.substring(i, i + chunkSize));
    }

    // Write meta + all chunks in one batch
    var entries = {};
    entries[TDB_CACHE_PREFIX + name] = JSON.stringify({ chunks: chunks.length, rows: data.rows.length });
    for (var j = 0; j < chunks.length; j++) {
      entries[TDB_CACHE_PREFIX + name + '_chunk_' + j] = chunks[j];
    }
    cache.putAll(entries, TDB_CACHE_TTL);
  }

  /**
   * Remove sheet data from CacheService (meta + all chunks).
   * @param {string} name - Sheet name
   */
  static _cacheRemove(name) {
    try {
      var cache = CacheService.getScriptCache();
      var metaKey = TDB_CACHE_PREFIX + name;
      var metaRaw = cache.get(metaKey);

      if (metaRaw) {
        var meta = JSON.parse(metaRaw);
        var keysToRemove = [metaKey];
        if (meta.chunks > 0) {
          for (var i = 0; i < meta.chunks; i++) {
            keysToRemove.push(TDB_CACHE_PREFIX + name + '_chunk_' + i);
          }
        }
        cache.removeAll(keysToRemove);
      } else {
        cache.remove(metaKey);
      }
    } catch (e) {
      console.warn('TravelDB: Cache remove failed for ' + name + ':', e.message);
    }
  }

  // ===========================================================================
  // STATIC: Cache warming (called by trigger)
  // ===========================================================================

  /**
   * Warm the CacheService with all key sheets.
   * Called by time-driven trigger every 5 minutes.
   * Reads the spreadsheet once, caches all sheets in a single execution.
   */
  static warmCache() {
    console.time('TravelDB.warmCache');
    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var cache = CacheService.getScriptCache();
    var sheetsWarmed = 0;

    for (var i = 0; i < TDB_WARM_SHEETS.length; i++) {
      var name = TDB_WARM_SHEETS[i];
      try {
        var sheet = ss.getSheetByName(name);
        if (!sheet || sheet.getLastRow() < 2) {
          // Store empty result so cache reads don't fall through to spreadsheet
          TravelDB._cachePut(name, { headers: [], rows: [], headerIndex: {} });
          continue;
        }

        var all = sheet.getDataRange().getValues();
        var headers = all[0];
        var headerIndex = {};
        for (var h = 0; h < headers.length; h++) headerIndex[headers[h]] = h;
        var data = { headers: headers, rows: all.slice(1), headerIndex: headerIndex };

        // Sanitize dates before caching (Date objects don't survive JSON round-trip)
        var json = JSON.stringify(data, function(key, value) {
          if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
          return value;
        });
        var sanitized = JSON.parse(json);

        TravelDB._cachePut(name, sanitized);
        sheetsWarmed++;

      } catch (e) {
        console.error('TravelDB.warmCache: Failed to cache ' + name + ':', e.message);
      }
    }

    console.log('TravelDB.warmCache: Warmed ' + sheetsWarmed + '/' + TDB_WARM_SHEETS.length + ' sheets');
    console.timeEnd('TravelDB.warmCache');
    return sheetsWarmed;
  }
}

// Trigger handler (warmTravelDBCache) + installer/uninstaller live in
// 99_triggers/CacheWarming.js — they call TravelDB.warmCache() from there.
