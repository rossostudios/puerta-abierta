import { NotificationRulesManager } from "@/app/(admin)/module/notification-rules/notification-rules-manager";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fetchList,
  fetchNotificationRulesMetadata,
  type NotificationRuleMetadataResponse,
} from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function NotificationSettingsPage({
  searchParams,
}: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  if (!orgId) {
    return (
      <NoOrgCard
        isEn={isEn}
        resource={["notification rules", "reglas de notificación"]}
      />
    );
  }

  let rules: Record<string, unknown>[] = [];
  let templates: Record<string, unknown>[] = [];
  let metadata: NotificationRuleMetadataResponse = {
    channels: ["whatsapp", "email", "sms"],
    triggers: [],
  };

  try {
    const [ruleRows, templateRows, metadataRows] = await Promise.all([
      fetchList("/notification-rules", orgId, 200),
      fetchList("/message-templates", orgId, 200),
      fetchNotificationRulesMetadata(orgId),
    ]);
    rules = ruleRows as Record<string, unknown>[];
    templates = templateRows as Record<string, unknown>[];
    metadata = metadataRows;
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message))
      return <OrgAccessChanged orgId={orgId} />;

    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {isEn ? "Settings" : "Configuración"}
            </Badge>
            <Badge variant="secondary">
              {isEn ? "Notifications" : "Notificaciones"}
            </Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Notification Rules" : "Reglas de Notificación"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Configure automated notifications for due dates and event triggers."
              : "Configura notificaciones automáticas para vencimientos y eventos."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>
                {isEn
                  ? "Could not complete request"
                  : "No se pudo completar la solicitud"}
              </AlertTitle>
              <AlertDescription>{safeDecode(error)}</AlertDescription>
            </Alert>
          ) : null}
          {success ? (
            <Alert variant="success">
              <AlertTitle>
                {isEn ? "Success" : "Éxito"}:{" "}
                {safeDecode(success).replaceAll("-", " ")}
              </AlertTitle>
            </Alert>
          ) : null}

          <NotificationRulesManager
            metadata={metadata}
            nextPath="/settings/notifications"
            orgId={orgId}
            rules={rules}
            templates={templates}
          />
        </CardContent>
      </Card>
    </div>
  );
}
