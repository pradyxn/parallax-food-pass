import assert from "node:assert/strict";
import test from "node:test";
import Papa from "papaparse";
import { prepareAttendeeCsvRows } from "../lib/csv-import.ts";
import {
  cleanPreference,
  identifyAttendeeCsvField,
  normalizeAttendeeCsvHeader,
} from "../lib/validation.ts";

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
  const result = Papa.parse(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeAttendeeCsvHeader,
  });
  assert.deepEqual(result.errors, []);
  return result.data;
}

test("Google Forms headers dry-run recognizes all 202 rows", () => {
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
  const rows = parseCsv(csv);
  const preview = prepareAttendeeCsvRows(rows);

  assert.equal(rows.length, 202);
  assert.deepEqual(preview.missingHeaders, []);
  assert.equal(preview.parsedRows.length, 202);
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.parsedRows[0].branch, "CS");
  assert.equal(preview.parsedRows[0].preference, "NON_VEG");
  assert.equal(preview.parsedRows[1].preference, "VEG");
});

test("cleaned headers dry-run recognizes all 202 rows with optional branch", () => {
  const csv = makeCsv(cleanedHeaders, (index) => [
    `Student ${index + 1}`,
    `26IT${String(index + 1).padStart(3, "0")}`,
    "",
    index % 2 === 0 ? "VEG" : "NON_VEG",
  ]);
  const preview = prepareAttendeeCsvRows(parseCsv(csv));

  assert.equal(preview.parsedRows.length, 202);
  assert.deepEqual(preview.issues, []);
  assert.ok(preview.parsedRows.every((row) => row.branch === null));
});

test("headers and preference values accept the requested variants", () => {
  for (const header of [
    "Food Preference",
    "Food Preference ",
    "food_preference",
    "preference",
    "What is your food preference?",
  ]) {
    assert.equal(identifyAttendeeCsvField(header), "preference");
    assert.equal(normalizeAttendeeCsvHeader(header), "preference");
  }
  assert.equal(identifyAttendeeCsvField("Hall ticket No:"), "roll_number");
  assert.equal(identifyAttendeeCsvField(" Section"), "section");
  for (const value of ["Veg", "Vegetarian"]) assert.equal(cleanPreference(value), "VEG");
  for (const value of ["Non veg", "Non-Veg", "Non-Vegetarian"]) {
    assert.equal(cleanPreference(value), "NON_VEG");
  }
});


test("separate branch and section columns round-trip independently", () => {
  const preview = prepareAttendeeCsvRows([
    { name: "Student One", roll_number: "26CS001", branch: "CSM", section: "2A", preference: "VEG" },
  ]);

  assert.equal(preview.parsedRows.length, 1);
  assert.equal(preview.parsedRows[0].branch, "CSM");
  assert.equal(preview.parsedRows[0].section, "2A");
});

test("dry-run preparation preserves duplicate and invalid-row reporting", () => {
  const preview = prepareAttendeeCsvRows([
    { name: "Student One", roll_number: "26CS001", preference: "VEG" },
    { name: "Student Two", roll_number: "26CS001", preference: "NON_VEG" },
    { name: "Student Three", roll_number: "26CS003", preference: "Maybe" },
    { name: "Student Four", roll_number: "26CS004", preference: "" },
  ]);

  assert.equal(preview.parsedRows.length, 1);
  assert.deepEqual(preview.issues.map((issue) => issue.category), [
    "duplicate",
    "invalid_food_preference",
    "missing_fields",
  ]);
  assert.deepEqual(preview.issues.map((issue) => issue.row), [3, 4, 5]);
});
