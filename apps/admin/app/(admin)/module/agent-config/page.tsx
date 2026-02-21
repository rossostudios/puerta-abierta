import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchJson, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { AgentConfigManager } from "./agent-config-manager";
import type { AgentRow } from "./agent-config-types";

type PageProps = {
  searchParams: Promise<Record<string, string>>;
};

export default async function AgentConfigPage({}: PageProps) {
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

  let agents: AgentRow[] = [];
  try {
    const res = await fetchJson<{ data?: AgentRow[] }>("/ai-agents", {
      org_id: orgId,
    });
    agents = res.data ?? [];
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
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {isEn ? "Agent Configuration" : "Configuración de Agentes"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Manage AI agent prompts, tools, and activation status."
              : "Administra los prompts, herramientas y estado de activación de los agentes IA."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentConfigManager
            orgId={orgId}
            initialAgents={agents}
            locale={locale}
          />
        </CardContent>
      </Card>
    </div>
  );
}
