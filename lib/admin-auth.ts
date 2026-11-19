import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const SESSION_COOKIE = "parallax_staff_session";
const SESSION_SECONDS = 12 * 60 * 60;

function signature(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
  }
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function createSessionValue() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `parallax:${expiresAt}`;
  return `${expiresAt}.${signature(payload)}`;
}

export function isValidSession(value?: string) {
  if (!value) return false;
  const [expiresText, suppliedSignature] = value.split(".");
  const expiresAt = Number(expiresText);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000) || !suppliedSignature) return false;
  try {
    const expected = signature(`parallax:${expiresAt}`);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(suppliedSignature, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function requireAdmin(request: NextRequest): NextResponse | null {
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  if (!isValidSession(value)) {
    return NextResponse.json({ error: "Staff session expired. Sign in again." }, { status: 401 });
  }
  return null;
}

export function setSessionCookie(response: NextResponse, value: string) {
  response.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
