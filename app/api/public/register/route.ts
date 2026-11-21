import { NextRequest, NextResponse } from "next/server";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { getSupabaseAdmin } from "@/lib/supabase";
import { cleanText, normalizeRollNumber, cleanPreference, isRecord } from "@/lib/validation";

export const runtime = "nodejs";

function comparableName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-IN").replace(/[^\p{L}\p{N}]+/gu, "");
}

async function existingPass(rollNumber: string, name: string) {
  const { data, error } = await getSupabaseAdmin().from("attendees")
    .select("pass_token, name")
    .eq("roll_number", rollNumber)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (comparableName(data.name) !== comparableName(name)) {
    return { conflict: true as const };
  }
  return { conflict: false as const, token: data.pass_token };
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Complete all registration fields." }, { status: 400 }); }
    if (!isRecord(body)) return NextResponse.json({ error: "Complete all registration fields." }, { status: 400 });

    const name = cleanText(body.name, 100);
    const rollNumber = normalizeRollNumber(body.roll_number);
    const branch = cleanText(body.branch, 50);
    const section = cleanText(body.section, 40);
    const preference = cleanPreference(body.preference);

    if (name.length < 2 || !rollNumber || !branch || !section || !preference) {
      return NextResponse.json({
        error: "Name, roll number, branch, section and food preference are all required.",
      }, { status: 400 });
    }
    if (!/^[\p{L}\p{N} .&()/_-]+$/u.test(branch) || !/^[\p{L}\p{N} .&()/_-]+$/u.test(section)) {
      return NextResponse.json({ error: "Enter a valid branch and section." }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const current = await existingPass(rollNumber, name);
    if (current?.conflict) {
      return NextResponse.json({
        error: "That roll number is already registered with a different name. Please contact the registration desk.",
      }, { status: 409 });
    }
    if (current && !current.conflict) {
      return NextResponse.json({ token: current.token, existing: true }, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const { data, error } = await db.from("attendees").insert({
      name,
      roll_number: rollNumber,
      branch: branch.toUpperCase(),
      section: section.toUpperCase(),
      preference,
      source: "SELF_REGISTERED",
      email: null,
    }).select("pass_token").single();

    if (error) {
      if (error.code === "23505") {
        const raced = await existingPass(rollNumber, name);
        if (raced && !raced.conflict) {
          return NextResponse.json({ token: raced.token, existing: true }, {
            status: 200,
            headers: { "Cache-Control": "no-store" },
          });
        }
        return NextResponse.json({ error: "That roll number has just been registered. Contact the registration desk if you need help." }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ token: data.pass_token, existing: false }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getSafeDatabaseErrorMessage(error, "Registration could not be completed.") },
      { status: 500 },
    );
  }
}
