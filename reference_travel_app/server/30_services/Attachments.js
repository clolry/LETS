/**
 * TravelAttachmentService.js
 * Handles file uploads to Google Drive for travel request attachments.
 *
 * Architecture (USER_DEPLOYING mode):
 * - The web app executes as the deployer (owner), so all Drive operations
 *   run with the owner's credentials. No user Drive access, no file queue.
 * - Uploads go directly to the Shared Drive under a structured folder tree.
 * - Draft files are stored in a TRIP_Drafts/{draftId}/ folder on the Shared Drive
 *   so they persist across sessions and are accessible to all reviewers.
 * - At submission, draft files are moved into the request's final folder.
 *
 * Folder structure (Shared Drive):
 *   Travel_Attachments/
 *     Drafts/
 *       {draftId}/             ← temp storage during form editing
 *     Requests/
 *       TR-XXXXXX/
 *         Supporting_Documents/
 *         Travelers/
 *           John_Smith/
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/** @returns {string} Shared Drive folder ID for all travel files */
function getSharedDriveFolderId_() {
  return getSharedDriveFolderId();
}

// ============================================================================
// SHARED DRIVE FOLDER HELPERS
// ============================================================================

/**
 * Get or create the Drafts folder on the Shared Drive.
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getDraftsFolder_() {
  var sharedFolderId = getSharedDriveFolderId_();
  if (!sharedFolderId) throw new Error('SHARED_DRIVE_FOLDER_ID not configured');
  var sharedFolder = DriveApp.getFolderById(sharedFolderId);
  return getOrCreateSubfolder_(sharedFolder, 'Drafts');
}

/**
 * Get or create a draft subfolder for a specific draft ID.
 * @param {string} draftId
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getDraftFolder_(draftId) {
  var draftsFolder = getDraftsFolder_();
  return getOrCreateSubfolder_(draftsFolder, draftId);
}

// ============================================================================
// FILE UPLOAD — Direct to Shared Drive
// ============================================================================

/**
 * Upload a file directly to the Shared Drive draft folder.
 * Called immediately when user adds a file in the form.
 *
 * @param {Object} fileData - { name, type, data (base64), draftId, travelerId?, category? }
 * @returns {Object} { success, fileId, fileName, fileUrl, fileSize, mimeType, draftId }
 */
function uploadTravelDraftFile(fileData) {
  try {
    if (!fileData || !fileData.name || !fileData.data) {
      throw new Error('Invalid file data');
    }
    if (!fileData.draftId) {
      throw new Error('Draft ID required');
    }

    var userEmail = Session.getActiveUser().getEmail();
    var draftFolder = getDraftFolder_(fileData.draftId);

    // Decode base64 and create file
    var decoded = Utilities.base64Decode(fileData.data);
    var blob = Utilities.newBlob(decoded, fileData.type, fileData.name);

    // Create file using Advanced Drive API (works on Shared Drives)
    var fileMetadata = {
      name: fileData.name,
      parents: [draftFolder.getId()],
      description: JSON.stringify({
        uploadedBy: userEmail,
        uploadedAt: new Date().toISOString(),
        draftId: fileData.draftId,
        travelerId: fileData.travelerId || null,
        category: fileData.category || 'supporting_doc'
      })
    };

    var created = Drive.Files.create(fileMetadata, blob, {
      supportsAllDrives: true,
      fields: 'id,name,webViewLink,size,mimeType'
    });

    return {
      success: true,
      fileId: created.id,
      fileName: created.name,
      fileUrl: created.webViewLink,
      fileSize: parseInt(created.size, 10) || 0,
      mimeType: created.mimeType,
      draftId: fileData.draftId
    };

  } catch (error) {
    console.error('Error uploading draft file:', error);
    logError('uploadTravelDraftFile', error, { fileName: fileData && fileData.name });
    return {
      success: false,
      error: error.message || 'Failed to upload file'
    };
  }
}

/**
 * Upload NFS worksheet for a specific traveler.
 *
 * @param {Object} fileData - { name, type, data (base64), draftId, travelerId }
 * @returns {Object} { success, fileId, fileName, fileUrl, fileSize, mimeType, draftId }
 */
function uploadNFSDraftFile(fileData) {
  try {
    if (!fileData || !fileData.name || !fileData.data) {
      throw new Error('Invalid file data');
    }
    if (!fileData.draftId) {
      throw new Error('Draft ID required');
    }
    if (!fileData.travelerId) {
      throw new Error('Traveler ID required for NFS worksheet');
    }

    fileData.category = 'nfs_worksheet';
    return uploadTravelDraftFile(fileData);

  } catch (error) {
    console.error('Error uploading NFS worksheet:', error);
    return {
      success: false,
      error: error.message || 'Failed to upload NFS worksheet'
    };
  }
}

/**
 * Delete a draft file from the Shared Drive.
 *
 * @param {string} fileId - Google Drive file ID
 * @returns {Object} { success } or { success: false, error }
 */
function deleteTravelDraftFile(fileId) {
  try {
    if (!fileId) {
      throw new Error('File ID required');
    }

    Drive.Files.update({ trashed: true }, fileId, null, { supportsAllDrives: true });
    return { success: true };

  } catch (error) {
    console.error('Error deleting draft file:', error);
    return {
      success: false,
      error: error.message || 'Failed to delete file'
    };
  }
}

/**
 * Get file metadata for multiple files (for restoring drafts).
 *
 * @param {string[]} fileIds - Array of Google Drive file IDs
 * @returns {Object} { success, files: [{ fileId, fileName, fileUrl, fileSize, mimeType }] }
 */
function getTravelDraftFiles(fileIds) {
  try {
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return { success: true, files: [] };
    }

    var files = [];

    for (var i = 0; i < fileIds.length; i++) {
      try {
        var file = Drive.Files.get(fileIds[i], {
          supportsAllDrives: true,
          fields: 'id,name,webViewLink,size,mimeType,trashed'
        });

        if (!file.trashed) {
          files.push({
            fileId: file.id,
            fileName: file.name,
            fileUrl: file.webViewLink,
            fileSize: parseInt(file.size, 10) || 0,
            mimeType: file.mimeType
          });
        }
      } catch (e) {
        console.warn('Could not access file ' + fileIds[i] + ':', e.message);
      }
    }

    return { success: true, files: files };

  } catch (error) {
    console.error('Error getting draft files:', error);
    return {
      success: false,
      error: error.message,
      files: []
    };
  }
}

// ============================================================================
// FILE FINALIZATION (SUBMISSION) — Direct Move on Shared Drive
// ============================================================================

/**
 * Move draft files into the request's permanent folder on the Shared Drive.
 * Since we're running as the owner, this happens synchronously — no queue needed.
 *
 * @param {string[]} fileIds - Array of Drive file IDs from drafts
 * @param {string} requestId - The request ID (e.g., TR-000123)
 * @param {string} category - Default attachment category
 * @param {Object} options - { travelers: [...], draftId: string }
 * @returns {Object} { success, folderUrl, attachments: [...] }
 */
function finalizeRequestAttachments(fileIds, requestId, category, options) {
  category = category || 'supporting_doc';
  options = options || {};

  try {
    if (!requestId) {
      throw new Error('Request ID required');
    }

    var hasFileIds = fileIds && fileIds.length > 0;
    var hasNfsFiles = options.travelers && options.travelers.some(function(t) { return t.nfsFileId; });

    if (!hasFileIds && !hasNfsFiles) {
      return { success: true, folderUrl: '', attachments: [] };
    }

    var submitterEmail = Session.getActiveUser().getEmail();
    var travelers = options.travelers || [];
    var now = new Date();

    // Create request folder structure on Shared Drive
    var sharedDriveFolderId = getSharedDriveFolderId_();
    if (!sharedDriveFolderId) throw new Error('SHARED_DRIVE_FOLDER_ID not configured');

    var mainFolder = DriveApp.getFolderById(sharedDriveFolderId);
    var requestsFolder = getOrCreateSubfolder_(mainFolder, 'Requests');
    var requestFolder = getOrCreateSubfolder_(requestsFolder, requestId);
    var supportingDocsFolder = null;
    var travelersFolder = null;
    var travelerFolders = {};

    var attachmentRows = [];
    var attachments = [];

    // Process supporting documents
    if (fileIds && fileIds.length > 0) {
      for (var i = 0; i < fileIds.length; i++) {
        try {
          var fileId = fileIds[i];
          var file = Drive.Files.get(fileId, {
            supportsAllDrives: true,
            fields: 'id,name,webViewLink,size,mimeType,trashed,description'
          });

          if (file.trashed) {
            console.warn('Skipping trashed file: ' + fileId);
            continue;
          }

          var metadata = {};
          try { metadata = JSON.parse(file.description || '{}'); } catch (e) {}
          var travelerId = metadata.travelerId || '';
          var fileCat = metadata.category || category;

          // Determine target folder
          var targetFolder;
          if (travelerId && travelers.length > 0) {
            var traveler = travelers.filter(function(t) { return t.id === travelerId; })[0];
            var travelerName = traveler ? (traveler.employeeName || traveler.name) : travelerId;
            var safeName = sanitizeFolderName_(travelerName);
            if (!travelersFolder) {
              travelersFolder = getOrCreateSubfolder_(requestFolder, 'Travelers');
            }
            if (!travelerFolders[safeName]) {
              travelerFolders[safeName] = getOrCreateSubfolder_(travelersFolder, safeName);
            }
            targetFolder = travelerFolders[safeName];
          } else {
            if (!supportingDocsFolder) {
              supportingDocsFolder = getOrCreateSubfolder_(requestFolder, 'Supporting_Documents');
            }
            targetFolder = supportingDocsFolder;
          }

          // Move file within Shared Drive (just update parents)
          var moved = Drive.Files.update(
            { name: file.name },
            fileId,
            null,
            {
              addParents: targetFolder.getId(),
              removeParents: getDraftFolder_(options.draftId || '').getId(),
              supportsAllDrives: true,
              fields: 'id,name,webViewLink'
            }
          );

          var attachmentId = 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

          attachmentRows.push([
            requestId,
            attachmentId,
            travelerId,
            moved.name,
            moved.id,
            moved.webViewLink,
            file.mimeType,
            parseInt(file.size, 10) || 0,
            fileCat,
            submitterEmail,
            now
          ]);

          attachments.push({
            attachmentId: attachmentId,
            fileId: moved.id,
            fileName: moved.name,
            fileUrl: moved.webViewLink,
            fileSize: parseInt(file.size, 10) || 0,
            mimeType: file.mimeType,
            travelerId: travelerId,
            category: fileCat
          });

        } catch (e) {
          console.error('Error processing file ' + fileIds[i] + ':', e);
        }
      }
    }

    // Process NFS worksheets from travelers
    if (travelers.length > 0) {
      for (var j = 0; j < travelers.length; j++) {
        var trav = travelers[j];
        if (!trav.nfsFileId) continue;
        try {
          var nfsFile = Drive.Files.get(trav.nfsFileId, {
            supportsAllDrives: true,
            fields: 'id,name,webViewLink,size,mimeType,trashed'
          });

          if (nfsFile.trashed) {
            console.warn('Skipping trashed NFS file: ' + trav.nfsFileId);
            continue;
          }

          var nfsTravelerName = trav.employeeName || trav.name || trav.id;
          var nfsSafeName = sanitizeFolderName_(nfsTravelerName);
          if (!travelersFolder) {
            travelersFolder = getOrCreateSubfolder_(requestFolder, 'Travelers');
          }
          if (!travelerFolders[nfsSafeName]) {
            travelerFolders[nfsSafeName] = getOrCreateSubfolder_(travelersFolder, nfsSafeName);
          }

          var nfsMoved = Drive.Files.update(
            { name: nfsFile.name },
            trav.nfsFileId,
            null,
            {
              addParents: travelerFolders[nfsSafeName].getId(),
              removeParents: getDraftFolder_(options.draftId || '').getId(),
              supportsAllDrives: true,
              fields: 'id,name,webViewLink'
            }
          );

          var nfsAttachmentId = 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

          attachmentRows.push([
            requestId,
            nfsAttachmentId,
            trav.id,
            nfsMoved.name,
            nfsMoved.id,
            nfsMoved.webViewLink,
            nfsFile.mimeType,
            parseInt(nfsFile.size, 10) || 0,
            'nfs_worksheet',
            submitterEmail,
            now
          ]);

          attachments.push({
            attachmentId: nfsAttachmentId,
            fileId: nfsMoved.id,
            fileName: nfsMoved.name,
            fileUrl: nfsMoved.webViewLink,
            fileSize: parseInt(nfsFile.size, 10) || 0,
            mimeType: nfsFile.mimeType,
            travelerId: trav.id,
            category: 'nfs_worksheet'
          });

        } catch (e) {
          console.error('Error processing NFS file for traveler ' + trav.id + ':', e);
        }
      }
    }

    // Write Attachments rows to the database
    if (attachmentRows.length > 0) {
      var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
      var attachSheet = ss.getSheetByName(SHEET_NAMES.ATTACHMENTS);
      if (attachSheet) {
        attachSheet.getRange(
          attachSheet.getLastRow() + 1, 1,
          attachmentRows.length, attachmentRows[0].length
        ).setValues(attachmentRows);
      }
    }

    // Update request with folder URL
    updateRequestAttachmentsFolder(requestId, requestFolder.getUrl());

    // Clean up empty draft folder
    if (options.draftId) {
      cleanupDraftFolder_(options.draftId);
    }

    console.log('Finalized ' + attachments.length + ' files for ' + requestId);
    return { success: true, folderUrl: requestFolder.getUrl(), attachments: attachments };

  } catch (error) {
    console.error('Error finalizing attachments:', error);
    logError('finalizeRequestAttachments', error, { requestId: requestId });
    return {
      success: false,
      error: error.message || 'Failed to finalize attachments'
    };
  }
}

/**
 * Share attachments with additional users (e.g., next reviewer in the chain).
 * Since files live on the Shared Drive, this uses Advanced Drive API permissions.
 *
 * @param {string[]} fileIds - Array of Drive file IDs
 * @param {string[]} emails - Emails to share with
 * @param {string} accessLevel - 'reader' or 'writer' (default 'reader')
 * @returns {Object} { success }
 */
function shareAttachmentsWithUsers(fileIds, emails, accessLevel) {
  accessLevel = accessLevel || 'reader';
  try {
    if (!fileIds || !emails || fileIds.length === 0 || emails.length === 0) {
      return { success: true };
    }

    for (var i = 0; i < fileIds.length; i++) {
      for (var j = 0; j < emails.length; j++) {
        var email = emails[j].trim();
        if (email) {
          shareFileSilent_(fileIds[i], email, accessLevel);
        }
      }
    }

    console.log('Shared ' + fileIds.length + ' files with ' + emails.join(', '));
    return { success: true };

  } catch (error) {
    console.error('Error sharing attachments:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// ATTACHMENT QUERIES
// ============================================================================

/**
 * Update the Attachments_Folder field in the Requests sheet.
 * @param {string} requestId
 * @param {string} folderUrl
 */
function updateRequestAttachmentsFolder(requestId, folderUrl) {
  try {
    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.REQUESTS);
    if (!sheet) return;

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var requestIdCol = headers.indexOf('Request_ID');
    var folderCol = headers.indexOf('Attachments_Folder');

    if (requestIdCol === -1 || folderCol === -1) return;

    for (var i = 1; i < data.length; i++) {
      if (data[i][requestIdCol] === requestId) {
        sheet.getRange(i + 1, folderCol + 1).setValue(folderUrl);
        break;
      }
    }
  } catch (error) {
    console.error('Error updating attachments folder:', error);
  }
}

/**
 * Get attachment records for a request.
 * @param {string} requestId
 * @returns {Object} { success, attachments: [...] }
 */
function getRequestAttachments(requestId) {
  try {
    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.ATTACHMENTS);

    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, attachments: [] };
    }

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var headerIndex = {};
    headers.forEach(function(h, i) { headerIndex[h] = i; });

    var attachments = [];

    for (var i = 1; i < data.length; i++) {
      if (data[i][headerIndex['Request_ID']] === requestId) {
        attachments.push({
          attachmentId: data[i][headerIndex['Attachment_ID']],
          travelerId: data[i][headerIndex['Traveler_ID']],
          fileName: data[i][headerIndex['File_Name']],
          fileId: data[i][headerIndex['File_ID']],
          fileUrl: data[i][headerIndex['File_URL']],
          fileType: data[i][headerIndex['File_Type']],
          fileSize: data[i][headerIndex['File_Size']],
          category: data[i][headerIndex['Category']],
          uploadedBy: data[i][headerIndex['Uploaded_By']],
          uploadedAt: data[i][headerIndex['Uploaded_At']]
        });
      }
    }

    return { success: true, attachments: attachments };

  } catch (error) {
    console.error('Error getting request attachments:', error);
    return { success: false, error: error.message, attachments: [] };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get or create a subfolder within a parent folder (works on Shared Drives).
 */
function getOrCreateSubfolder_(parent, name) {
  var parentId = typeof parent === 'string' ? parent : parent.getId();

  var query = "name = '" + name.replace(/'/g, "\\'") + "' and '" + parentId + "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  var result = Drive.Files.list({
    q: query,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    fields: 'files(id,name)'
  });

  if (result.files && result.files.length > 0) {
    return DriveApp.getFolderById(result.files[0].id);
  }

  var newFolder = Drive.Files.create(
    { name: name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    null,
    { supportsAllDrives: true }
  );
  return DriveApp.getFolderById(newFolder.id);
}

/**
 * Sanitize a string for use as a folder name.
 */
function sanitizeFolderName_(name) {
  if (!name) return 'Unknown';
  return name
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

/**
 * Share a file silently (no notification email) using Advanced Drive API.
 */
function shareFileSilent_(fileId, email, role) {
  if (!email) return;
  try {
    Drive.Permissions.create(
      { role: role, type: 'user', emailAddress: email },
      fileId,
      { sendNotificationEmail: false, supportsAllDrives: true }
    );
  } catch (e) {
    console.warn('Could not share file with ' + email + ':', e.message);
  }
}

/**
 * Clean up an empty draft folder after finalization.
 */
function cleanupDraftFolder_(draftId) {
  try {
    var draftsFolder = getDraftsFolder_();
    var query = "name = '" + draftId.replace(/'/g, "\\'") + "' and '" + draftsFolder.getId() + "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    var result = Drive.Files.list({
      q: query,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: 'files(id)'
    });

    if (result.files && result.files.length > 0) {
      // Check if folder is empty
      var contents = Drive.Files.list({
        q: "'" + result.files[0].id + "' in parents and trashed = false",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        fields: 'files(id)',
        pageSize: 1
      });

      if (!contents.files || contents.files.length === 0) {
        Drive.Files.update({ trashed: true }, result.files[0].id, null, { supportsAllDrives: true });
        console.log('Cleaned up empty draft folder: ' + draftId);
      }
    }
  } catch (e) {
    console.warn('Error cleaning up draft folder ' + draftId + ':', e);
  }
}
