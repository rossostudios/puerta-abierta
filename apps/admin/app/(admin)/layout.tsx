import { AdminShell } from "@/components/shell/admin-shell";
import { OrgBootstrap } from "@/components/shell/org-bootstrap";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const orgId = await getActiveOrgId();
  const locale = await getActiveLocale();

  return (
    <div className="pa-admin-shell-root h-[100dvh] overflow-hidden bg-background">
      <AdminShell locale={locale} orgId={orgId}>
        {children}
      </AdminShell>
      <OrgBootstrap activeOrgId={orgId} />
    </div>
  );
}
