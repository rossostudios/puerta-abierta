import { AdminShell } from "@/components/shell/admin-shell";
import { OrgBootstrap } from "@/components/shell/org-bootstrap";
import { getActiveLocale } from "@/lib/i18n/server";
import { getOnboardingProgress } from "@/lib/onboarding";
import { getActiveOrgId } from "@/lib/org";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const orgId = await getActiveOrgId();
  const locale = await getActiveLocale();
  const onboardingProgress = await getOnboardingProgress(orgId);

  return (
    <div className="pa-admin-shell-root flex h-screen min-h-screen flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AdminShell
          locale={locale}
          onboardingProgress={onboardingProgress}
          orgId={orgId}
        >
          {children}
        </AdminShell>
      </div>
      <OrgBootstrap activeOrgId={orgId} />
    </div>
  );
}
