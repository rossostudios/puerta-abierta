import { auth } from "@clerk/nextjs/server";

/**
 * Returns an auth token for the Rust backend.
 * Clerk is the only supported browser auth provider for admin/web.
 */
export async function getServerAccessToken(): Promise<string | null> {
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
