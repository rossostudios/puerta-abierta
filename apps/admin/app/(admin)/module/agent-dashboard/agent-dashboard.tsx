"use client";

import { Badge } from "@/components/ui/badge";

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

export function AgentDashboard({ initialStats, locale }: Props) {
  const isEn = locale === "en-US";
  const stats = initialStats as unknown as Stats;
  const agents = stats.agents ?? { total: 0, active: 0 };
  const approvals = stats.approvals_24h ?? {};
  const memoryCount = stats.memory_count ?? 0;
  const recentActivity = stats.recent_activity ?? [];

  const statusColor = (s: string) => {
    if (s === "approved") return "text-green-600";
    if (s === "rejected") return "text-red-600";
    if (s === "pending") return "text-amber-600";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">
            {isEn ? "Active Agents" : "Agentes Activos"}
          </p>
          <p className="text-2xl font-semibold mt-1">
            {agents.active}/{agents.total}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">
            {isEn ? "Approvals (24h)" : "Aprobaciones (24h)"}
          </p>
          <p className="text-2xl font-semibold mt-1">{approvals.total ?? 0}</p>
          <div className="flex gap-2 mt-1 text-xs">
            <span className="text-amber-600">
              {approvals.pending ?? 0} {isEn ? "pending" : "pendiente"}
            </span>
            <span className="text-green-600">
              {approvals.approved ?? 0} {isEn ? "approved" : "aprobado"}
            </span>
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">
            {isEn ? "Intervention Rate" : "Tasa de Intervención"}
          </p>
          <p className="text-2xl font-semibold mt-1">
            {(approvals.total ?? 0) > 0
              ? `${(((approvals.rejected ?? 0) / (approvals.total ?? 1)) * 100).toFixed(0)}%`
              : "—"}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">
            {isEn ? "Memories Stored" : "Memorias Almacenadas"}
          </p>
          <p className="text-2xl font-semibold mt-1">{memoryCount}</p>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div>
        <h3 className="font-medium text-sm mb-3">
          {isEn ? "Recent Agent Activity" : "Actividad Reciente de Agentes"}
        </h3>
        {recentActivity.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {isEn
              ? "No agent activity recorded yet."
              : "No hay actividad de agentes registrada aún."}
          </p>
        )}
        <div className="divide-y rounded-lg border">
          {recentActivity.map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {item.agent_slug && (
                    <Badge variant="outline" className="text-xs">
                      {item.agent_slug}
                    </Badge>
                  )}
                  <span className="text-sm font-medium">
                    {item.tool_name}
                  </span>
                  <span
                    className={`text-xs font-medium ${statusColor(item.status)}`}
                  >
                    {item.status}
                  </span>
                </div>
                {item.reasoning && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {item.reasoning}
                  </p>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {new Date(item.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
