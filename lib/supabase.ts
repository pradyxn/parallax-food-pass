import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Database is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the environment.");
  }
  if (!cached) {
    cached = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { "x-application-name": "parallax-food-pass" } },
    });
  }
  return cached;
}

export function isDatabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
