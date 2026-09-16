/**
 * Cache.js
 * CacheService chunk size + TTL preset constants.
 *
 * Per Phase 3 §3 this file is also the eventual home for the CACHE_KEYS
 * registry (builder functions that produce canonical cache keys instead
 * of inline `'tdb_' + name` concat). Adoption happens during Chunk 10.x
 * per-domain modernization.
 */

const CACHE_CONFIG = {
  CHUNK_SIZE: 150,
  TTL: {
    SHORT: 300,        // 5 minutes
    MEDIUM: 3600,      // 1 hour
    LONG: 21600,       // 6 hours
    PER_DIEM: 86400    // 24 hours
  }
};
