import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { deliverPassEmails } from "@/lib/email-delivery";
import { getSafeDatabaseErrorMessage } from "@/lib/database-errors";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const result = await deliverPassEmails(getSupabaseAdmin(), {
      statuses: ["pending", "failed"],
      limit: 50,
      baseUrl: process.env.APP_BASE_URL || request.nextUrl.origin,
      force: true,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getSafeDatabaseErrorMessage(error, "Could not retry failed pass emails.") },
      { status: 500 },
    );
  }
}
