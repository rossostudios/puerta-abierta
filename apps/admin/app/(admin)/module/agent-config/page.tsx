import { Suspense } from "react";
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

import { AgentConfigManager } from "./agent-config-manager";
import type { AgentRow } from "./agent-config-types";
import { EscalationThresholds } from "./escalation-thresholds";

type PageProps = {
  searchParams: Promise<Record<string, string>>;
};

export default async function AgentConfigPage(_props: PageProps) {
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

  let agents: AgentRow[] = [];
  let escalationThresholds: unknown[] = [];
  try {
    const [agentsRes, thresholdsRes] = await Promise.all([
      fetchJson<{ data?: AgentRow[] }>("/ai-agents", { org_id: orgId }),
      fetchList("/escalation-thresholds", orgId, 100).catch(() => []),
    ]);
    agents = agentsRes.data ?? [];
    escalationThresholds = thresholdsRes as unknown[];
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
            {isEn ? "Agent Configuration" : "Configuración de Agentes"}
          </h1>
          <p className="font-medium text-muted-foreground text-sm">
            {isEn
              ? "Manage per-organization AI runtime overrides and activation status."
              : "Administra overrides de ejecución por organización y estado de activación de agentes IA."}
          </p>
        </div>
      </header>

      <AgentConfigManager
        initialAgents={agents}
        locale={locale}
        orgId={orgId}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Escalation Thresholds" : "Umbrales de Escalamiento"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Configure when agents must escalate to humans — by dollar amount, action count, or risk score."
              : "Configure cuándo los agentes deben escalar a humanos — por monto, cantidad de acciones o puntuación de riesgo."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <EscalationThresholds
              initialThresholds={escalationThresholds as never[]}
              locale={locale}
              orgId={orgId}
            />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
