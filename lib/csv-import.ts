import {
  cleanPreference,
  cleanText,
  identifyAttendeeCsvField,
  isRecord,
  normalizeRollNumber,
  readAttendeeCsvField,
  type AttendeeCsvField,
  type Preference,
} from "./validation.ts";

export type ImportIssue = {
  row: number;
  category: "missing_fields" | "invalid_food_preference" | "invalid_row" | "duplicate";
  reason: string;
  fields?: string[];
  value?: string;
};

export type AttendeeImport = {
  name: string;
  roll_number: string;
  branch: string | null;
  preference: Preference;
  email: string | null;
  source: "IMPORT";
  rowNumber: number;
};

export function prepareAttendeeCsvRows(rows: unknown[]) {
  const issues: ImportIssue[] = [];
  const availableFields = new Set(
    rows.flatMap((row) =>
      isRecord(row)
        ? Object.keys(row).map(identifyAttendeeCsvField).filter((field) => field !== null)
        : [],
    ),
  );
  const missingHeaders = (["name", "roll_number", "preference"] as const)
    .filter((field) => !availableFields.has(field));

  if (missingHeaders.length) {
    const fieldNames: Record<(typeof missingHeaders)[number], string> = {
      name: "Student name",
      roll_number: "Roll number",
      preference: "Food preference",
    };
    const fields = missingHeaders.map((field) => fieldNames[field]);
    for (let index = 0; index < rows.length; index++) {
      issues.push({
        row: index + 2,
        category: "missing_fields",
        fields,
        reason: `Missing required CSV column${fields.length === 1 ? "" : "s"}: ${fields.join(", ")}.`,
      });
    }
    return { parsedRows: [] as AttendeeImport[], issues, missingHeaders };
  }

  const parsedRows: AttendeeImport[] = [];
  const seenRollNumbers = new Set<string>();
  for (const [index, rawRow] of rows.entries()) {
    const rowNumber = index + 2;
    if (!isRecord(rawRow)) {
      issues.push({ row: rowNumber, category: "invalid_row", reason: "Row must contain CSV columns." });
      continue;
    }

    const name = cleanText(readAttendeeCsvField(rawRow, "name"), 100);
    const rollNumber = normalizeRollNumber(readAttendeeCsvField(rawRow, "roll_number"));
    const branch = cleanText(readAttendeeCsvField(rawRow, "branch"), 80) || null;
    const rawPreference = readAttendeeCsvField(rawRow, "preference");
    const preference = cleanPreference(rawPreference);
    const rawEmail = cleanText(readAttendeeCsvField(rawRow, "email"), 254).toLowerCase();
    const email = rawEmail || null;
    const missing: string[] = [];
    if (name.length < 2) missing.push("Student name");
    if (!rollNumber) missing.push("Roll number");
    if (!cleanText(rawPreference)) missing.push("Food preference");

    if (missing.length) {
      issues.push({
        row: rowNumber,
        category: "missing_fields",
        fields: missing,
        reason: `Missing or invalid required field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
      });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      issues.push({ row: rowNumber, category: "invalid_row", reason: `Invalid email address "${email}".` });
      continue;
    }
    if (cleanText(rawPreference) && !preference) {
      issues.push({
        row: rowNumber,
        category: "invalid_food_preference",
        value: cleanText(rawPreference, 100),
        reason: `Food preference "${cleanText(rawPreference, 100)}" is invalid. Use VEG or NON_VEG.`,
      });
    }
    if (missing.length || !preference || !rollNumber) continue;

    if (seenRollNumbers.has(rollNumber)) {
      issues.push({
        row: rowNumber,
        category: "duplicate",
        reason: `Duplicate roll number ${rollNumber} in this CSV.`,
      });
      continue;
    }
    seenRollNumbers.add(rollNumber);
    parsedRows.push({
      name,
      roll_number: rollNumber,
      branch,
      preference,
      email,
      source: "IMPORT",
      rowNumber,
    });
  }

  return { parsedRows, issues, missingHeaders: [] as AttendeeCsvField[] };
}
