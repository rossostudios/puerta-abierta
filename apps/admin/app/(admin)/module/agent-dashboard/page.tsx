import { SparklesIcon } from "@hugeicons/core-free-icons";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { fetchJson, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { AgentDashboard } from "./agent-dashboard";

type PageProps = {
  searchParams: Promise<Record<string, string>>;
};

export default async function AgentDashboardPage({}: PageProps) {
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
          <p className="text-sm text-muted-foreground">
            {isEn
              ? "Select an organization from the sidebar."
              : "Seleccione una organización del menú lateral."}
          </p>
        </CardContent>
      </Card>
    );
  }

  let stats: Record<string, unknown> = {};
  try {
    stats = await fetchJson<Record<string, unknown>>(
      "/ai-agents/dashboard/stats",
      { org_id: orgId }
    );
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>{isEn ? "Access denied" : "Acceso denegado"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{message}</p>
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
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {getApiBaseUrl()}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="glass-surface flex items-center gap-4 rounded-3xl p-5">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-muted/50">
          <Icon icon={SparklesIcon} size={20} className="text-muted-foreground" />
        </span>
        <div>
          <h1 className="font-semibold text-2xl">
            {isEn ? "Agent Dashboard" : "Panel de Agentes"}
          </h1>
          <p className="text-muted-foreground/90 text-sm">
            {isEn
              ? "Monitor AI agent activity, approvals, and performance metrics."
              : "Monitorea la actividad de agentes IA, aprobaciones y métricas de rendimiento."}
          </p>
        </div>
      </header>

      <AgentDashboard orgId={orgId} initialStats={stats} locale={locale} />
    </div>
  );
}
