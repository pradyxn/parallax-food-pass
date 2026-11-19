const GOOGLE_SYNC_PROPERTY_KEYS = {
  endpoint: "GOOGLE_SYNC_ENDPOINT",
  secret: "GOOGLE_SYNC_SECRET",
  spreadsheetId: "GOOGLE_RESPONSE_SPREADSHEET_ID",
  initialSyncComplete: "GOOGLE_INITIAL_SYNC_COMPLETE",
  lastSyncId: "GOOGLE_LAST_SYNC_ID",
  lastSuccessAt: "GOOGLE_LAST_SUCCESS_AT",
};

function configureGoogleSync() {
  const ui = SpreadsheetApp.getUi();
  const endpointReply = ui.prompt(
    "Configure Food Pass sync",
    "Enter the deployed HTTPS endpoint, ending in /api/sync/google.",
    ui.ButtonSet.OK_CANCEL
  );
  if (endpointReply.getSelectedButton() !== ui.Button.OK) return;
  const endpoint = endpointReply.getResponseText().trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+\/api\/sync\/google$/.test(endpoint)) {
    ui.alert("Use the deployed HTTPS URL ending in /api/sync/google.");
    return;
  }

  const secretReply = ui.prompt(
    "Configure Food Pass sync",
    "Enter the GOOGLE_SYNC_SECRET configured on the server. It will be stored in Apps Script properties, not in sheet cells or browser code.",
    ui.ButtonSet.OK_CANCEL
  );
  if (secretReply.getSelectedButton() !== ui.Button.OK) return;
  const secret = secretReply.getResponseText().trim();
  if (secret.length < 32) {
    ui.alert("The sync secret must contain at least 32 characters.");
    return;
  }
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Open this script from the linked response spreadsheet before configuring it.");

  PropertiesService.getScriptProperties().setProperties({
    [GOOGLE_SYNC_PROPERTY_KEYS.endpoint]: endpoint,
    [GOOGLE_SYNC_PROPERTY_KEYS.secret]: secret,
    [GOOGLE_SYNC_PROPERTY_KEYS.spreadsheetId]: spreadsheet.getId(),
  });
  ui.alert("Configuration saved in this Apps Script project's properties.");
}

function runInitialSyncWithReview() {
  const ui = SpreadsheetApp.getUi();
  const snapshot = readGoogleFormResponses_();
  const preview = requestGoogleSync_(snapshot.records, true);
  logDryRun_(preview);

  if (preview.rejected > 0
    || preview.duplicateRollNumbers > 0
    || preview.existingDuplicateRollNumbers > 0
    || preview.validRows !== snapshot.records.length) {
    ui.alert(
      "Initial sync stopped",
      formatDryRun_(preview) + "\n\nResolve every rejected or duplicate row and run the dry-run again. No attendee records were written.",
      ui.ButtonSet.OK
    );
    return;
  }

  const confirmation = ui.alert(
    "Review before initial sync",
    formatDryRun_(preview)
      + "\n\nExisting pass tokens and check-in timestamps are preserved by the server. Continue with this full-sheet synchronization?",
    ui.ButtonSet.OK_CANCEL
  );
  if (confirmation !== ui.Button.OK) {
    Logger.log("Initial synchronization cancelled after dry-run; no records written.");
    return;
  }

  const result = writeGoogleSync_(snapshot.records, true);
  PropertiesService.getScriptProperties().setProperties({
    [GOOGLE_SYNC_PROPERTY_KEYS.initialSyncComplete]: "true",
    [GOOGLE_SYNC_PROPERTY_KEYS.lastSyncId]: result.syncId,
    [GOOGLE_SYNC_PROPERTY_KEYS.lastSuccessAt]: new Date().toISOString(),
  });
  ui.alert("Initial synchronization complete", formatSyncResult_(result), ui.ButtonSet.OK);
}

function installFiveMinuteTrigger() {
  const scriptProperties = PropertiesService.getScriptProperties();
  if (!scriptProperties.getProperty(GOOGLE_SYNC_PROPERTY_KEYS.endpoint)
    || !scriptProperties.getProperty(GOOGLE_SYNC_PROPERTY_KEYS.secret)
    || !scriptProperties.getProperty(GOOGLE_SYNC_PROPERTY_KEYS.spreadsheetId)) {
    throw new Error("Run configureGoogleSync() before installing the trigger.");
  }

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "scheduledGoogleSync") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("scheduledGoogleSync").timeBased().everyMinutes(5).create();
  Logger.log("Installed one scheduledGoogleSync trigger to run every five minutes.");
}

function scheduledGoogleSync() {
  try {
    const result = synchronizeCurrentSheet_();
    if (result) Logger.log(formatSyncResult_(result));
  } catch (error) {
    Logger.log("Google Sheets synchronization failed: " + error.message);
    throw error;
  }
}

function synchronizeCurrentSheet_() {
  const snapshot = readGoogleFormResponses_();
  const preview = requestGoogleSync_(snapshot.records, true);
  logDryRun_(preview);
  if (preview.rejected > 0
    || preview.duplicateRollNumbers > 0
    || preview.existingDuplicateRollNumbers > 0
    || preview.validRows !== snapshot.records.length) {
    throw new Error("Dry-run found invalid or duplicate rows. No records from this run were written.");
  }

  const scriptProperties = PropertiesService.getScriptProperties();
  if (scriptProperties.getProperty(GOOGLE_SYNC_PROPERTY_KEYS.initialSyncComplete) !== "true") {
    Logger.log("Dry-run passed, but initial synchronization has not been explicitly confirmed; no records written.");
    return null;
  }

  const result = writeGoogleSync_(snapshot.records);
  scriptProperties.setProperties({
    [GOOGLE_SYNC_PROPERTY_KEYS.lastSyncId]: result.syncId,
    [GOOGLE_SYNC_PROPERTY_KEYS.lastSuccessAt]: new Date().toISOString(),
  });
  return result;
}

function readGoogleFormResponses_() {
  const spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty(GOOGLE_SYNC_PROPERTY_KEYS.spreadsheetId);
  if (!spreadsheetId) throw new Error("Run configureGoogleSync() before synchronizing.");
  const sheets = SpreadsheetApp.openById(spreadsheetId).getSheets();
  let sheet = null;
  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
    const candidate = sheets[sheetIndex];
    const lastColumn = candidate.getLastColumn();
    if (!lastColumn) continue;
    const headers = candidate.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(normalizeGoogleHeader_);
    if (findGoogleHeader_(headers, ["name", "student_name", "full_name"]) >= 0
      && findGoogleHeader_(headers, ["hall_ticket_no", "hall_ticket_number", "roll_number", "roll_no"]) >= 0
      && findGoogleHeader_(headers, ["food_preference", "preference", "what_is_your_food_preference", "food_choice"]) >= 0) {
      sheet = candidate;
      break;
    }
  }
  if (!sheet) throw new Error("Could not find a sheet with Name, Hall ticket No:, and Food Preference headers.");
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) throw new Error("The response sheet has no registration rows.");

  const headers = values[0].map(normalizeGoogleHeader_);
  const columns = {
    name: findGoogleHeader_(headers, ["name", "student_name", "full_name"]),
    email: findGoogleHeader_(headers, ["email_address", "email", "email_id"]),
    roll_number: findGoogleHeader_(headers, ["hall_ticket_no", "hall_ticket_number", "roll_number", "roll_no"]),
    branch: findGoogleHeader_(headers, ["section", "branch", "department", "dept", "course"]),
    preference: findGoogleHeader_(headers, [
      "food_preference",
      "preference",
      "what_is_your_food_preference",
      "food_choice",
    ]),
  };
  const required = ["name", "roll_number", "preference"];
  const missing = required.filter(function (field) { return columns[field] < 0; });
  if (missing.length) {
    throw new Error("Missing required Google Forms headers: " + missing.join(", "));
  }

  const records = [];
  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    if (row.every(function (cell) { return !String(cell).trim(); })) continue;
    records.push({
      rowNumber: index + 1,
      name: row[columns.name],
      email: row[columns.email],
      roll_number: row[columns.roll_number],
      branch: row[columns.branch],
      preference: row[columns.preference],
    });
  }
  if (!records.length) throw new Error("The response sheet has no non-empty registration rows.");
  if (records.length > 1200) throw new Error("This sync supports at most 1,200 response rows per complete dry-run.");
  return { records: records };
}

function normalizeGoogleHeader_(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function findGoogleHeader_(headers, aliases) {
  for (let index = 0; index < headers.length; index++) {
    if (aliases.indexOf(headers[index]) >= 0) return index;
  }
  return -1;
}

function requestGoogleSync_(records, dryRun) {
  const config = getGoogleSyncConfiguration_();
  const response = UrlFetchApp.fetch(config.endpoint, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + config.secret },
    payload: JSON.stringify({ dryRun: dryRun, records: records }),
    muteHttpExceptions: true,
  });
  return parseGoogleSyncResponse_(response);
}

function writeGoogleSync_(records, suppressEmails) {
  const config = getGoogleSyncConfiguration_();
  const syncId = Utilities.getUuid();
  const batchSize = 100;
  const batchCount = Math.ceil(records.length / batchSize);
  const total = { syncId: syncId, rows: records.length, inserted: 0, updated: 0, unchanged: 0, rejected: 0 };

  for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
    const batch = records.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
    const response = UrlFetchApp.fetch(config.endpoint, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + config.secret },
      payload: JSON.stringify({
        syncId: syncId,
        batchIndex: batchIndex,
        batchCount: batchCount,
        suppressEmails: suppressEmails === true,
        records: batch,
      }),
      muteHttpExceptions: true,
    });
    const result = parseGoogleSyncResponse_(response);
    total.inserted += Number(result.inserted || 0);
    total.updated += Number(result.updated || 0);
    total.unchanged += Number(result.unchanged || 0);
    total.rejected += Number(result.rejected || 0);
    Logger.log("Completed batch " + (batchIndex + 1) + "/" + batchCount + ": "
      + result.inserted + " inserted, " + result.updated + " updated, "
      + result.unchanged + " unchanged, " + result.rejected + " rejected.");
    if (result.emailDeliveryError) Logger.log("Pass email delivery warning: " + result.emailDeliveryError);
    if (result.emailDelivery) {
      Logger.log("Pass email delivery for batch: " + result.emailDelivery.sent + " sent, "
        + result.emailDelivery.failed + " failed, " + result.emailDelivery.skipped + " skipped.");
    }
    if (result.rejected > 0) {
      throw new Error("The server rejected records in batch " + (batchIndex + 1) + ". Review API response and sync logs.");
    }
  }
  if (total.rejected > 0) throw new Error("Synchronization completed with rejected records.");
  return total;
}

function parseGoogleSyncResponse_(response) {
  const status = response.getResponseCode();
  const body = response.getContentText();
  let result;
  try {
    result = JSON.parse(body);
  } catch (error) {
    throw new Error("Sync API returned non-JSON data (HTTP " + status + ").");
  }
  if (!result || typeof result !== "object") {
    throw new Error("Sync API returned an invalid response object (HTTP " + status + ").");
  }
  if (status < 200 || status >= 300) {
    throw new Error("Sync API returned HTTP " + status + ": " + (result.error || "Unknown API error."));
  }
  return result;
}

function getGoogleSyncConfiguration_() {
  const properties = PropertiesService.getScriptProperties();
  const endpoint = properties.getProperty(GOOGLE_SYNC_PROPERTY_KEYS.endpoint);
  const secret = properties.getProperty(GOOGLE_SYNC_PROPERTY_KEYS.secret);
  if (!endpoint || !secret) throw new Error("Run configureGoogleSync() before synchronizing.");
  return { endpoint: endpoint, secret: secret };
}

function logDryRun_(preview) {
  Logger.log("Google Sheets dry-run: " + formatDryRun_(preview));
}

function formatDryRun_(preview) {
  const lines = [
    "Rows: " + preview.totalRows,
    "Valid: " + preview.validRows,
    "Matched existing: " + preview.matchedExisting,
    "Would insert: " + preview.wouldInsert,
    "Would update: " + preview.wouldUpdate,
    "Unchanged: " + preview.unchanged,
    "Rejected: " + preview.rejected,
    "Duplicate response roll numbers: " + preview.duplicateRollNumbers,
    "Duplicate roll numbers already in Food Pass: " + preview.existingDuplicateRollNumbers,
    "Existing pass tokens preserved: " + preview.preservedPassTokens,
    "Existing check-ins preserved: " + preview.preservedCheckIns,
    "Existing meal check-ins preserved: " + preview.preservedMealCheckIns,
  ];
  (preview.rejectedRows || []).slice(0, 10).forEach(function (item) {
    lines.push("Row " + item.row + ": " + item.reason);
  });
  if ((preview.rejectedRows || []).length > 10) {
    lines.push("...and " + (preview.rejectedRows.length - 10) + " more rejected rows.");
  }
  return lines.join("\n");
}

function formatSyncResult_(result) {
  return "Sync " + result.syncId + ": " + result.rows + " rows, "
    + result.inserted + " inserted, " + result.updated + " updated, "
    + result.unchanged + " unchanged, " + result.rejected + " rejected.";
}
