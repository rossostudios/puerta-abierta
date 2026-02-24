"use client";

import { SparklesIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type PropertyOverviewAgentsProps = {
  orgId: string;
  propertyId: string;
  propertyName: string;
  isEn: boolean;
};

type AgentDashboardStats = {
  agents: { total: number; active: number };
  approvals_24h: { total: number; approved: number; rejected: number };
};

const QUICK_ACTIONS = [
  {
    labelEn: "Analyze occupancy trends",
    labelEs: "Analizar tendencias de ocupación",
    agent: "guest-concierge",
  },
  {
    labelEn: "Suggest maintenance priorities",
    labelEs: "Sugerir prioridades de mantenimiento",
    agent: "maintenance-coordinator",
  },
  {
    labelEn: "Review pricing strategy",
    labelEs: "Revisar estrategia de precios",
    agent: "dynamic-pricing",
  },
  {
    labelEn: "Draft tenant communication",
    labelEs: "Redactar comunicación a inquilino",
    agent: "guest-concierge",
  },
];

export function PropertyOverviewAgents({
  orgId,
  propertyId,
  propertyName,
  isEn,
}: PropertyOverviewAgentsProps) {
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

  const totalActions = stats
    ? stats.approvals_24h.approved + stats.approvals_24h.rejected
    : 0;
  const successRate =
    totalActions > 0
      ? Math.round(((stats?.approvals_24h.approved ?? 0) / totalActions) * 100)
      : 100;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-casaora-gradient text-white shadow-casaora">
            <Icon className="h-3.5 w-3.5" icon={SparklesIcon} />
          </div>
          <h3 className="font-semibold text-sm text-foreground">
            {isEn ? "AI Agents" : "Agentes IA"}
          </h3>
        </div>

        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <Link
              className={cn(
                "rounded-full border border-border/40 bg-muted/30 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors",
                "hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
              )}
              href={`/module/agent-playground?property_id=${encodeURIComponent(propertyId)}&property_name=${encodeURIComponent(propertyName)}&agent=${action.agent}`}
              key={action.labelEn}
            >
              {isEn ? action.labelEn : action.labelEs}
            </Link>
          ))}
        </div>

        {stats && (
          <div className="flex items-center gap-3 border-t border-border/30 pt-3">
            <Badge
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 text-[10px]"
              variant="outline"
            >
              {stats.agents.active} {isEn ? "active" : "activos"}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {totalActions} {isEn ? "actions" : "acciones"} &middot;{" "}
              {successRate}% {isEn ? "success" : "éxito"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
