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
  getApiBaseUrl,
  type NotificationRuleMetadataResponse,
} from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function NotificationSettingsPage({
  searchParams,
}: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn
              ? "Missing organization context"
              : "Falta contexto de organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select an organization to manage notification rules."
              : "Selecciona una organización para gestionar reglas de notificación."}
          </CardDescription>
        </CardHeader>
      </Card>
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

    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Could not load notification rules."
              : "No se pudieron cargar las reglas de notificación."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground text-sm">
          <p>
            {isEn ? "Backend base URL" : "URL base del backend"}:{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              {getApiBaseUrl()}
            </code>
          </p>
          <p className="break-words">{message}</p>
        </CardContent>
      </Card>
    );
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
