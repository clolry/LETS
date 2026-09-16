/**
 * SheetHelpers.js
 * Generic header-index + find-row utilities. Used by code paths that
 * bypass TravelDB. The TravelDB class has its own findRow() method;
 * these are for callers that hold a raw Sheet handle.
 */

/**
 * Build a header index map from a header row — { headerName: columnIndex }.
 *
 * @param {Array} headers - Array of header strings (first row of sheet)
 * @returns {Object} Map of { headerName: columnIndex }
 * @server
 *
 * @example
 *   const headers = ['Request_ID', 'Status', 'Submitter'];
 *   const index = buildHeaderIndex(headers);
 *   // { 'Request_ID': 0, 'Status': 1, 'Submitter': 2 }
 */
function buildHeaderIndex(headers) {
  const index = {};
  headers.forEach((header, idx) => {
    if (header) index[header] = idx;
  });
  return index;
}

/**
 * Convert a data row to an object using header index.
 *
 * @param {Array} row - Data row array
 * @param {Array} headers - Header row array
 * @param {Object} [headerIndex] - Pre-built header index (optional)
 * @returns {Object} Row data as object with header keys
 * @server
 */
function rowToObject(row, headers, headerIndex = null) {
  const obj = {};
  headers.forEach((header, i) => {
    if (header) obj[header] = row[i];
  });
  return obj;
}

/**
 * Find a single row by column value. Returns the first matching row as an
 * object (with header keys), or null if not found. Includes `_rowIndex`
 * (1-based for Sheets API) by default.
 *
 * @param {Sheet} sheet - Google Sheets Sheet object
 * @param {string} columnName - Column header name to search
 * @param {*} value - Value to match
 * @param {Object} [options]
 * @param {boolean} [options.includeRowIndex=true]
 * @returns {Object|null}
 * @server
 */
function findRowByColumn(sheet, columnName, value, options = {}) {
  const { includeRowIndex = true } = options;

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;

  const headers = data[0];
  const headerIndex = buildHeaderIndex(headers);
  const colIdx = headerIndex[columnName];

  if (colIdx === undefined) {
    console.warn(`[findRowByColumn] Column "${columnName}" not found in sheet`);
    return null;
  }

  for (let i = 1; i < data.length; i++) {
    if (data[i][colIdx] === value) {
      const row = rowToObject(data[i], headers, headerIndex);
      if (includeRowIndex) row._rowIndex = i + 1;
      return row;
    }
  }
  return null;
}

/**
 * Find multiple rows by column value. Returns all matching rows as objects.
 *
 * @param {Sheet} sheet - Google Sheets Sheet object
 * @param {string} columnName
 * @param {*} value
 * @param {Object} [options]
 * @param {boolean} [options.includeRowIndex=true]
 * @returns {Array<Object>}
 * @server
 */
function findRowsByColumn(sheet, columnName, value, options = {}) {
  const { includeRowIndex = true } = options;

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const headerIndex = buildHeaderIndex(headers);
  const colIdx = headerIndex[columnName];

  if (colIdx === undefined) {
    console.warn(`[findRowsByColumn] Column "${columnName}" not found in sheet`);
    return [];
  }

  const results = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][colIdx] === value) {
      const row = rowToObject(data[i], headers, headerIndex);
      if (includeRowIndex) row._rowIndex = i + 1;
      results.push(row);
    }
  }
  return results;
}
