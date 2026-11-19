import assert from "node:assert/strict";
import test from "node:test";
import Papa from "papaparse";
import {
  buildGoogleSyncPreview,
  prepareGoogleRegistrations,
} from "../lib/google-sync.ts";

const googleHeaders = [
  "Timestamp",
  "Email Address",
  "Name",
  "Hall ticket No:",
  "Year",
  " Section",
  "Food Preference ",
  "Any ideas you would like to suggest for the event?",
  "fill this If you have any questions",
];
const cleanedHeaders = ["name", "roll_number", "branch", "preference"];

function makeCsv(headers, makeRow) {
  return [
    headers.map((header) => `"${header.replaceAll('"', '""')}"`).join(","),
    ...Array.from({ length: 202 }, (_, index) =>
      makeRow(index).map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","),
    ),
  ].join("\n");
}

function parseCsv(csv) {
  const result = Papa.parse(csv, { header: true, skipEmptyLines: true });
  assert.deepEqual(result.errors, []);
  return result.data;
}

function existingFor(records) {
  return records.map((record, index) => ({
    id: `attendee-${index}`,
    roll_number: record.roll_number,
    name: record.name,
    email: record.email,
    branch: record.branch,
    preference: record.preference,
    pass_token: `token-${index}`,
    checked_in_at: index % 2 === 0 ? "2026-11-20T10:00:00Z" : null,
    meal_collected_at: index % 3 === 0 ? "2026-11-20T12:00:00Z" : null,
  }));
}

test("Google Forms response export dry-run recognizes all 202 registrations", () => {
  const csv = makeCsv(googleHeaders, (index) => [
    "2026-11-19 10:00:00",
    `student${index}@example.test`,
    `Student ${index + 1}`,
    `26CS${String(index + 1).padStart(3, "0")}`,
    "1",
    "CS",
    index % 2 === 0 ? "Non veg" : "Vegetarian",
    "",
    "",
  ]);
  const prepared = prepareGoogleRegistrations(parseCsv(csv));
  const preview = buildGoogleSyncPreview(prepared, existingFor(prepared.records));

  assert.equal(preview.totalRows, 202);
  assert.equal(preview.validRows, 202);
  assert.equal(preview.matchedExisting, 202);
  assert.equal(preview.unchanged, 202);
  assert.equal(preview.wouldInsert, 0);
  assert.equal(preview.wouldUpdate, 0);
  assert.equal(preview.rejected, 0);
  assert.equal(prepared.records.filter((row) => row.preference === "VEG").length, 101);
  assert.equal(prepared.records.filter((row) => row.preference === "NON_VEG").length, 101);
});

test("cleaned CSV dry-run recognizes all 202 records and keeps branch optional", () => {
  const csv = makeCsv(cleanedHeaders, (index) => [
    `Student ${index + 1}`,
    `26IT${String(index + 1).padStart(3, "0")}`,
    "",
    index % 2 === 0 ? "VEG" : "NON_VEG",
  ]);
  const prepared = prepareGoogleRegistrations(parseCsv(csv));
  const preview = buildGoogleSyncPreview(prepared, []);

  assert.equal(preview.totalRows, 202);
  assert.equal(preview.validRows, 202);
  assert.equal(preview.wouldInsert, 202);
  assert.equal(preview.rejected, 0);
  assert.ok(prepared.records.every((row) => row.branch === null));
});

test("dry-run preserves existing data on blank optional fields and reports changed records", () => {
  const existing = [{
    id: "attendee-1",
    roll_number: "26CS001",
    name: "Student One",
    email: "old@example.test",
    branch: "CS",
    preference: "VEG",
    pass_token: "stable-token",
    checked_in_at: "2026-11-20T10:00:00Z",
    meal_collected_at: "2026-11-20T12:00:00Z",
  }];
  const unchanged = prepareGoogleRegistrations([{
    name: "Student One",
    roll_number: "26cs001",
    branch: "",
    email: "",
    preference: "Vegetarian",
  }]);
  const unchangedPreview = buildGoogleSyncPreview(unchanged, existing);
  assert.equal(unchangedPreview.unchanged, 1);
  assert.equal(unchangedPreview.preservedPassTokens, 1);
  assert.equal(unchangedPreview.preservedCheckIns, 1);
  assert.equal(unchangedPreview.preservedMealCheckIns, 1);
  assert.equal(existing[0].pass_token, "stable-token");

  const changed = prepareGoogleRegistrations([{
    name: "Student One",
    roll_number: "26CS001",
    email: "new@example.test",
    branch: "IT",
    preference: "Non-Vegetarian",
  }]);
  const changedPreview = buildGoogleSyncPreview(changed, existing);
  assert.equal(changedPreview.wouldUpdate, 1);
  assert.equal(changedPreview.preservedPassTokens, 1);
  assert.equal(changedPreview.preservedCheckIns, 1);
  assert.equal(changedPreview.preservedMealCheckIns, 1);
});

test("dry-run rejects every duplicate roll number and reports invalid rows", () => {
  const prepared = prepareGoogleRegistrations([
    { name: "Student One", roll_number: "26CS001", preference: "VEG" },
    { name: "Student Two", roll_number: "26cs001", preference: "NON VEG" },
    { name: "Student Three", roll_number: "26CS003", preference: "Maybe" },
  ]);
  const preview = buildGoogleSyncPreview(prepared, []);

  assert.equal(preview.duplicateRollNumbers, 1);
  assert.equal(preview.validRows, 0);
  assert.equal(preview.rejected, 3);
  assert.deepEqual(preview.rejectedRows.map((row) => row.row), [2, 3, 4]);
});
