import { ChatHistory } from "@/components/agent/chat-history";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

type PageProps = {
  searchParams: Promise<{ archived?: string }>;
};

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export default async function ChatsPage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const orgId = await getActiveOrgId();
  const isEn = locale === "en-US";
  const params = await searchParams;

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
    <ChatHistory
      defaultArchived={isTruthy(params.archived)}
      locale={locale}
      orgId={orgId}
    />
  );
}
