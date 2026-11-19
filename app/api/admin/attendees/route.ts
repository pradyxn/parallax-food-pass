import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { deliverPassEmails } from "@/lib/email-delivery";
import { getSupabaseAdmin } from "@/lib/supabase";
import { cleanText, normalizeRollNumber, cleanPreference, isRecord } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const q = cleanText(request.nextUrl.searchParams.get("q"), 80);
    const db = getSupabaseAdmin();
    let query = db.from("attendees").select("id, pass_token, name, roll_number, branch, preference, source, checked_in_at, meal_collected_at, created_at").order("created_at", { ascending: false }).limit(1000);
    if (q) {
      const safeQ = q.replace(/[^a-zA-Z0-9@.\-\s]/g, " ").trim();
      if (safeQ) query = query.or(`name.ilike.%${safeQ}%,roll_number.ilike.%${safeQ}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ attendees: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: getSafeDatabaseErrorMessage(error, "Could not load attendees.") },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Provide valid JSON attendee details." }, { status: 400 });
    }
    if (!isRecord(body)) return NextResponse.json({ error: "Provide valid attendee details." }, { status: 400 });
    const name = cleanText(body.name, 100);
    const roll_number = normalizeRollNumber(body.roll_number);
    const branch = cleanText(body.branch, 80);
    const email = cleanText(body.email, 254).toLowerCase();
    const preference = cleanPreference(body.preference);
    if (name.length < 2 || !preference) {
      return NextResponse.json({ error: "Name and food preference are required." }, { status: 400 });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    const db = getSupabaseAdmin();
    const { data, error } = await db.from("attendees").insert({
      name, roll_number, email: email || null, branch: branch || null, preference, source: "MANUAL",
    }).select("id, pass_token, name, roll_number, branch, preference, source, checked_in_at, meal_collected_at, created_at").single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "That roll number is already registered." }, { status: 409 });
      throw error;
    }
    let emailDelivery: { sent: number; failed: number; skipped: number } | null = null;
    let emailDeliveryError: string | null = null;
    try {
      emailDelivery = await deliverPassEmails(db, {
        attendeeIds: [data.id],
        limit: 1,
        baseUrl: process.env.APP_BASE_URL || request.nextUrl.origin,
      });
    } catch (deliveryError) {
      emailDeliveryError = getSafeDatabaseErrorMessage(deliveryError, "Pass email delivery could not be attempted.");
    }
    return NextResponse.json({ attendee: data, emailDelivery, emailDeliveryError }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: getSafeDatabaseErrorMessage(error, "Could not add attendee.") },
      { status: 500 },
    );
  }
}
