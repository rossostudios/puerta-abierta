import type { MemberRole } from "@/components/shell/sidebar-types";
import { fetchMe } from "@/lib/api";

const VALID_ROLES = new Set<MemberRole>([
  "owner_admin",
  "operator",
  "cleaner",
  "accountant",
  "viewer",
]);

export async function getActiveRole(
  orgId: string | null
): Promise<MemberRole | null> {
  if (!orgId) return null;
  try {
    const me = await fetchMe();
    const membership = me.memberships?.find(
      (m) => m.organization_id === orgId
    );
    const role = membership?.role?.trim().toLowerCase() as
      | MemberRole
      | undefined;
    return role && VALID_ROLES.has(role) ? role : null;
  } catch {
    // Dev fallback: default to owner_admin when backend is unavailable
    if (process.env.NODE_ENV === "development") {
      const fallback = (
        process.env.NEXT_PUBLIC_DEFAULT_ROLE ?? "owner_admin"
      )
        .trim()
        .toLowerCase() as MemberRole;
      return VALID_ROLES.has(fallback) ? fallback : "owner_admin";
    }
    return null;
  }
}
