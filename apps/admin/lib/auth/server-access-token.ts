import { auth } from "@clerk/nextjs/server";

/**
 * Dev-only: mint a short-lived JWT from a production Clerk session so the
 * local Next.js server can talk to the production backend without running
 * a local Rust backend or changing Clerk instances.
 *
 * Set DEV_CLERK_PROD_SECRET and DEV_CLERK_PROD_SESSION_ID in .env.local
 * to enable this path. Tokens are cached for 50 seconds (Clerk JWTs
 * typically live 60s).
 */
let _devTokenCache: { jwt: string; expiresAt: number } | null = null;

async function devProdToken(): Promise<string | null> {
  if (process.env.NODE_ENV !== "development") return null;

  const secret = process.env.DEV_CLERK_PROD_SECRET;
  const sessionId = process.env.DEV_CLERK_PROD_SESSION_ID;
  if (!secret || !sessionId) return null;

  const now = Date.now();
  if (_devTokenCache && _devTokenCache.expiresAt > now) {
    return _devTokenCache.jwt;
  }

  try {
    const res = await fetch(
      `https://api.clerk.com/v1/sessions/${sessionId}/tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { jwt?: string };
    if (data.jwt) {
      _devTokenCache = { jwt: data.jwt, expiresAt: now + 50_000 };
      return data.jwt;
    }
  } catch {
    // Fall through to normal Clerk auth.
  }
  return null;
}

/**
 * Returns an auth token for the Rust backend.
 * Clerk is the only supported browser auth provider for admin/web.
 */
export async function getServerAccessToken(): Promise<string | null> {
  // Dev shortcut: use a production Clerk session to mint tokens on-the-fly.
  const devToken = await devProdToken();
  if (devToken) return devToken;

  try {
    const clerkAuth = await auth();
    if (clerkAuth.userId) {
      const token = await clerkAuth.getToken();
      if (token) return token;
    }
  } catch {
    // Clerk middleware may not be active for some routes yet.
  }

  return null;
}
