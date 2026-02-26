import { NextResponse } from "next/server";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3000";
const PROTOCOL_REGEX = /^[a-z]+:/i;

function safeNext(value: string | null): string {
  const fallback = `${ADMIN_URL}/app`;
  if (!value) return fallback;
  // Block javascript: and other dangerous protocols
  if (PROTOCOL_REGEX.test(value) && !value.startsWith("http")) return fallback;
  // Allow relative paths (but not protocol-relative //evil.com)
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  // Allow redirects to admin app — reject embedded credentials
  try {
    const url = new URL(value);
    if (url.username || url.password) return fallback;
    const adminOrigin = new URL(ADMIN_URL).origin;
    if (url.origin === adminOrigin) return value;
  } catch {
    // invalid URL
  }
  return fallback;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = safeNext(requestUrl.searchParams.get("next"));

  // If next is an absolute URL (admin app), redirect there directly
  if (next.startsWith("http")) {
    return NextResponse.redirect(next);
  }

  const redirectUrl = new URL(next, requestUrl.origin);
  return NextResponse.redirect(redirectUrl);
}
