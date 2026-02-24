import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { PlaygroundManager } from "./playground-manager";

type PageProps = {
  searchParams: Promise<Record<string, string>>;
};

export default async function AgentPlaygroundPage(props: PageProps) {
  const locale = await getActiveLocale();
  const orgId = await getActiveOrgId();
  const isEn = locale === "en-US";
  const searchParams = await props.searchParams;

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Organization required" : "Organizacion requerida"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {isEn
              ? "Select an organization from the sidebar."
              : "Seleccione una organizacion del menu lateral."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="font-bold text-2xl text-foreground tracking-tight">
          {isEn ? "Agent Playground" : "Playground de Agentes"}
        </h1>
        <p className="font-medium text-muted-foreground text-sm">
          {isEn
            ? "Test agents with prompt templates and inspect tool calls in real time."
            : "Prueba agentes con plantillas de prompts e inspecciona llamadas de herramientas en tiempo real."}
        </p>
      </header>

      <PlaygroundManager
        defaultAgentSlug={searchParams.agent}
        locale={locale}
        orgId={orgId}
        propertyId={searchParams.property_id}
        propertyName={searchParams.property_name}
      />
    </div>
  );
}
