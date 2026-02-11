import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/config";

function safeNextPath(value: string | null): string {
  if (!value) return "/app";
  if (value.startsWith("/")) return value;
  return "/app";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));

  const cookieStore = await cookies();
  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  const redirectUrl = new URL(next, requestUrl.origin);
  return NextResponse.redirect(redirectUrl);
}
