import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSessionValue, setSessionCookie } from "@/lib/admin-auth";
import { isRecord } from "@/lib/validation";

export const runtime = "nodejs";

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const MAX_TRACKED_ADDRESSES = 5000;
const attemptsByAddress = new Map<string, { count: number; resetAt: number }>();

function getClientAddress(request: NextRequest) {
  return ((request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown")
    .trim()
    .slice(0, 100)) || "unknown";
}

function isRateLimited(address: string, now: number) {
  const attempt = attemptsByAddress.get(address);
  if (!attempt || attempt.resetAt <= now) {
    attemptsByAddress.delete(address);
    return false;
  }
  return attempt.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(address: string, now: number) {
  const attempt = attemptsByAddress.get(address);
  if (!attempt || attempt.resetAt <= now) {
    attemptsByAddress.delete(address);
    if (attemptsByAddress.size >= MAX_TRACKED_ADDRESSES) {
      for (const [key, value] of attemptsByAddress) {
        if (value.resetAt <= now) attemptsByAddress.delete(key);
      }
      if (attemptsByAddress.size >= MAX_TRACKED_ADDRESSES) {
        const oldestAddress = attemptsByAddress.keys().next().value;
        if (oldestAddress) attemptsByAddress.delete(oldestAddress);
      }
    }
    attemptsByAddress.set(address, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return;
  }
  attempt.count++;
}

export async function POST(request: NextRequest) {
  try {
    const expected = process.env.ADMIN_PIN;
    if (!expected || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      return NextResponse.json({ error: "Staff access is not configured yet. Add ADMIN_PIN and a 32+ character SESSION_SECRET." }, { status: 503 });
    }
    const now = Date.now();
    const address = getClientAddress(request);
    if (isRateLimited(address, now)) {
      return NextResponse.json({ error: "Too many failed sign-in attempts. Try again in 15 minutes." }, {
        status: 429,
        headers: { "Retry-After": "900" },
      });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Send the staff PIN as valid JSON." }, { status: 400 });
    }
    const pin = isRecord(body) ? body.pin : undefined;
    const suppliedPin = typeof pin === "string" ? Buffer.from(pin) : Buffer.alloc(0);
    const expectedPin = Buffer.from(expected);
    if (suppliedPin.length !== expectedPin.length || !timingSafeEqual(suppliedPin, expectedPin)) {
      recordFailedAttempt(address, now);
      return NextResponse.json({ error: "Incorrect staff PIN." }, { status: 401 });
    }
    attemptsByAddress.delete(address);
    return setSessionCookie(NextResponse.json({ ok: true }), createSessionValue());
  } catch {
    return NextResponse.json({ error: "Could not sign in. Check the server configuration." }, { status: 500 });
  }
}
