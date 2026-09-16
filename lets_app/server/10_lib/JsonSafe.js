/**
 * JsonSafe.js
 * JSON helpers that don't throw. Used for parsing spreadsheet-stored JSON
 * blobs that may be malformed.
 */

/**
 * Safely parse JSON with fallback to default value. Logs a warning on
 * parse failure (truncates the bad input to 100 chars in the log so we
 * don't dump huge blobs).
 *
 * @param {string} jsonStr - JSON string to parse
 * @param {*} [defaultValue=null] - Value to return if parsing fails
 * @returns {*} Parsed JSON or default value
 * @server
 */
function safeJsonParse(jsonStr, defaultValue = null) {
  if (!jsonStr || typeof jsonStr !== 'string') return defaultValue;
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn('Failed to parse JSON:', jsonStr.substring(0, 100));
    return defaultValue;
  }
}
