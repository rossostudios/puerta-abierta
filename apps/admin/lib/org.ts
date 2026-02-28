import { cookies } from "next/headers";

export const ORG_COOKIE_NAME = "pa-org-id";

export async function getActiveOrgId(): Promise<string | null> {
  const store = await cookies();
  const cookieValue = store.get(ORG_COOKIE_NAME)?.value?.trim();
  if (cookieValue) return cookieValue;

  // Dev fallback: use default org when backend is unavailable to set cookie
  if (process.env.NODE_ENV === "development") {
    const fallback = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID?.trim();
    if (fallback) return fallback;
  }

  return null;
}
