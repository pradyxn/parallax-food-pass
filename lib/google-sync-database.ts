import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGoogleSyncPreview,
  prepareGoogleRegistrations,
  type ExistingRegistration,
} from "./google-sync";

export async function loadExistingRegistrations(db: SupabaseClient) {
  const attendees: ExistingRegistration[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("attendees")
      .select("id, roll_number, name, email, branch, preference, pass_token, checked_in_at, meal_collected_at")
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    attendees.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return attendees;
}

export async function previewGoogleRegistrations(db: SupabaseClient, rows: unknown[]) {
  const prepared = prepareGoogleRegistrations(rows);
  const existing = await loadExistingRegistrations(db);
  return buildGoogleSyncPreview(prepared, existing);
}
