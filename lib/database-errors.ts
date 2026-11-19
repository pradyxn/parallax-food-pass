import "server-only";

import { isRecord } from "@/lib/validation";

const GOOGLE_SYNC_TABLES = [
  "google_sync_state",
  "google_sync_batches",
  "registration_email_outbox",
  "registration_sync_settings",
];

function getMissingGoogleSyncTable(error: unknown) {
  if (!isRecord(error)) return null;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (code !== "42P01" && code !== "PGRST205") return null;
  return GOOGLE_SYNC_TABLES.find((table) => message.includes(table)) ?? null;
}

export function isGoogleSyncSchemaMissing(error: unknown) {
  return getMissingGoogleSyncTable(error) !== null;
}

export function getSafeDatabaseErrorMessage(error: unknown, fallback: string) {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  const status = isRecord(error) && typeof error.status === "number" ? error.status : null;
  const message = error instanceof Error
    ? error.message
    : isRecord(error) && typeof error.message === "string"
      ? error.message
      : "";
  const normalizedMessage = message.toLowerCase();

  if (message.includes("Database is not configured") || normalizedMessage.includes("invalid supabaseurl")) {
    return "Supabase is not configured on the server. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.";
  }
  if (
    code === "42501" || status === 403
    || normalizedMessage.includes("permission denied for table attendees")
  ) {
    return "Supabase denied access to public.attendees (42501). Apply the service-role grants migration.";
  }
  const missingGoogleSyncTable = getMissingGoogleSyncTable(error);
  if (missingGoogleSyncTable) {
    return `Google Sheets sync table public.${missingGoogleSyncTable} is missing. Apply supabase/migrations/20261120_google_registration_sync.sql.`;
  }
  if (
    (code === "42P01" || code === "PGRST205")
    && (normalizedMessage.includes("attendees") || normalizedMessage.includes('relation "attendees" does not exist'))
  ) {
    return "The public.attendees table was not found. Verify the table exists in the configured Supabase project.";
  }
  if (
    code === "42703" || code === "PGRST204" || code === "PGRST200"
    || normalizedMessage.includes("column") && normalizedMessage.includes("does not exist")
  ) {
    return "Supabase attendee schema mismatch. Verify the required columns and database schema cache.";
  }
  if (code === "28P01" || code === "PGRST301" || status === 401) {
    return "Supabase rejected server authentication. Verify the project URL and server-side service-role key.";
  }
  if (/fetch failed|ECONN|ENOTFOUND|ETIMEDOUT/i.test(message)) {
    return "Could not reach Supabase. Check network access and project availability.";
  }
  if (code) return `${fallback} (Supabase error ${code}).`;
  return fallback;
}
