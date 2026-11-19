import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSafeDatabaseErrorMessage, isGoogleSyncSchemaMissing } from "@/lib/database-errors";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const db = getSupabaseAdmin();
    const pageSize = 1000;
    const rows: { preference: string; checked_in_at: string | null; meal_collected_at: string | null }[] = [];
    let totalCount: number | null = null;
    do {
      const { data, count, error } = await db.schema("public").from("attendees")
        .select("preference, checked_in_at, meal_collected_at", { count: "exact" })
        .order("id", { ascending: true })
        .range(rows.length, rows.length + pageSize - 1);
      if (error) throw error;
      if (totalCount === null) {
        if (count === null) throw new Error("The database did not return an exact attendee count.");
        totalCount = count;
      }
      if (!data?.length && rows.length < totalCount) {
        throw new Error("Could not retrieve all attendee records for dashboard totals.");
      }
      rows.push(...(data ?? []));
    } while (rows.length < (totalCount ?? 0));

    const total = rows.length;
    const checkedIn = rows.filter((row) => row.checked_in_at).length;
    const notCheckedIn = total - checkedIn;
    const veg = rows.filter((row) => row.preference === "VEG").length;
    const nonVeg = rows.filter((row) => row.preference === "NON_VEG").length;
    const mealsCollected = rows.filter((row) => row.meal_collected_at).length;
    const mealsVeg = rows.filter((row) => row.meal_collected_at && row.preference === "VEG").length;
    const mealsNonVeg = rows.filter((row) => row.meal_collected_at && row.preference === "NON_VEG").length;
    const pendingMeals = rows.filter((row) => row.checked_in_at && !row.meal_collected_at).length;
    const [syncResult, sentEmails, pendingEmails, failedEmails] = await Promise.all([
      db.from("google_sync_state")
        .select("last_successful_sync_at, new_registrations_since_last_sync, synchronization_errors")
        .eq("id", 1)
        .maybeSingle(),
      db.from("registration_email_outbox").select("id", { count: "exact", head: true }).eq("status", "sent"),
      db.from("registration_email_outbox").select("id", { count: "exact", head: true }).in("status", ["pending", "sending"]),
      db.from("registration_email_outbox").select("id", { count: "exact", head: true }).eq("status", "failed"),
    ]);
    const syncSchemaError = [syncResult.error, sentEmails.error, pendingEmails.error, failedEmails.error]
      .find(isGoogleSyncSchemaMissing);
    if (syncSchemaError) {
      return NextResponse.json({
        ...buildAttendeeSummary(rows),
        syncIntegrationAvailable: false,
        syncIntegrationError: getSafeDatabaseErrorMessage(syncSchemaError, "Google sync schema is incomplete."),
        emailDelivery: { sent: 0, pending: 0, failed: 0 },
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (syncResult.error) throw syncResult.error;
    if (sentEmails.error) throw sentEmails.error;
    if (pendingEmails.error) throw pendingEmails.error;
    if (failedEmails.error) throw failedEmails.error;
    const targetPopulation = 380;
    return NextResponse.json({
      total,
      targetPopulation,
      remainingRegistrations: Math.max(targetPopulation - total, 0),
      checkedIn,
      notCheckedIn,
      expectedVeg: veg,
      expectedNonVeg: nonVeg,
      remainingVeg: Math.max(veg - mealsVeg, 0),
      remainingNonVeg: Math.max(nonVeg - mealsNonVeg, 0),
      mealsCollected,
      mealsVeg,
      mealsNonVeg,
      pendingMeals,
      checkInRate: total ? Math.round((checkedIn / total) * 100) : 0,
      lastSuccessfulSyncAt: syncResult.data?.last_successful_sync_at ?? null,
      newRegistrationsSinceLastSync: syncResult.data?.new_registrations_since_last_sync ?? 0,
      synchronizationErrors: syncResult.data?.synchronization_errors ?? 0,
      emailDelivery: {
        sent: sentEmails.count ?? 0,
        pending: pendingEmails.count ?? 0,
        failed: failedEmails.count ?? 0,
      },
      syncIntegrationAvailable: true,
      syncIntegrationError: null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: getSafeDatabaseErrorMessage(error, "Could not load dashboard.") },
      { status: 500 },
    );
  }

  function buildAttendeeSummary(rows: { preference: string; checked_in_at: string | null; meal_collected_at: string | null }[]) {
    const total = rows.length;
    const checkedIn = rows.filter((row) => row.checked_in_at).length;
    const veg = rows.filter((row) => row.preference === "VEG").length;
    const nonVeg = rows.filter((row) => row.preference === "NON_VEG").length;
    const mealsCollected = rows.filter((row) => row.meal_collected_at).length;
    const mealsVeg = rows.filter((row) => row.meal_collected_at && row.preference === "VEG").length;
    const mealsNonVeg = rows.filter((row) => row.meal_collected_at && row.preference === "NON_VEG").length;
    const pendingMeals = rows.filter((row) => row.checked_in_at && !row.meal_collected_at).length;
    const targetPopulation = 380;
    return {
      total,
      targetPopulation,
      remainingRegistrations: Math.max(targetPopulation - total, 0),
      checkedIn,
      notCheckedIn: total - checkedIn,
      expectedVeg: veg,
      expectedNonVeg: nonVeg,
      remainingVeg: Math.max(veg - mealsVeg, 0),
      remainingNonVeg: Math.max(nonVeg - mealsNonVeg, 0),
      mealsCollected,
      mealsVeg,
      mealsNonVeg,
      pendingMeals,
      checkInRate: total ? Math.round((checkedIn / total) * 100) : 0,
      lastSuccessfulSyncAt: null,
      newRegistrationsSinceLastSync: 0,
      synchronizationErrors: 0,
    };
  }
}
