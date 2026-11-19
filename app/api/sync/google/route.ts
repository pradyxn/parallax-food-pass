import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { deliverPassEmails } from "@/lib/email-delivery";
import { getSupabaseAdmin } from "@/lib/supabase";
import { prepareGoogleRegistrations } from "@/lib/google-sync";
import { previewGoogleRegistrations } from "@/lib/google-sync-database";
import { isRecord } from "@/lib/validation";

export const runtime = "nodejs";

function hasValidSecret(request: NextRequest, secret: string) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function validSyncId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value);
}

export async function POST(request: NextRequest) {
  const secret = process.env.GOOGLE_SYNC_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "Google synchronization is not configured on this server." }, { status: 503 });
  }
  if (!hasValidSecret(request, secret)) {
    return NextResponse.json({ error: "Google synchronization authentication failed." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Provide valid JSON registration records." }, { status: 400 });
  }
  if (!isRecord(body) || !Array.isArray(body.records) || body.records.length === 0) {
    return NextResponse.json({ error: "Provide at least one registration record." }, { status: 400 });
  }
  if ("suppressEmails" in body && typeof body.suppressEmails !== "boolean") {
    return NextResponse.json({ error: "suppressEmails must be a boolean value." }, { status: 400 });
  }
  if (body.records.length > 1200) {
    return NextResponse.json({ error: "A request may contain at most 1,200 records." }, { status: 413 });
  }

  const dryRun = body.dryRun === true;
  try {
    const db = getSupabaseAdmin();
    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        ...(await previewGoogleRegistrations(db, body.records)),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (!validSyncId(body.syncId)
      || !Number.isInteger(body.batchIndex)
      || !Number.isInteger(body.batchCount)
      || Number(body.batchIndex) < 0
      || Number(body.batchCount) < 1
      || Number(body.batchCount) > 100
      || Number(body.batchIndex) >= Number(body.batchCount)
      || body.records.length > 100) {
      return NextResponse.json({
        error: "Provide a valid syncId and batch metadata; write batches are limited to 100 records.",
      }, { status: 400 });
    }

    const prepared = prepareGoogleRegistrations(body.records);
    const requestHash = createHash("sha256").update(JSON.stringify(body.records)).digest("hex");
    const batchIndex = Number(body.batchIndex);
    const batchCount = Number(body.batchCount);
    const suppressEmails = body.suppressEmails === true;
    const { data: previousBatch, error: previousBatchError } = await db.from("google_sync_batches")
      .select("request_hash, response")
      .eq("sync_id", body.syncId)
      .eq("batch_index", batchIndex)
      .maybeSingle();
    if (previousBatchError) throw previousBatchError;
    if (previousBatch) {
      if (previousBatch.request_hash !== requestHash) {
        return NextResponse.json({ error: "This batch index was already used with different registration data." }, { status: 409 });
      }
      return NextResponse.json({ ...previousBatch.response, replayed: true });
    }

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const attendeeIds: string[] = [];
    if (prepared.records.length) {
      const { data, error } = await db.rpc("sync_google_registrations", {
        p_records: prepared.records,
        p_suppress_emails: suppressEmails,
      });
      if (error) throw error;
      for (const result of data ?? []) {
        if (result.outcome === "inserted") inserted++;
        else if (result.outcome === "updated") updated++;
        else if (result.outcome === "unchanged") unchanged++;
        else throw new Error("The synchronization database returned an unknown record outcome.");
        if (typeof result.attendee_id === "string") attendeeIds.push(result.attendee_id);
      }
    }
    let emailDelivery: { sent: number; failed: number; skipped: number } | null = null;
    let emailDeliveryError: string | null = null;
    if (suppressEmails) {
      emailDelivery = { sent: 0, failed: 0, skipped: 0 };
    } else {
      try {
        emailDelivery = await deliverPassEmails(db, {
          attendeeIds,
          limit: 100,
          baseUrl: process.env.APP_BASE_URL || request.nextUrl.origin,
        });
      } catch (error) {
        emailDeliveryError = getSafeDatabaseErrorMessage(error, "Email delivery could not be attempted.");
      }
    }

    const response = {
      dryRun: false,
      syncId: body.syncId,
      batchIndex,
      batchCount,
      totalRows: body.records.length,
      inserted,
      updated,
      unchanged,
      rejected: prepared.rejectedRows.length,
      errors: prepared.rejectedRows,
      emailDelivery,
      emailDeliveryError,
      emailSendingSuppressed: suppressEmails,
    };
    const { error: logError } = await db.from("google_sync_batches").insert({
      sync_id: body.syncId,
      batch_index: batchIndex,
      batch_count: batchCount,
      request_hash: requestHash,
      inserted_count: inserted,
      updated_count: updated,
      unchanged_count: unchanged,
      rejected_count: prepared.rejectedRows.length,
      errors: prepared.rejectedRows,
      response,
    });
    if (logError) throw logError;

    if (batchIndex === batchCount - 1) {
      const { data: batches, error: batchesError } = await db.from("google_sync_batches")
        .select("batch_index, batch_count, inserted_count, updated_count, unchanged_count, rejected_count")
        .eq("sync_id", body.syncId);
      if (batchesError) throw batchesError;
      const complete = batches?.length === batchCount
        && batches.every((batch) => batch.batch_count === batchCount)
        && new Set(batches.map((batch) => batch.batch_index)).size === batchCount;
      if (complete) {
        const totals = (batches ?? []).reduce((value, batch) => ({
          inserted: value.inserted + batch.inserted_count,
          updated: value.updated + batch.updated_count,
          unchanged: value.unchanged + batch.unchanged_count,
          rejected: value.rejected + batch.rejected_count,
        }), { inserted: 0, updated: 0, unchanged: 0, rejected: 0 });
        const { error: stateError } = await db.from("google_sync_state").upsert({
          id: 1,
          last_sync_id: body.syncId,
          last_successful_sync_at: new Date().toISOString(),
          new_registrations_since_last_sync: totals.inserted,
          synchronization_errors: totals.rejected,
          updated_at: new Date().toISOString(),
        });
        if (stateError) throw stateError;
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({
      error: getSafeDatabaseErrorMessage(error, "Google synchronization failed."),
    }, { status: 500 });
  }
}
