import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function csvCell(value: unknown) {
  let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[\u0000-\u0020\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const { data, error } = await getSupabaseAdmin().from("attendees")
      .select("name, roll_number, branch, preference, source, pass_token, created_at, checked_in_at, meal_collected_at")
      .order("created_at", { ascending: true }).limit(10000);
    if (error) throw error;
    const header = ["name", "roll_number", "branch", "food_preference", "source", "pass_url", "registered_at", "checked_in_at", "meal_collected_at"];
    const lines = [header, ...(data ?? []).map((r) => [r.name, r.roll_number, r.branch, r.preference, r.source, `${request.nextUrl.origin}/pass/${r.pass_token}`, r.created_at, r.checked_in_at, r.meal_collected_at])]
      .map((row) => row.map(csvCell).join(","));
    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="parallax-food-pass-report.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getSafeDatabaseErrorMessage(error, "Could not export report.") },
      { status: 500 },
    );
  }
}
