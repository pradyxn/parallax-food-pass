import { NextRequest, NextResponse } from "next/server";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isRecord, validRegistration } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Provide valid JSON registration details." }, { status: 400 });
    }
    if (!isRecord(body)) return NextResponse.json({ error: "Provide valid registration details." }, { status: 400 });
    const validated = validRegistration(body);
    if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
    const { value } = validated;
    const { data, error } = await getSupabaseAdmin().from("attendees").insert({
      ...value,
      source: "WALK_IN",
    }).select("pass_token").single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "That roll number is already registered. Please contact the registration desk to retrieve the existing pass." }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ token: data.pass_token }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: getSafeDatabaseErrorMessage(error, "Registration could not be completed.") },
      { status: 500 },
    );
  }
}
