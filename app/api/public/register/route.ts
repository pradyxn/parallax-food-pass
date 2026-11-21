import { NextRequest, NextResponse } from "next/server";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { getSupabaseAdmin } from "@/lib/supabase";
import { cleanText, normalizeRollNumber, isRecord } from "@/lib/validation";

export const runtime = "nodejs";

function comparableName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-IN").replace(/[^\p{L}\p{N}]+/gu, "");
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Enter your name and hall-ticket number." }, { status: 400 }); }
    if (!isRecord(body)) return NextResponse.json({ error: "Enter your name and hall-ticket number." }, { status: 400 });
    const name = cleanText(body.name, 100);
    const rollNumber = normalizeRollNumber(body.roll_number);
    if (name.length < 2 || !rollNumber) {
      return NextResponse.json({ error: "Both your full name and hall-ticket number are required." }, { status: 400 });
    }

    const { data, error } = await getSupabaseAdmin().from("attendees")
      .select("pass_token, name, branch")
      .eq("roll_number", rollNumber)
      .maybeSingle();
    if (error) throw error;
    if (!data || !/^CSM(?:\b|[ _-])/i.test(data.branch ?? "")) {
      return NextResponse.json({ error: "This hall-ticket number is not on the verified CSM attendee list. Please contact the registration desk." }, { status: 403 });
    }
    if (comparableName(data.name) !== comparableName(name)) {
      return NextResponse.json({ error: "The name does not match the CSM registration for this hall-ticket number." }, { status: 403 });
    }
    return NextResponse.json({ token: data.pass_token }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: getSafeDatabaseErrorMessage(error, "Pass lookup could not be completed.") }, { status: 500 });
  }
}
