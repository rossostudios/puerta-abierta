import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchJson, fetchList, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { AgentAnalytics } from "./agent-analytics";
import { AgentDashboard } from "./agent-dashboard";
import { AgentHealth } from "./agent-health";
import { AgentTraces } from "./agent-traces";

type PageProps = {
  searchParams: Promise<Record<string, string>>;
};

export default async function AgentDashboardPage(_props: PageProps) {
  const locale = await getActiveLocale();
  const orgId = await getActiveOrgId();
  const isEn = locale === "en-US";

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Organization required" : "Organización requerida"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {isEn
              ? "Select an organization from the sidebar."
              : "Seleccione una organización del menú lateral."}
          </p>
        </CardContent>
      </Card>
    );
  }

  let stats: Record<string, unknown> = {};
  let evaluations: Record<string, unknown>[] = [];
  let healthMetrics: Record<string, unknown>[] = [];
  try {
    [stats, evaluations, healthMetrics] = await Promise.all([
      fetchJson<Record<string, unknown>>("/ai-agents/dashboard/stats", {
        org_id: orgId,
      }),
      fetchList("/agent-evaluations", orgId, 200).catch(() => []) as Promise<
        Record<string, unknown>[]
      >,
      fetchList("/agent-health-metrics", orgId, 60).catch(() => []) as Promise<
        Record<string, unknown>[]
      >,
    ]);
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>{isEn ? "Access denied" : "Acceso denegado"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">{message}</p>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{message}</p>
          <p className="mt-1 text-muted-foreground text-xs">
            {getApiBaseUrl()}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-bold text-2xl text-foreground tracking-tight">
            {isEn ? "Agent Dashboard" : "Panel de Agentes"}
          </h1>
          <p className="font-medium text-muted-foreground text-sm">
            {isEn
              ? "Monitor AI agent activity, approvals, and performance metrics."
              : "Monitorea la actividad de agentes IA, aprobaciones y métricas de rendimiento."}
          </p>
        </div>
      </header>

      <AgentDashboard initialStats={stats} locale={locale} orgId={orgId} />

      <Card>
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Analytics</Badge>
            <CardTitle className="text-lg">
              {isEn
                ? "Agent Analytics"
                : "Analíticas de Agentes"}
            </CardTitle>
          </div>
          <CardDescription>
            {isEn
              ? "Per-agent success rates, cost estimates, tool usage, and human override metrics."
              : "Tasas de éxito por agente, estimaciones de costos, uso de herramientas y métricas de intervención humana."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <AgentAnalytics orgId={orgId} locale={locale} />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Traces</Badge>
            <CardTitle className="text-lg">
              {isEn
                ? "Agent Traces & Token Usage"
                : "Trazas de Agentes y Uso de Tokens"}
            </CardTitle>
          </div>
          <CardDescription>
            {isEn
              ? "Real-time LLM call traces with token counts, latency, cost estimates, and tool call timelines."
              : "Trazas de llamadas LLM en tiempo real con conteo de tokens, latencia, estimación de costos y cronología de herramientas."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <AgentTraces orgId={orgId} />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline">S12</Badge>
            <CardTitle className="text-lg">
              {isEn
                ? "Agent Health & Cost Tracking"
                : "Salud de Agentes y Seguimiento de Costos"}
            </CardTitle>
          </div>
          <CardDescription>
            {isEn
              ? "Quality evaluations, accuracy scores, latency metrics, and cost tracking per agent."
              : "Evaluaciones de calidad, puntuaciones de precisión, métricas de latencia y seguimiento de costos por agente."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <AgentHealth
              evaluations={evaluations}
              healthMetrics={healthMetrics}
            />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
