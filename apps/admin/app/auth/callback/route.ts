import { NextResponse } from "next/server";

function safeNextPath(value: string | null): string {
  if (!(value && value.startsWith("/"))) return "/login";
  return value;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const target = new URL(next, requestUrl.origin);

  if (next === "/login") {
    target.searchParams.set("error", "auth_callback_deprecated");
  }

  return NextResponse.redirect(target);
}
