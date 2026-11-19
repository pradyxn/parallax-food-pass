import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const { count, error } = await getSupabaseAdmin()
      .from("attendees")
      .select("id", { count: "exact" })
      .limit(0);
    if (error) {
      return NextResponse.json({
        ok: false,
        error: getSafeDatabaseErrorMessage(error, "Supabase attendee read failed."),
      }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (count === null) {
      return NextResponse.json({
        ok: false,
        error: "Supabase responded but did not return an exact attendee count.",
      }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({
      ok: true,
      database: "connected",
      table: "public.attendees",
      attendeeCount: count,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: getSafeDatabaseErrorMessage(error, "Could not verify the Supabase connection."),
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
