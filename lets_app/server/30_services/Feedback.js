/**
 * TravelFeedbackService.js
 * Server-side functions for the user feedback system.
 * Writes to the Feedback sheet in the Travel DB spreadsheet.
 */

/**
 * Submit user feedback (thumbs, NPS, bug report, feature request).
 * Called from client via google.script.run.
 *
 * @param {Object} feedbackData
 * @param {string} feedbackData.type - thumbs_up | thumbs_down | nps | bug_report | feature_request
 * @param {string} [feedbackData.comment] - Free-text comment
 * @param {number} [feedbackData.npsScore] - 0-10, only for NPS
 * @param {string} [feedbackData.category] - For bugs/features: Form, Review, Notifications, Portal, Other
 * @param {string} feedbackData.contextPage - portal | form | review | admin
 * @param {string} feedbackData.contextAction - submission | approve | deny | request_info | resubmit | nps_prompt | help_menu
 * @param {string} [feedbackData.requestId] - Request ID if applicable
 * @param {string} [feedbackData.browserInfo] - navigator.userAgent snippet
 * @param {string} [feedbackData.pageUrl] - Current page URL
 * @param {string} [feedbackData.userName] - Display name from client
 * @returns {Object} successResponse() on success or errorResponse(msg) on failure
 * @client
 */
function submitTravelFeedback(feedbackData) {
  try {
    if (!feedbackData || !feedbackData.type) {
      return errorResponse('Missing feedback type');
    }

    var validTypes = ['thumbs_up', 'thumbs_down', 'nps', 'bug_report', 'feature_request'];
    if (validTypes.indexOf(feedbackData.type) === -1) {
      return errorResponse('Invalid feedback type');
    }

    // Rate limiting: check if same user submitted same type within last 60s
    var userEmail = Session.getActiveUser().getEmail();
    var cache = CacheService.getScriptCache();
    var cacheKey = 'feedback_rate_' + userEmail + '_' + feedbackData.type;
    if (cache.get(cacheKey)) {
      return successResponse(); // Silently skip duplicate
    }

    var db = new TravelDB();
    if (!db.sheet(SHEET_NAMES.FEEDBACK)) {
      return errorResponse('Feedback sheet not found');
    }

    var feedbackId = 'fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    var timestamp = new Date();
    var userName = feedbackData.userName || '';

    var row = [
      feedbackId,
      timestamp,
      userEmail,
      userName,
      feedbackData.type,
      feedbackData.contextPage || '',
      feedbackData.contextAction || '',
      feedbackData.requestId || '',
      feedbackData.type === 'nps' ? (feedbackData.npsScore != null ? feedbackData.npsScore : '') : '',
      feedbackData.comment || '',
      feedbackData.category || '',
      feedbackData.browserInfo || '',
      feedbackData.pageUrl || ''
    ];

    db.appendRow(SHEET_NAMES.FEEDBACK, row);

    // Set rate limit cache (60 seconds)
    cache.put(cacheKey, '1', 60);

    // For NPS submissions, stamp UserProperties with the timestamp so
    // checkNpsEligibility can resolve the cooldown without reading the
    // Feedback sheet on every portal load. ~1500ms cold saved per portal hit.
    // KNOWN BUG: under executeAs=USER_DEPLOYING in appsscript.json,
    // PropertiesService.getUserProperties() reads the deploying user's
    // properties, not the calling user's — so the fast path is silently
    // broken (every user gets the same stamp). Separate cleanup task.
    if (feedbackData.type === 'nps') {
      try {
        PropertiesService.getUserProperties().setProperty(
          'nps_last_event',
          timestamp.toISOString()
        );
      } catch (propErr) {
        console.warn('saveFeedback: UserProperties stamp failed (non-blocking): ' + propErr.message);
      }
    }

    return successResponse();
  } catch (error) {
    logError('submitTravelFeedback', error, { type: feedbackData ? feedbackData.type : 'unknown' });
    return errorResponse(error.message);
  }
}

/**
 * Check if the current user is eligible for an NPS prompt.
 * Looks at the Feedback sheet for the user's most recent NPS or dismissal entry.
 * Eligible if 30+ days since last NPS submission/dismissal.
 *
 * @returns {Object} successResponse({ eligible: boolean }) — fail-closed:
 *   even on caught errors returns success=true with eligible=false so the
 *   client never surfaces an error UI for a fire-and-forget eligibility check.
 * @client
 */
function checkNpsEligibility(sharedDb) {
  try {
    var userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) return successResponse({ eligible: false });

    // FAST PATH: UserProperties.
    // saveFeedback (type=nps) and dismissNpsPrompt stamp 'nps_last_event'
    // with an ISO timestamp. If present, we resolve eligibility without
    // ever touching the Feedback sheet — saves ~1500ms cold per portal load.
    // KNOWN BUG: see submitTravelFeedback — under USER_DEPLOYING the stamp
    // resolves to the deploying user's properties, not the caller's.
    try {
      var stampedRaw = PropertiesService.getUserProperties().getProperty('nps_last_event');
      if (stampedRaw) {
        var stampedDate = new Date(stampedRaw);
        if (!isNaN(stampedDate.getTime())) {
          var daysSinceStamped = (Date.now() - stampedDate.getTime()) / TIME_CONSTANTS.MS_PER_DAY;
          return successResponse({ eligible: daysSinceStamped >= 30 });
        }
      }
    } catch (propErr) {
      // Fall through to sheet path on any UserProperties failure
      console.warn('checkNpsEligibility: UserProperties read failed, falling back to sheet: ' + propErr.message);
    }

    // SLOW PATH: read the Feedback sheet.
    // Only hit on a user's first-ever portal load (or after UserProperties
    // is cleared). After this run, we'll stamp UserProperties with whatever
    // we found so subsequent calls are instant.
    var db = sharedDb || new TravelDB();
    var sheetData = db.readSheet(SHEET_NAMES.FEEDBACK);
    if (!sheetData.headers.length || !sheetData.rows.length) {
      return successResponse({ eligible: true }); // No feedback yet — show prompt
    }

    var headers = sheetData.headers;
    var emailIdx = headers.indexOf('User_Email');
    var typeIdx = headers.indexOf('Feedback_Type');
    var tsIdx = headers.indexOf('Timestamp');

    if (emailIdx === -1 || typeIdx === -1 || tsIdx === -1) {
      return successResponse({ eligible: true });
    }

    // Find most recent NPS or nps_dismiss entry for this user
    var lastNpsDate = null;
    for (var i = 0; i < sheetData.rows.length; i++) {
      var row = sheetData.rows[i];
      var rowType = row[typeIdx];
      if (row[emailIdx] === userEmail && (rowType === 'nps' || rowType === 'nps_dismiss')) {
        var rowDate = row[tsIdx] ? new Date(row[tsIdx]) : null;
        if (rowDate && (!lastNpsDate || rowDate > lastNpsDate)) {
          lastNpsDate = rowDate;
        }
      }
    }

    // Stamp UserProperties with whatever we found (or "" if none) so the
    // next portal load takes the fast path. For first-ever users with no
    // history, we stamp the epoch so eligible=true continues to be returned
    // until they actually act on the prompt.
    try {
      PropertiesService.getUserProperties().setProperty(
        'nps_last_event',
        lastNpsDate ? lastNpsDate.toISOString() : new Date(0).toISOString()
      );
    } catch (propErr) {
      console.warn('checkNpsEligibility: UserProperties backfill failed (non-blocking): ' + propErr.message);
    }

    if (!lastNpsDate) {
      return successResponse({ eligible: true });
    }

    var daysSince = (Date.now() - lastNpsDate.getTime()) / TIME_CONSTANTS.MS_PER_DAY;
    return successResponse({ eligible: daysSince >= 30 });

  } catch (error) {
    console.error('Error in checkNpsEligibility:', error);
    return successResponse({ eligible: false }); // Fail closed — don't show
  }
}

/**
 * Dismiss NPS prompt without submitting feedback.
 * Writes a dismissal record to the Feedback sheet so the 30-day cooldown applies.
 *
 * @returns {Object} successResponse() or errorResponse(msg)
 * @client
 */
function dismissNpsPrompt() {
  try {
    var userEmail = Session.getActiveUser().getEmail();

    var db = new TravelDB();
    if (!db.sheet(SHEET_NAMES.FEEDBACK)) {
      return errorResponse('Feedback sheet not found');
    }

    var feedbackId = 'fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    var dismissTime = new Date();
    db.appendRow(SHEET_NAMES.FEEDBACK, [
      feedbackId,
      dismissTime,
      userEmail,
      '',            // userName
      'nps_dismiss', // type — distinguishes from actual NPS responses
      '',            // contextPage
      'nps_prompt',  // contextAction
      '',            // requestId
      '',            // npsScore
      '',            // comment
      '',            // category
      '',            // browserInfo
      ''             // pageUrl
    ]);

    // Mirror to UserProperties so checkNpsEligibility doesn't need to read
    // the Feedback sheet on subsequent portal loads.
    // KNOWN BUG: under USER_DEPLOYING this stamps the deploying user's
    // properties (see submitTravelFeedback comment).
    try {
      PropertiesService.getUserProperties().setProperty(
        'nps_last_event',
        dismissTime.toISOString()
      );
    } catch (propErr) {
      console.warn('dismissNpsPrompt: UserProperties stamp failed (non-blocking): ' + propErr.message);
    }

    return successResponse();
  } catch (error) {
    return errorResponse(error.message);
  }
}

/**
 * Get recent feedback entries for admin console.
 * Requires admin access.
 *
 * @param {Object} [options]
 * @param {number} [options.limit] - Max rows to return (default 100)
 * @param {string} [options.type] - Filter by feedback type
 * @returns {Object} successResponse({ feedback, total }) or errorResponse(msg)
 * @client
 */
function getRecentFeedback(options) {
  try {
    requireTravelAdmin();

    options = options || {};
    var limit = options.limit || 100;
    var typeFilter = options.type || '';

    var db = new TravelDB();
    var sheetData = db.readSheet(SHEET_NAMES.FEEDBACK);
    if (!sheetData.headers.length || !sheetData.rows.length) {
      return successResponse({ feedback: [], total: 0 });
    }

    var headers = sheetData.headers;
    var rows = sheetData.rows.filter(function(row) {
      return row[0]; // Has a Feedback_ID
    });

    // Filter by type if specified
    var typeIdx = headers.indexOf('Feedback_Type');
    if (typeFilter && typeIdx !== -1) {
      rows = rows.filter(function(row) {
        return row[typeIdx] === typeFilter;
      });
    }

    var total = rows.length;

    // Sort by timestamp descending (most recent first)
    var tsIdx = headers.indexOf('Timestamp');
    rows.sort(function(a, b) {
      var dateA = a[tsIdx] ? new Date(a[tsIdx]) : new Date(0);
      var dateB = b[tsIdx] ? new Date(b[tsIdx]) : new Date(0);
      return dateB.getTime() - dateA.getTime();
    });

    // Limit
    rows = rows.slice(0, limit);

    // Convert to objects
    var feedback = rows.map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) {
        obj[h] = row[i] != null ? row[i] : '';
      });
      return obj;
    });

    // Serialize Dates to ISO strings before wrapping in envelope — the
    // google.script.run boundary doesn't transport Date objects natively.
    var serialized = JSON.parse(JSON.stringify({ feedback: feedback, total: total }, function(key, value) {
      if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
      return value;
    }));
    return successResponse(serialized);
  } catch (error) {
    logError('getRecentFeedback', error, {});
    return errorResponse(error.message);
  }
}
