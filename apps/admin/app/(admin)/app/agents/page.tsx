import Link from "next/link";
import { ChatThread } from "@/components/agent/chat-thread";
import { ChatsWorkspace } from "@/components/agent/chats-workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

type PageProps = {
  searchParams: Promise<{ new?: string; agent?: string }>;
};

export default async function AgentsPage({ searchParams }: PageProps) {
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
    <div className="space-y-4">
      <Card className="border-border/60 bg-card/80 shadow-sm">
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>
              {isEn ? "Agent Command Center" : "Centro de Comando de Agentes"}
            </CardTitle>
            <Badge variant="secondary">
              {isEn ? "Supervisor default" : "Supervisor por defecto"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {isEn
              ? "Start every workflow through the supervisor agent, then delegate into leasing, maintenance, finance, and guest operations as needed."
              : "Inicia cada flujo con el agente supervisor y delega a leasing, mantenimiento, finanzas y operaciones de huéspedes cuando sea necesario."}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              className="inline-flex items-center rounded-md border border-border/70 px-2.5 py-1.5 text-sm hover:bg-muted/40"
              href="/module/agent-dashboard"
            >
              {isEn ? "Agent analytics" : "Analítica de agentes"}
            </Link>
            <Link
              className="inline-flex items-center rounded-md border border-border/70 px-2.5 py-1.5 text-sm hover:bg-muted/40"
              href="/module/knowledge"
            >
              {isEn ? "Knowledge base" : "Base de conocimiento"}
            </Link>
            <Link
              className="inline-flex items-center rounded-md border border-border/70 px-2.5 py-1.5 text-sm hover:bg-muted/40"
              href="/app/chats"
            >
              {isEn ? "Open chat history" : "Abrir historial"}
            </Link>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.95fr)]">
        <div className="min-w-0">
          <ChatThread
            defaultAgentSlug={initialAgentSlug}
            freshKey={typeof params.new === "string" ? params.new : undefined}
            locale={locale}
            mode="embedded"
            orgId={orgId}
          />
        </div>

        <div className="min-w-0">
          <ChatsWorkspace defaultArchived={false} locale={locale} orgId={orgId} />
        </div>
      </div>
    </div>
  );
}
