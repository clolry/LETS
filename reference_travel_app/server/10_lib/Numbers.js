/**
 * Numbers.js
 * Small shared numeric helpers.
 */

/**
 * Round a monetary amount to the penny (2 decimal places). Canonical
 * replacement for the inline `Math.round(x * 100) / 100` pattern used across
 * cost / per-diem / spend calculations, so money is rounded the same way
 * everywhere.
 *
 * @param {number} value
 * @returns {number} value rounded to 2 decimal places
 */
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
