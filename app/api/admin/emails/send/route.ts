import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { deliverPassEmails } from "@/lib/email-delivery";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isRecord } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return NextResponse.json({
      error: "Resend is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL for a verified sending domain.",
    }, { status: 503 });
  }

  try {
    let body: unknown = {};
    try { body = await request.json(); } catch { /* An empty body is valid for subsequent batches. */ }
    const retryFailed = isRecord(body) && body.retryFailed === true;
    const db = getSupabaseAdmin();
    const { data: recipients, error: recipientsError } = await db.from("attendees")
      .select("id, email")
      .not("email", "is", null)
      .neq("email", "")
      .limit(1000);
    if (recipientsError) throw recipientsError;
    const validRecipients = (recipients ?? [])
      .filter((row) => typeof row.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim()))
      .map((row) => ({ attendee_id: row.id, email: row.email.trim().toLowerCase() }));
    if (!validRecipients.length) {
      return NextResponse.json({ recipientCount: 0, sent: 0, failed: 0, skipped: 0, remaining: 0 });
    }

    const { error: queueError } = await db.from("registration_email_outbox")
      .upsert(validRecipients, { onConflict: "attendee_id,email", ignoreDuplicates: true });
    if (queueError) throw queueError;

    if (retryFailed) {
      const attendeeIds = [...new Set(validRecipients.map((row) => row.attendee_id))];
      const { error: resetError } = await db.from("registration_email_outbox")
        .update({ status: "pending", last_error: null, updated_at: new Date().toISOString() })
        .eq("status", "failed")
        .in("attendee_id", attendeeIds);
      if (resetError) throw resetError;
    }

    const result = await deliverPassEmails(db, {
      statuses: ["pending"],
      limit: 25,
      baseUrl: process.env.APP_BASE_URL || request.nextUrl.origin,
      force: true,
    });
    const { count, error: pendingError } = await db.from("registration_email_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (pendingError) throw pendingError;

    return NextResponse.json({
      recipientCount: validRecipients.length,
      ...result,
      remaining: count ?? 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getSafeDatabaseErrorMessage(error, "Could not send QR pass emails.") },
      { status: 500 },
    );
  }
}
