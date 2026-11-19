import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSafeDatabaseErrorMessage, isGoogleSyncSchemaMissing } from "@/lib/database-errors";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isRecord } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const { data, error } = await getSupabaseAdmin().from("registration_sync_settings")
      .select("automatic_email_enabled, email_on_existing_change, updated_at")
      .eq("id", 1)
      .single();
    if (error) {
      if (isGoogleSyncSchemaMissing(error)) {
        return NextResponse.json({
          automatic_email_enabled: false,
          email_on_existing_change: false,
          updated_at: "",
          emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
          syncSchemaAvailable: false,
          setupError: getSafeDatabaseErrorMessage(error, "Google sync schema is incomplete."),
        }, { headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }
    return NextResponse.json({
      ...data,
      emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      syncSchemaAvailable: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: getSafeDatabaseErrorMessage(error, "Could not load synchronization settings.") },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Provide valid synchronization settings." }, { status: 400 });
    }
    if (!isRecord(body)
      || typeof body.automatic_email_enabled !== "boolean"
      || typeof body.email_on_existing_change !== "boolean") {
      return NextResponse.json({ error: "Both email settings must be boolean values." }, { status: 400 });
    }
    if (body.automatic_email_enabled && (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL)) {
      return NextResponse.json({
        error: "Configure RESEND_API_KEY and RESEND_FROM_EMAIL on the server before enabling automatic email.",
      }, { status: 503 });
    }
    const { data, error } = await getSupabaseAdmin().from("registration_sync_settings")
      .upsert({
        id: 1,
        automatic_email_enabled: body.automatic_email_enabled,
        email_on_existing_change: body.email_on_existing_change,
        updated_at: new Date().toISOString(),
      })
      .select("automatic_email_enabled, email_on_existing_change, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({
      ...data,
      emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      syncSchemaAvailable: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getSafeDatabaseErrorMessage(error, "Could not save synchronization settings.") },
      { status: 500 },
    );
  }
}
