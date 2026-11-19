import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { previewGoogleRegistrations } from "@/lib/google-sync-database";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isRecord } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Provide valid JSON registration rows." }, { status: 400 });
    }
    if (!isRecord(body) || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "Provide at least one registration row to preview." }, { status: 400 });
    }
    if (body.records.length > 1200) {
      return NextResponse.json({ error: "A preview may contain at most 1,200 rows." }, { status: 413 });
    }
    const report = await previewGoogleRegistrations(getSupabaseAdmin(), body.records);
    return NextResponse.json({ dryRun: true, ...report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: getSafeDatabaseErrorMessage(error, "Could not preview Google registrations."),
    }, { status: 500 });
  }
}
