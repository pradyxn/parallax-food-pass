import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { getSupabaseAdmin } from "@/lib/supabase";
import { prepareAttendeeCsvRows, type AttendeeImport, type ImportIssue } from "@/lib/csv-import";
import { isRecord } from "@/lib/validation";

export const runtime = "nodejs";

function importReport(totalRows: number, imported: number, issues: ImportIssue[], notProcessed: number) {
  const invalidRows = new Set(
    issues.filter((issue) => issue.category !== "duplicate").map((issue) => issue.row),
  );
  const duplicates = issues.filter((issue) => issue.category === "duplicate").length;
  const missingFields = issues
    .filter((issue) => issue.category === "missing_fields")
    .map(({ row, fields, reason }) => ({ row, fields: fields ?? [], reason }));
  const invalidFoodPreferences = issues
    .filter((issue) => issue.category === "invalid_food_preference")
    .map(({ row, value, reason }) => ({ row, value: value ?? "", reason }));

  return {
    totalRows,
    imported,
    duplicates,
    invalid: invalidRows.size,
    skipped: duplicates + invalidRows.size,
    missingFields,
    invalidFoodPreferences,
    notProcessed,
    issues,
  };
}

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const issues: ImportIssue[] = [];
  let imported = 0;
  let notProcessed = 0;
  let totalRows = 0;
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Provide valid JSON containing the parsed CSV rows." }, { status: 400 });
    }
    if (!isRecord(body) || !Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json({
        error: "No attendee rows were found in the CSV.",
        ...importReport(0, 0, [], 0),
      }, { status: 400 });
    }
    totalRows = body.rows.length;
    if (totalRows > 1200) {
      return NextResponse.json({
        error: "Import is limited to 1,200 rows at a time. Split the CSV into smaller batches.",
        ...importReport(totalRows, 0, [], totalRows),
      }, { status: 400 });
    }

    const { parsedRows, issues: rowIssues, missingHeaders } = prepareAttendeeCsvRows(body.rows);
    issues.push(...rowIssues);
    if (missingHeaders.length) {
      const fields = rowIssues[0]?.fields ?? [];
      return NextResponse.json({
        error: `Missing required CSV column${fields.length === 1 ? "" : "s"}: ${fields.join(", ")}.`,
        ...importReport(totalRows, 0, issues, 0),
      }, { status: 400 });
    }

    if (body.dryRun === true) {
      return NextResponse.json({
        ...importReport(totalRows, 0, issues, parsedRows.length),
        validRows: parsedRows.length,
        dryRun: true,
      });
    }

    notProcessed = parsedRows.length;
    if (parsedRows.length === 0) {
      return NextResponse.json(importReport(totalRows, imported, issues, notProcessed));
    }

    const db = getSupabaseAdmin();
    const existingRolls = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from("attendees")
        .select("roll_number")
        .not("roll_number", "is", null)
        .order("roll_number", { ascending: true })
        .range(offset, offset + 999);
      if (error) throw error;
      for (const attendee of data ?? []) {
        if (attendee.roll_number) existingRolls.add(attendee.roll_number.trim().toUpperCase());
      }
      if ((data?.length ?? 0) < 1000) break;
    }

    const fresh: AttendeeImport[] = [];
    for (const row of parsedRows) {
      if (existingRolls.has(row.roll_number)) {
        issues.push({
          row: row.rowNumber,
          category: "duplicate",
          reason: `Duplicate roll number ${row.roll_number} already registered.`,
        });
        notProcessed--;
      } else {
        fresh.push(row);
      }
    }

    if (fresh.length) {
      const rowsToInsert = fresh.map(({ rowNumber: _rowNumber, ...row }) => row);
      const { error } = await db.from("attendees").insert(rowsToInsert);
      if (!error) {
        imported = fresh.length;
        notProcessed = 0;
      } else if (error.code === "23505") {
        for (const { rowNumber, ...row } of fresh) {
          const { error: insertError } = await db.from("attendees").insert(row);
          if (!insertError) {
            imported++;
            notProcessed--;
          } else if (insertError.code === "23505") {
            issues.push({
              row: rowNumber,
              category: "duplicate",
              reason: `The attendee conflicts with an existing unique registration (${row.roll_number}).`,
            });
            notProcessed--;
          } else {
            throw insertError;
          }
        }
      } else {
        throw error;
      }
    }

    return NextResponse.json(importReport(totalRows, imported, issues, notProcessed));
  } catch (error) {
    return NextResponse.json({
      error: getSafeDatabaseErrorMessage(error, "CSV import failed."),
      ...importReport(totalRows, imported, issues, notProcessed),
    }, { status: 500 });
  }
}
