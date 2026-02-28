import { currentUser } from "@clerk/nextjs/server";
import { ChatsWorkspace } from "@/components/agent/chats-workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

export default async function ChatsPage() {
  const [locale, orgId, user] = await Promise.all([
    getActiveLocale(),
    getActiveOrgId(),
    currentUser(),
  ]);
  const isEn = locale === "en-US";

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn
              ? "Missing organization context"
              : "Falta contexto de organización"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="warning">
            <AlertTitle>
              {isEn ? "Select an organization" : "Selecciona una organización"}
            </AlertTitle>
            <AlertDescription>
              {isEn
                ? "Chat history is scoped to the active organization."
                : "El historial de chats está limitado a la organización activa."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <ChatsWorkspace
      firstName={user?.firstName ?? undefined}
      locale={locale}
      orgId={orgId}
    />
  );
}
