import {
  cleanPreference,
  cleanText,
  isRecord,
  normalizeCsvHeader,
  normalizeRollNumber,
  readAttendeeCsvField,
  type Preference,
} from "./validation.ts";

export type GoogleRegistration = {
  rowNumber: number;
  name: string;
  email: string | null;
  roll_number: string;
  branch: string | null;
  preference: Preference;
};

export type RejectedGoogleRow = {
  row: number;
  reason: string;
};

export type ExistingRegistration = {
  id: string;
  roll_number: string | null;
  name: string;
  email: string | null;
  branch: string | null;
  preference: Preference;
  pass_token: string;
  checked_in_at: string | null;
  meal_collected_at: string | null;
};

function readEmail(row: Record<string, unknown>) {
  for (const [header, value] of Object.entries(row)) {
    if (["email", "email_address", "email_id"].includes(normalizeCsvHeader(header)) && cleanText(value)) {
      return cleanText(value, 254).toLowerCase();
    }
  }
  return null;
}

function getRowNumber(row: Record<string, unknown>, index: number) {
  const rowNumber = Number(row.rowNumber);
  return Number.isSafeInteger(rowNumber) && rowNumber >= 2 ? rowNumber : index + 2;
}

export function prepareGoogleRegistrations(rawRows: unknown[]) {
  const records: GoogleRegistration[] = [];
  const rejectedRows: RejectedGoogleRow[] = [];

  for (const [index, rawRow] of rawRows.entries()) {
    const rowNumber = isRecord(rawRow) ? getRowNumber(rawRow, index) : index + 2;
    if (!isRecord(rawRow)) {
      rejectedRows.push({ row: rowNumber, reason: "Row must contain registration fields." });
      continue;
    }

    const name = cleanText(readAttendeeCsvField(rawRow, "name"), 100);
    const rollNumber = normalizeRollNumber(readAttendeeCsvField(rawRow, "roll_number"));
    const branch = cleanText(readAttendeeCsvField(rawRow, "branch") ?? readAttendeeCsvField(rawRow, "section"), 80) || null;
    const rawPreference = readAttendeeCsvField(rawRow, "preference");
    const preference = cleanPreference(rawPreference);
    const email = readEmail(rawRow);
    const errors: string[] = [];

    if (name.length < 2) errors.push("Name is required.");
    if (!rollNumber) errors.push("Hall ticket number is required.");
    if (!cleanText(rawPreference) || !preference) errors.push("Food preference must be VEG or NON_VEG.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email address is invalid.");

    if (errors.length || !rollNumber || !preference) {
      rejectedRows.push({ row: rowNumber, reason: errors.join(" ") });
      continue;
    }

    records.push({ rowNumber, name, email, roll_number: rollNumber, branch, preference });
  }

  const rowNumbersByRoll = new Map<string, number[]>();
  for (const record of records) {
    const rowNumbers = rowNumbersByRoll.get(record.roll_number) ?? [];
    rowNumbers.push(record.rowNumber);
    rowNumbersByRoll.set(record.roll_number, rowNumbers);
  }
  const duplicateRows = new Set<number>();
  let duplicateRollNumbers = 0;
  for (const [rollNumber, rowNumbers] of rowNumbersByRoll) {
    if (rowNumbers.length < 2) continue;
    duplicateRollNumbers++;
    for (const row of rowNumbers) {
      duplicateRows.add(row);
      rejectedRows.push({ row, reason: `Roll number ${rollNumber} appears more than once in the submitted records.` });
    }
  }

  return {
    totalRows: rawRows.length,
    records: records.filter((record) => !duplicateRows.has(record.rowNumber)),
    rejectedRows: rejectedRows.sort((left, right) => left.row - right.row),
    duplicateRollNumbers,
  };
}

export function buildGoogleSyncPreview(
  prepared: ReturnType<typeof prepareGoogleRegistrations>,
  existing: ExistingRegistration[],
) {
  const existingByRoll = new Map<string, ExistingRegistration[]>();
  for (const attendee of existing) {
    const rollNumber = normalizeRollNumber(attendee.roll_number);
    if (!rollNumber) continue;
    const matches = existingByRoll.get(rollNumber) ?? [];
    matches.push(attendee);
    existingByRoll.set(rollNumber, matches);
  }

  let wouldInsert = 0;
  let wouldUpdate = 0;
  let unchanged = 0;
  let matchedExisting = 0;
  let preservedCheckIns = 0;
  let preservedMealCheckIns = 0;
  let existingDuplicateRollNumbers = 0;
  const rejectedRows = [...prepared.rejectedRows];

  for (const [rollNumber, matches] of existingByRoll) {
    if (matches.length > 1) existingDuplicateRollNumbers++;
  }

  for (const record of prepared.records) {
    const matches = existingByRoll.get(record.roll_number) ?? [];
    if (matches.length > 1) {
      rejectedRows.push({
        row: record.rowNumber,
        reason: `Roll number ${record.roll_number} matches more than one existing attendee.`,
      });
      continue;
    }
    const attendee = matches[0];
    if (!attendee) {
      wouldInsert++;
      continue;
    }

    matchedExisting++;
    if (attendee.checked_in_at) preservedCheckIns++;
    if (attendee.meal_collected_at) preservedMealCheckIns++;
    const changed = attendee.name !== record.name
      || (record.email !== null && (attendee.email ?? "").trim().toLowerCase() !== record.email)
      || (record.branch !== null && (attendee.branch ?? "") !== record.branch)
      || attendee.preference !== record.preference;
    if (changed) wouldUpdate++;
    else unchanged++;
  }

  return {
    totalRows: prepared.totalRows,
    validRows: prepared.records.length,
    matchedExisting,
    wouldInsert,
    wouldUpdate,
    unchanged,
    rejected: rejectedRows.length,
    duplicateRollNumbers: prepared.duplicateRollNumbers,
    existingDuplicateRollNumbers,
    preservedPassTokens: matchedExisting,
    preservedCheckIns,
    preservedMealCheckIns,
    rejectedRows: rejectedRows.sort((left, right) => left.row - right.row),
  };
}
