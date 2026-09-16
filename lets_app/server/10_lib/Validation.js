/**
 * Validation.js
 * Lightweight argument-guard helpers for @client functions.
 *
 * Each `requireX(value, fieldName)` returns the normalized value on success
 * and throws `ValidationError` on failure. ValidationError extends the
 * native Error, so the existing `catch (err) { return errorResponse(err.message) }`
 * pattern in @client functions handles it without changes.
 *
 * Adoption is rolling — a function can mix new guards with legacy inline
 * if-checks during transition. Picking up validation is part of touching
 * a function for any other reason; no chunk dedicated to bulk migration.
 *
 * IMPORTANT — trigger context caveat: do NOT use requireEmail(userEmail)
 * in a path that is reachable from an installable trigger.
 * Session.getActiveUser().getEmail() returns '' from trigger context,
 * which would falsely trip the guard. Guard the user email only in @client
 * paths where a real session exists.
 */

/**
 * Custom error class thrown by every require* helper. Carries the
 * offending field name and an error code in addition to the human-
 * readable message that gets surfaced to the user via errorResponse.
 *
 * @server
 */
class ValidationError extends Error {
  /**
   * @param {string} message - User-facing message (e.g., "Request ID is required")
   * @param {string} [field] - Field name (e.g., "requestId")
   * @param {string} [code]  - Error code (default: "VALIDATION")
   */
  constructor(message, field, code) {
    super(message);
    this.name = 'ValidationError';
    this.field = field || null;
    this.code = code || 'VALIDATION';
  }
}

/**
 * Require a non-empty string. Trims whitespace; rejects empty/whitespace-only.
 * Returns the trimmed value on success.
 *
 * @param {*} value
 * @param {string} fieldName - Name to surface in the error message
 * @returns {string} The trimmed string
 * @throws {ValidationError} if value is missing or empty after trim
 * @server
 */
function requireString(value, fieldName) {
  if (value === undefined || value === null) {
    throw new ValidationError(_fieldLabel(fieldName) + ' is required', fieldName);
  }
  if (typeof value !== 'string') {
    throw new ValidationError(_fieldLabel(fieldName) + ' must be a string', fieldName);
  }
  var trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(_fieldLabel(fieldName) + ' is required', fieldName);
  }
  return trimmed;
}

/**
 * Require a finite number. Accepts numeric strings (parsed with Number()),
 * rejects NaN / Infinity / null / undefined / empty string.
 *
 * @param {*} value
 * @param {string} fieldName
 * @returns {number}
 * @throws {ValidationError}
 * @server
 */
function requireNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(_fieldLabel(fieldName) + ' is required', fieldName);
  }
  var num = typeof value === 'number' ? value : Number(value);
  if (!isFinite(num)) {
    throw new ValidationError(_fieldLabel(fieldName) + ' must be a number', fieldName);
  }
  return num;
}

/**
 * Require a number >= 0. Used for costs, counts, percentages.
 * @server
 */
function requireNonNegativeNumber(value, fieldName) {
  var num = requireNumber(value, fieldName);
  if (num < 0) {
    throw new ValidationError(_fieldLabel(fieldName) + ' must be zero or positive', fieldName);
  }
  return num;
}

/**
 * Require a number > 0.
 * @server
 */
function requirePositiveNumber(value, fieldName) {
  var num = requireNumber(value, fieldName);
  if (num <= 0) {
    throw new ValidationError(_fieldLabel(fieldName) + ' must be greater than zero', fieldName);
  }
  return num;
}

/**
 * Require a strict boolean. Rejects truthy/falsy values that aren't `true`/`false`.
 * @server
 */
function requireBoolean(value, fieldName) {
  if (value !== true && value !== false) {
    throw new ValidationError(_fieldLabel(fieldName) + ' must be true or false', fieldName);
  }
  return value;
}

/**
 * Require an Array (any length, including empty).
 * @server
 */
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new ValidationError(_fieldLabel(fieldName) + ' must be an array', fieldName);
  }
  return value;
}

/**
 * Require an Array with at least one element.
 * @server
 */
function requireNonEmptyArray(value, fieldName) {
  var arr = requireArray(value, fieldName);
  if (arr.length === 0) {
    throw new ValidationError('At least one ' + _fieldLabel(fieldName).toLowerCase() + ' is required', fieldName);
  }
  return arr;
}

/**
 * Require value to be one of the allowed values (===). For status codes,
 * action types, enum-like inputs. Surfaces the allowed list in the error
 * message so the caller knows what's valid.
 *
 * @param {*} value
 * @param {string} fieldName
 * @param {Array} allowedValues - Array of valid values
 * @returns {*} The value (unchanged) on success
 * @throws {ValidationError}
 * @server
 */
function requireEnum(value, fieldName, allowedValues) {
  if (!Array.isArray(allowedValues) || allowedValues.length === 0) {
    // Programmer error, not user error — throw plain Error so it bubbles to logError, not errorResponse
    throw new Error('requireEnum: allowedValues must be a non-empty array (fieldName=' + fieldName + ')');
  }
  if (allowedValues.indexOf(value) === -1) {
    throw new ValidationError(
      _fieldLabel(fieldName) + ' must be one of: ' + allowedValues.join(', '),
      fieldName
    );
  }
  return value;
}

/**
 * Require a non-null object (not an Array, not null). Used for nested
 * input payloads like sharedCosts, sectionComments.
 *
 * @server
 */
function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(_fieldLabel(fieldName) + ' must be an object', fieldName);
  }
  return value;
}

/**
 * Require a TRIP Request_ID. Format: REQ-YYYY-NNNN (or REQ-YYYY-NNNNN for
 * year rollover safety — current numbering uses 4 digits but we accept 4–6
 * so this guard doesn't break when we cross 9999).
 *
 * @param {*} value
 * @param {string} [fieldName='requestId']
 * @returns {string} The validated Request_ID
 * @server
 */
function requireRequestId(value, fieldName) {
  fieldName = fieldName || 'requestId';
  var str = requireString(value, fieldName);
  if (!/^REQ-\d{4}-\d{4,6}$/.test(str)) {
    throw new ValidationError(_fieldLabel(fieldName) + ' is not a valid Request ID format (REQ-YYYY-NNNN)', fieldName);
  }
  return str;
}

/**
 * Require a syntactically valid email address. Uses a permissive regex —
 * we're not RFC 5322 here, just rejecting "obviously not an email" inputs.
 *
 * DO NOT call this on Session.getActiveUser().getEmail() in trigger paths
 * (it returns '' there and would falsely trip). Use only on @client inputs
 * where a real interactive session is guaranteed.
 *
 * @server
 */
function requireEmail(value, fieldName) {
  var str = requireString(value, fieldName);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
    throw new ValidationError(_fieldLabel(fieldName) + ' is not a valid email address', fieldName);
  }
  return str;
}

/**
 * Require a value parseable as a Date. Accepts Date instances, ISO strings,
 * and YYYY-MM-DD strings. Returns the original input on success (does NOT
 * coerce to Date — callers may want the string form for storage).
 *
 * @server
 */
function requireDateString(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(_fieldLabel(fieldName) + ' is required', fieldName);
  }
  var d = (value instanceof Date) ? value : new Date(value);
  if (isNaN(d.getTime())) {
    throw new ValidationError(_fieldLabel(fieldName) + ' is not a valid date', fieldName);
  }
  return value;
}

/**
 * Internal: turn a camelCase field name into a Title Case label for
 * user-facing error messages. "requestId" → "Request Id", "tripName" → "Trip Name".
 *
 * @private @server
 */
function _fieldLabel(fieldName) {
  if (!fieldName) return 'Value';
  return String(fieldName)
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, function(c) { return c.toUpperCase(); })
    .trim();
}
