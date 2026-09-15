/**
 * TripConfig.js
 * Application-level configuration. Spreadsheet ID + favicon ID + future
 * feature flags. Spreadsheet ID is read from a script property
 * (TRAVEL_DB_SPREADSHEET_ID) to keep it out of source code; the favicon
 * ID stays inline since it's a public Drive asset URL.
 *
 * Lives in 00_config/ so it loads first in alphabetical clasp push order —
 * every other file that reads TRAVEL_DB_SPREADSHEET_ID or TRIP_FAVICON_ID
 * at top level depends on this loading first.
 *
 * If the TRAVEL_DB_SPREADSHEET_ID property is missing, the const evaluates
 * to null and every SpreadsheetApp.openById() call will fail fast. By
 * design — the property MUST be set in Project Settings → Script Properties
 * before deploy.
 */

const TRAVEL_DB_SPREADSHEET_ID = PropertiesService.getScriptProperties()
  .getProperty('TRAVEL_DB_SPREADSHEET_ID');

const TRIP_FAVICON_ID = '1y_J9fxewAJxvdGWGc1zU988Lyd3it7WB';
