"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SectionLabel } from "@/components/agent/briefing/helpers";
import { normalizeAgents } from "@/components/agent/chat-thread-types";
import { PropertyCard } from "@/components/properties/property-card";
import { Icon } from "@/components/ui/icon";
import type { AgentDefinition } from "@/lib/api";
import type {
  PropertyRecord,
  PropertyRelationRow,
} from "@/lib/features/properties/types";
import { useActiveLocale, useDictionary } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { PortfolioChips } from "./components/portfolio-chips";
import { PortfolioMetricsBar } from "./components/portfolio-metrics-bar";
import { PropertiesFeedback } from "./components/properties-feedback";
import { usePropertyAgentStatus } from "./hooks/use-property-agent-status";
import { usePropertyPortfolio } from "./hooks/use-property-portfolio";

type PropertiesManagerProps = {
  orgId: string;
  properties: PropertyRecord[];
  units: PropertyRelationRow[];
  leases: PropertyRelationRow[];
  tasks: PropertyRelationRow[];
  collections: PropertyRelationRow[];
  dictionary?: { title: string; description: string };
  error?: string;
  success?: string;
};

export function PropertiesManager({
  orgId,
  properties,
  units,
  leases,
  tasks,
  collections,
  error: errorLabel,
  success: successMessage,
}: PropertiesManagerProps) {
  const { common } = useDictionary();
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const formatLocale = isEn ? "en-US" : "es-PY";

  const { rows, summary } = usePropertyPortfolio({
    locale,
    properties,
    units,
    leases,
    tasks,
    collections,
  });

  // Agent status
  const agentsQuery = useQuery<AgentDefinition[], Error>({
    queryKey: ["agents-property-status", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/agents?org_id=${encodeURIComponent(orgId)}`,
        {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        }
      );
      if (!res.ok) return [];
      const payload = (await res.json()) as unknown;
      return normalizeAgents(payload);
    },
    staleTime: 60_000,
    enabled: !!orgId,
    retry: false,
  });

  const agentStatus: "active" | "offline" | "loading" = agentsQuery.isPending
    ? "loading"
    : (agentsQuery.data ?? []).some((a) => a.is_active !== false)
      ? "active"
      : "offline";

  const propertyIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const { propertyAgentStatusMap } = usePropertyAgentStatus({
    orgId,
    propertyIds,
    agentOnline: agentStatus === "active",
  });

  const attentionCount =
    summary.totalOpenTasks + summary.totalOverdueCollections;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl flex-col px-4 py-8 sm:px-6">
      <div className="space-y-8">
        {/* STOA overview */}
        <PortfolioOverview
          attentionCount={attentionCount}
          isEn={isEn}
          propertyCount={rows.length}
          unitCount={summary.totalUnits}
        />

        {/* Metric Cards */}
        <PortfolioMetricsBar
          formatLocale={formatLocale}
          isEn={isEn}
          summary={summary}
        />

        {/* Feedback toasts */}
        <PropertiesFeedback
          error={errorLabel ?? ""}
          errorLabel={common.error}
          success={successMessage ?? ""}
          successLabel={common.success}
        />

        {/* Section label */}
        <SectionLabel>
          {isEn ? "YOUR PROPERTIES" : "TUS PROPIEDADES"}
        </SectionLabel>

        {/* Property cards grid */}
        {rows.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <PropertyCard
                agentContext={propertyAgentStatusMap.get(row.id)}
                key={row.id}
                row={row}
              />
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground/60 text-sm">
            {isEn
              ? "No properties yet. Ask the agent to add your first property."
              : "Sin propiedades. Pide al agente que agregue tu primera propiedad."}
          </div>
        )}
      </div>

      {/* Push chat to bottom */}
      <div className="mt-auto space-y-4 pt-12">
        <PropertyChatInput isEn={isEn} />
        <PortfolioChips isEn={isEn} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PortfolioOverview — one-line STOA summary (no greeting)            */
/* ------------------------------------------------------------------ */

function PortfolioOverview({
  propertyCount,
  unitCount,
  attentionCount,
  isEn,
}: {
  propertyCount: number;
  unitCount: number;
  attentionCount: number;
  isEn: boolean;
}) {
  const overview = isEn
    ? buildOverviewEn(propertyCount, unitCount, attentionCount)
    : buildOverviewEs(propertyCount, unitCount, attentionCount);

  return (
    <div className="space-y-1">
      <p className="font-semibold text-foreground text-sm">Alex</p>
      <p className="text-muted-foreground text-sm leading-relaxed">{overview}</p>
    </div>
  );
}

function buildOverviewEn(props: number, units: number, attention: number) {
  if (props === 0) return "No properties yet. Ask me to add your first one.";
  const parts: string[] = [
    `Here\u2019s your portfolio \u2014 `,
  ];
  parts.push(
    `**${props} ${props === 1 ? "property" : "properties"}**, **${units} ${units === 1 ? "unit" : "units"}**.`
  );
  if (attention > 0) {
    parts.push(
      ` ${attention} ${attention === 1 ? "needs" : "need"} attention.`
    );
  }
  parts.push(" Tap any property to expand.");
  return formatBold(parts.join(""));
}

function buildOverviewEs(props: number, units: number, attention: number) {
  if (props === 0) return "Sin propiedades a\u00fan. P\u00eddeme agregar la primera.";
  const parts: string[] = [
    `Tu portafolio \u2014 `,
  ];
  parts.push(
    `**${props} ${props === 1 ? "propiedad" : "propiedades"}**, **${units} ${units === 1 ? "unidad" : "unidades"}**.`
  );
  if (attention > 0) {
    parts.push(
      ` ${attention} ${attention === 1 ? "requiere" : "requieren"} atenci\u00f3n.`
    );
  }
  parts.push(" Toca cualquier propiedad para expandir.");
  return formatBold(parts.join(""));
}

/** Render **bold** markers as <strong> inline */
function formatBold(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((segment, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-foreground">
            {segment}
          </strong>
        ) : (
          segment
        )
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* PropertyChatInput — pill-shaped input that navigates to /app/agents */
/* ------------------------------------------------------------------ */

function PropertyChatInput({ isEn }: { isEn: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    router.push(`/app/agents?prompt=${encodeURIComponent(trimmed)}`);
  };

  return (
    <form className="relative" onSubmit={handleSubmit}>
      <input
        className={cn(
          "h-12 w-full rounded-full border border-border/50 bg-background pr-12 pl-5 text-sm",
          "placeholder:text-muted-foreground/40",
          "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20",
          "transition-colors"
        )}
        onChange={(e) => setValue(e.target.value)}
        placeholder={
          isEn ? "Ask about your properties..." : "Pregunta sobre tus propiedades..."
        }
        type="text"
        value={value}
      />
      <button
        className={cn(
          "absolute top-1/2 right-1.5 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
          "bg-foreground text-background transition-opacity",
          value.trim() ? "opacity-100" : "opacity-30"
        )}
        disabled={!value.trim()}
        type="submit"
      >
        <Icon icon={ArrowRight01Icon} size={16} />
      </button>
    </form>
  );
}
