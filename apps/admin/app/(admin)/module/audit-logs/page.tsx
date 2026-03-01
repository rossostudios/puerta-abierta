import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchList } from "@/lib/api";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { AuditLogsManager } from "./audit-logs-manager";

export default async function AuditLogsPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();

  if (!orgId) {
    return (
      <NoOrgCard
        isEn={isEn}
        resource={["audit logs", "registros de auditoría"]}
      />
    );
  }

  let logs: Record<string, unknown>[] = [];

  try {
    logs = (await fetchList("/audit-logs", orgId, 500)) as Record<
      string,
      unknown
    >[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }

    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {isEn ? "Workspace" : "Espacio de trabajo"}
                </Badge>
                <Badge className="text-[11px]" variant="secondary">
                  {isEn ? "Audit Logs" : "Auditoría"}
                </Badge>
              </div>
              <CardTitle className="text-2xl">
                {isEn ? "Audit Logs" : "Registros de Auditoría"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Immutable history of critical changes and state transitions."
                  : "Historial inmutable de cambios críticos y transiciones de estado."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <AuditLogsManager logs={logs} />
        </CardContent>
      </Card>
    </div>
  );
}
