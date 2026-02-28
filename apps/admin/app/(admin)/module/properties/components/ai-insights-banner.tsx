"use client";

import { Cancel01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type AgentDashboardStats = {
  agents: { total: number; active: number };
  approvals_24h: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  memory_count: number;
};

type AiInsightsBannerProps = {
  orgId: string;
  isEn: boolean;
  propertyCount: number;
};

const SESSION_KEY = "casaora-ai-banner-dismissed";

export function AiInsightsBanner({
  orgId,
  isEn,
  propertyCount,
}: AiInsightsBannerProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(SESSION_KEY) === "1";
  });

  const { data: stats } = useQuery<AgentDashboardStats>({
    queryKey: ["agent-stats-properties", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/dashboard/stats?org_id=${encodeURIComponent(orgId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error("Failed to fetch agent stats");
      return res.json() as Promise<AgentDashboardStats>;
    },
    staleTime: 60_000,
    enabled: !!orgId,
    retry: false,
  });

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem(SESSION_KEY, "1");
  }, []);

  if (dismissed || !stats) return null;

  const { agents, approvals_24h } = stats;
  const actionsToday = approvals_24h.approved + approvals_24h.pending;
  const hasPending = approvals_24h.pending > 0;

  return (
    <div className="animate-in fade-in slide-in-from-top-2 relative overflow-hidden rounded-xl glass-inner transition-all duration-300">
      {/* Left accent gradient */}
      <div className="absolute top-0 bottom-0 left-0 w-1 bg-casaora-gradient" />

      <div className="flex items-center gap-4 py-3 pr-3 pl-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-casaora-gradient text-white shadow-casaora">
          <Icon className="h-4 w-4" icon={SparklesIcon} />
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="font-medium text-foreground text-sm">
            {isEn
              ? `I'm actively managing ${propertyCount} properties`
              : `Estoy gestionando activamente ${propertyCount} propiedades`}
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              className="border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-600"
              variant="outline"
            >
              {agents.active}/{agents.total}{" "}
              {isEn ? "agents online" : "agentes en línea"}
            </Badge>

            <Badge
              className="border-border/40 bg-muted/30 text-[11px] text-muted-foreground"
              variant="outline"
            >
              {actionsToday} {isEn ? "actions today" : "acciones hoy"}
            </Badge>

            {hasPending && (
              <Badge
                className="status-tone-agentic-warning border text-[11px]"
                variant="outline"
              >
                {approvals_24h.pending} {isEn ? "pending review" : "pendientes"}
              </Badge>
            )}
          </div>
        </div>

        <button
          aria-label={isEn ? "Dismiss" : "Cerrar"}
          className={cn(
            "shrink-0 rounded-lg p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted/50 hover:text-muted-foreground"
          )}
          onClick={handleDismiss}
          type="button"
        >
          <Icon className="h-3.5 w-3.5" icon={Cancel01Icon} />
        </button>
      </div>
    </div>
  );
}
