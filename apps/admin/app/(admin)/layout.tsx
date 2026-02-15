import { AdminShell } from "@/components/shell/admin-shell";
import type { MemberRole } from "@/components/shell/sidebar-new";
import { OrgBootstrap } from "@/components/shell/org-bootstrap";
import { fetchMe } from "@/lib/api";
import { getActiveLocale } from "@/lib/i18n/server";
import { getOnboardingProgress } from "@/lib/onboarding";
import { getActiveOrgId } from "@/lib/org";

const VALID_ROLES = new Set<MemberRole>([
  "owner_admin",
  "operator",
  "cleaner",
  "accountant",
  "viewer",
]);

async function getActiveRole(
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
    return null;
  }
}

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const orgId = await getActiveOrgId();
  const locale = await getActiveLocale();
  const [onboardingProgress, role] = await Promise.all([
    getOnboardingProgress(orgId),
    getActiveRole(orgId),
  ]);

  return (
    <div className="pa-admin-shell-root flex h-screen min-h-screen flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AdminShell
          locale={locale}
          onboardingProgress={onboardingProgress}
          orgId={orgId}
          role={role}
        >
          {children}
        </AdminShell>
      </div>
      <OrgBootstrap activeOrgId={orgId} />
    </div>
  );
}
