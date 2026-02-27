import { currentUser } from "@clerk/nextjs/server";
import { ChatThread } from "@/components/agent/chat-thread";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

type PageProps = {
  searchParams: Promise<{ new?: string; agent?: string }>;
};

export default async function AgentsPage({ searchParams }: PageProps) {
  const [locale, orgId, user] = await Promise.all([
    getActiveLocale(),
    getActiveOrgId(),
    currentUser(),
  ]);
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
                ? "Agents require an active organization to operate on scoped data."
                : "Los agentes requieren una organización activa para operar sobre datos con alcance."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const initialAgentSlug =
    typeof params.agent === "string" && params.agent.trim()
      ? params.agent.trim()
      : "supervisor";

  return (
    <div className="-m-3 h-[calc(100vh-3.5rem)] sm:-m-4 lg:-m-5 xl:-m-7">
      <ChatThread
        defaultAgentSlug={initialAgentSlug}
        firstName={user?.firstName ?? undefined}
        freshKey={typeof params.new === "string" ? params.new : undefined}
        locale={locale}
        mode="hero"
        orgId={orgId}
      />
    </div>
  );
}
