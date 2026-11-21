import { NextRequest, NextResponse } from "next/server";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
      return NextResponse.json({ error: "This pass could not be found." }, { status: 404 });
    }
    const { data, error } = await getSupabaseAdmin().from("attendees")
      .select("name, roll_number, branch, section, preference")
      .eq("pass_token", token).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "This pass could not be found." }, { status: 404 });
    return NextResponse.json({ attendee: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: getSafeDatabaseErrorMessage(error, "Could not load pass.") },
      { status: 500 },
    );
  }
}
