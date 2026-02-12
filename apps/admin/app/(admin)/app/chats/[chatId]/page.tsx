import { ChatThread } from "@/components/agent/chat-thread";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

type PageProps = {
  params: Promise<{ chatId: string }>;
};

export default async function ChatDetailPage({ params }: PageProps) {
  const locale = await getActiveLocale();
  const orgId = await getActiveOrgId();
  const isEn = locale === "en-US";
  const { chatId } = await params;

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
                ? "The chat thread cannot be loaded without an active organization."
                : "No se puede cargar el hilo sin una organización activa."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return <ChatThread chatId={chatId} locale={locale} orgId={orgId} />;
}
