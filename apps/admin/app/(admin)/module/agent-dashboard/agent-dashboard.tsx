"use client";

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Database02Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";

type ApprovalActivity = {
  agent_slug?: string | null;
  tool_name: string;
  status: string;
  created_at: string;
  reasoning?: string | null;
};

type Stats = {
  agents?: { total?: number; active?: number };
  approvals_24h?: {
    total?: number;
    pending?: number;
    approved?: number;
    rejected?: number;
  };
  memory_count?: number;
  recent_activity?: ApprovalActivity[];
};

type Props = {
  orgId: string;
  initialStats: Record<string, unknown>;
  locale: string;
};

function statusTone(s: string) {
  if (s === "approved") return "status-tone-success";
  if (s === "rejected") return "status-tone-danger";
  if (s === "pending") return "status-tone-warning";
  return "status-tone-neutral";
}

function statusIcon(s: string) {
  if (s === "approved") return CheckmarkCircle02Icon;
  if (s === "rejected") return AlertCircleIcon;
  return SparklesIcon;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function AgentDashboard({ initialStats, locale }: Props) {
  const isEn = locale === "en-US";
  const stats = initialStats as unknown as Stats;
  const agents = stats.agents ?? { total: 0, active: 0 };
  const approvals = stats.approvals_24h ?? {};
  const memoryCount = stats.memory_count ?? 0;
  const recentActivity = stats.recent_activity ?? [];

  const interventionRate =
    (approvals.total ?? 0) > 0
      ? ((approvals.rejected ?? 0) / (approvals.total ?? 1)) * 100
      : 0;

  const interventionHelper =
    (approvals.total ?? 0) > 0
      ? `${approvals.rejected ?? 0} ${isEn ? "rejected" : "rechazado"} / ${approvals.total} ${isEn ? "total" : "total"}`
      : isEn
        ? "No activity yet"
        : "Sin actividad aún";

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={isEn ? "Active Agents" : "Agentes Activos"}
          value={`${agents.active}/${agents.total}`}
          icon={SparklesIcon}
        />
        <StatCard
          label={isEn ? "Approvals (24h)" : "Aprobaciones (24h)"}
          value={String(approvals.total ?? 0)}
          icon={CheckmarkCircle02Icon}
          helper={`${approvals.pending ?? 0} ${isEn ? "pending" : "pendiente"} · ${approvals.approved ?? 0} ${isEn ? "approved" : "aprobado"}`}
        />
        <StatCard
          label={isEn ? "Intervention Rate" : "Tasa de Intervención"}
          value={
            (approvals.total ?? 0) > 0
              ? `${interventionRate.toFixed(0)}%`
              : "—"
          }
          icon={AlertCircleIcon}
          helper={interventionHelper}
        />
        <StatCard
          label={isEn ? "Memories Stored" : "Memorias Almacenadas"}
          value={String(memoryCount)}
          icon={Database02Icon}
        />
      </div>

      {/* Recent Activity Feed */}
      <div className="space-y-3">
        <h3 className="font-medium text-sm">
          {isEn ? "Recent Agent Activity" : "Actividad Reciente de Agentes"}
        </h3>

        {recentActivity.length === 0 && (
          <div className="glass-inner flex flex-col items-center justify-center rounded-2xl py-12">
            <Icon
              icon={SparklesIcon}
              size={32}
              className="text-muted-foreground/30 mb-3"
            />
            <p className="text-sm text-muted-foreground">
              {isEn
                ? "No agent activity recorded yet."
                : "No hay actividad de agentes registrada aún."}
            </p>
          </div>
        )}

        {recentActivity.length > 0 && (
          <div className="glass-inner rounded-2xl divide-y divide-border/50 overflow-hidden">
            {recentActivity.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
              >
                <span
                  className={cn(
                    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border mt-0.5",
                    statusTone(item.status)
                  )}
                >
                  <Icon icon={statusIcon(item.status)} size={14} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.agent_slug && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-normal"
                      >
                        {item.agent_slug}
                      </Badge>
                    )}
                    <span className="text-sm font-medium">
                      {item.tool_name.replace(/_/g, " ")}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px]", statusTone(item.status))}
                    >
                      {item.status}
                    </Badge>
                  </div>
                  {item.reasoning && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {item.reasoning}
                    </p>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums mt-0.5">
                  {relativeTime(item.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
