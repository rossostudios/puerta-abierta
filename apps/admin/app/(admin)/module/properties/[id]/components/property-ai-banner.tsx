"use client";

import { SparklesIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
};

type PropertyAiBannerProps = {
  orgId: string;
  propertyId: string;
  propertyName: string;
  isEn: boolean;
};

const QUICK_ACTIONS = [
  {
    labelEn: "Analyze occupancy",
    labelEs: "Analizar ocupación",
    agent: "guest-concierge",
  },
  {
    labelEn: "Maintenance priorities",
    labelEs: "Prioridades mantenimiento",
    agent: "maintenance-coordinator",
  },
  {
    labelEn: "Pricing strategy",
    labelEs: "Estrategia precios",
    agent: "dynamic-pricing",
  },
  {
    labelEn: "Draft communication",
    labelEs: "Redactar comunicación",
    agent: "guest-concierge",
  },
];

export function PropertyAiBanner({
  orgId,
  propertyId,
  propertyName,
  isEn,
}: PropertyAiBannerProps) {
  const { data: stats } = useQuery<AgentDashboardStats>({
    queryKey: ["agent-stats-detail", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/dashboard/stats?org_id=${encodeURIComponent(orgId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<AgentDashboardStats>;
    },
    staleTime: 60_000,
    enabled: !!orgId,
    retry: false,
  });

  if (!stats) return null;

  const { agents, approvals_24h } = stats;
  const totalActions = approvals_24h.approved + approvals_24h.rejected;
  const successRate =
    totalActions > 0
      ? Math.round((approvals_24h.approved / totalActions) * 100)
      : 100;

  const playgroundHref = `/module/agent-playground?property_id=${encodeURIComponent(propertyId)}&property_name=${encodeURIComponent(propertyName)}`;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/40 bg-card">
      <div className="absolute top-0 bottom-0 left-0 w-1 bg-casaora-gradient" />

      <div className="flex flex-wrap items-center gap-4 py-3 pr-4 pl-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-casaora-gradient text-white shadow-casaora">
          <Icon className="h-4 w-4" icon={SparklesIcon} />
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              className="border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-600"
              variant="outline"
            >
              {agents.active} {isEn ? "agents active" : "agentes activos"}
            </Badge>
            <Badge
              className="border-border/40 bg-muted/30 text-[11px] text-muted-foreground"
              variant="outline"
            >
              {totalActions} {isEn ? "actions" : "acciones"} &middot;{" "}
              {successRate}% {isEn ? "success" : "éxito"}
            </Badge>
          </div>

          {/* Divider */}
          <span
            aria-hidden="true"
            className="hidden h-4 w-px bg-border/40 sm:block"
          />

          {/* Quick action chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_ACTIONS.map((action) => (
              <Link
                className="rounded-full border border-border/30 bg-muted/20 px-2.5 py-1 font-medium text-[10px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
                href={`/module/agent-playground?property_id=${encodeURIComponent(propertyId)}&property_name=${encodeURIComponent(propertyName)}&agent=${action.agent}`}
                key={action.labelEn}
              >
                {isEn ? action.labelEn : action.labelEs}
              </Link>
            ))}
          </div>
        </div>

        <Link
          className={cn(
            buttonVariants({ size: "sm", variant: "outline" }),
            "gap-1.5 text-xs"
          )}
          href={playgroundHref}
        >
          <Icon className="h-3.5 w-3.5" icon={SparklesIcon} />
          {isEn ? "Open Playground" : "Abrir Playground"}
        </Link>
      </div>
    </div>
  );
}
