import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { shouldUseSecureCookie } from "@/lib/cookies";

const ORG_COOKIE_NAME = "pa-org-id";

function getSupabaseEnv(): { url: string | null; key: string | null } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_KEY ??
    null;
  return { url, key };
}

export async function proxy(request: NextRequest) {
  const { url: supabaseUrl, key: supabaseKey } = getSupabaseEnv();
  if (!(supabaseUrl && supabaseKey)) {
    // Allow the app to boot even if env isn't configured yet.
    return NextResponse.next();
  }

  const response = NextResponse.next();

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`
    );
    return NextResponse.redirect(loginUrl);
  }

  // Best-effort org context cookie bootstrapping.
  //
  // Important: do NOT clear or "validate" the cookie here because RLS policies
  // on `organization_members` can cause false negatives from the client token.
  // We bootstrap only when the cookie is missing; other flows (OrgBootstrap,
  // OrgAccessChanged) handle stale selections safely.
  try {
    const cookieValue = request.cookies.get(ORG_COOKIE_NAME)?.value ?? "";
    const activeOrgId = cookieValue.trim() || null;

    if (!activeOrgId) {
      const { data, error } = await supabase
        .from("organization_members")
        .select("organization_id,is_primary,joined_at")
        .eq("user_id", user.id)
        .order("is_primary", { ascending: false })
        .order("joined_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error) {
        const nextOrgId =
          data && typeof data.organization_id === "string"
            ? data.organization_id.trim()
            : "";

        if (nextOrgId) {
          response.cookies.set(ORG_COOKIE_NAME, nextOrgId, {
            path: "/",
            sameSite: "lax",
            httpOnly: false,
            secure: shouldUseSecureCookie(request.headers, request.url),
            maxAge: 60 * 60 * 24 * 365,
          });
        }
      }
    }
  } catch {
    // Ignore org context errors; we still want auth to work.
  }

  return response;
}

export const config = {
  matcher: [
    "/app/:path*",
    "/setup/:path*",
    "/module/:path*",
    "/account/:path*",
    "/invite/:path*",
  ],
};
