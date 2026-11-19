import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecord } from "./validation";

type DeliveryOptions = {
  attendeeIds?: string[];
  createdAfter?: string;
  statuses?: ("pending" | "failed")[];
  limit?: number;
  baseUrl: string;
  force?: boolean;
};

type ClaimedEmailJob = {
  id: string;
  attendee_id: string;
  email: string;
  attempts: number;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "The email provider returned an unknown error.";
}

export async function deliverPassEmails(db: SupabaseClient, options: DeliveryOptions) {
  const statuses = options.statuses ?? ["pending"];
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  if (options.attendeeIds?.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  if (!options.force) {
    const { data: settings, error: settingsError } = await db.from("registration_sync_settings")
      .select("automatic_email_enabled")
      .eq("id", 1)
      .single();
    if (settingsError) throw settingsError;
    if (!settings.automatic_email_enabled) {
      let pendingQuery = db.from("registration_email_outbox")
        .select("id", { count: "exact", head: true })
        .in("status", statuses);
      if (options.attendeeIds) pendingQuery = pendingQuery.in("attendee_id", options.attendeeIds);
      if (options.createdAfter) pendingQuery = pendingQuery.gte("created_at", options.createdAfter);
      const { count, error: pendingError } = await pendingQuery;
      if (pendingError) throw pendingError;
      return { sent: 0, failed: 0, skipped: count ?? 0 };
    }
  }

  const baseUrl = new URL(options.baseUrl);
  if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost" && baseUrl.hostname !== "127.0.0.1") {
    throw new Error("APP_BASE_URL must use HTTPS outside localhost.");
  }
  const { data: jobs, error: jobsError } = await db.rpc("claim_registration_emails", {
    p_statuses: statuses,
    p_attendee_ids: options.attendeeIds ?? null,
    p_created_after: options.createdAfter ?? null,
    p_limit: limit,
  });
  if (jobsError) throw jobsError;
  if (!jobs?.length) return { sent: 0, failed: 0, skipped: 0 };
  const emailJobs: ClaimedEmailJob[] = jobs.map((job: unknown) => {
    if (!isRecord(job)
      || typeof job.id !== "string"
      || typeof job.attendee_id !== "string"
      || typeof job.email !== "string"
      || typeof job.attempts !== "number") {
      throw new Error("The email queue returned an invalid delivery job.");
    }
    return {
      id: job.id,
      attendee_id: job.attendee_id,
      email: job.email,
      attempts: job.attempts,
    };
  });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  const attendeeIds = [...new Set(emailJobs.map((job) => job.attendee_id))];
  const { data: attendees, error: attendeesError } = await db.from("attendees")
    .select("id, name, roll_number, branch, preference, pass_token")
    .in("id", attendeeIds);
  if (attendeesError) throw attendeesError;
  const attendeeById = new Map((attendees ?? []).map((attendee) => [attendee.id, attendee]));

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const job of emailJobs) {
    const attendee = attendeeById.get(job.attendee_id);
    if (!attendee) {
      const { error: missingAttendeeError } = await db.from("registration_email_outbox")
        .update({
          status: "failed",
          last_error: "The attendee record for this pass email no longer exists.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (missingAttendeeError) throw missingAttendeeError;
      failed++;
      continue;
    }

    let deliveryId: string | null = null;
    let failure: string | null = null;
    if (!apiKey || !from) {
      failure = "Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL before enabling automatic email.";
    } else {
      const passUrl = new URL(`/pass/${attendee.pass_token}`, baseUrl).toString();
      const name = escapeHtml(attendee.name);
      const safeUrl = escapeHtml(passUrl);
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [job.email],
            subject: "Your Parallax Food Pass",
            html: `<p>Hello ${name},</p><p>Your Parallax attendee pass is ready.</p><p><a href="${safeUrl}">Open your QR pass</a></p><p>Keep this pass available for event entry and meal collection.</p>`,
          }),
        });
        const result = await response.json() as { id?: string; message?: string };
        if (!response.ok) throw new Error(result.message || `Resend request failed with status ${response.status}.`);
        deliveryId = result.id ?? null;
      } catch (error) {
        failure = errorText(error);
      }
    }

    const update = failure
      ? {
          status: "failed",
          last_error: failure.slice(0, 1000),
          updated_at: new Date().toISOString(),
        }
      : {
          status: "sent",
          resend_id: deliveryId,
          last_error: null,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
    const { error: updateError } = await db.from("registration_email_outbox")
      .update(update)
      .eq("id", job.id);
    if (updateError) throw updateError;
    if (failure) failed++;
    else sent++;
  }

  return { sent, failed, skipped };
}
