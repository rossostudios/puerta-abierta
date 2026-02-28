"use client";

import { SparklesIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { useVisibilityPollingInterval } from "@/lib/hooks/use-visibility-polling";
import { cn } from "@/lib/utils";

type Approval = {
  id: string;
  agent_slug: string;
  tool_name: string;
  status: string;
  created_at: string;
};

type AgentActivityFeedProps = {
  orgId: string;
  isEn: boolean;
};

function relativeTime(timestamp: string, isEn: boolean): string {
  const deltaMs = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.max(1, Math.floor(deltaMs / (1000 * 60)));

  if (minutes < 60) return isEn ? `${minutes}m ago` : `${minutes}m atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return isEn ? `${hours}h ago` : `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return isEn ? `${days}d ago` : `hace ${days}d`;
}

export function AgentActivityFeed({ orgId, isEn }: AgentActivityFeedProps) {
  const pollInterval = useVisibilityPollingInterval({
    enabled: !!orgId,
    foregroundMs: 15_000,
    backgroundMs: 60_000,
  });

  const { data: approvals = [] } = useQuery<Approval[]>({
    queryKey: ["agent-activity-feed", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/approvals?org_id=${encodeURIComponent(orgId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok) return [];
      const payload = (await res.json()) as { data?: Approval[] };
      return (payload.data ?? []).slice(0, 5);
    },
    staleTime: 30_000,
    enabled: !!orgId,
    retry: false,
    refetchInterval: pollInterval,
    refetchOnWindowFocus: true,
  });

  if (approvals.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Icon className="text-primary/60" icon={SparklesIcon} size={14} />
        <h3 className="font-bold text-[11px] text-muted-foreground/70 uppercase tracking-widest">
          {isEn ? "Agent Activity" : "Actividad de Agentes"}
        </h3>
      </div>

      <div className="space-y-2">
        {approvals.map((approval, idx) => (
          <div
            className={cn(
              "glass-inner rounded-lg p-2.5 transition-all",
              idx === 0 && "animate-in fade-in slide-in-from-top-1",
              approval.status === "pending" && "border-[var(--agentic-rose-gold-border)]"
            )}
            key={approval.id}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className="font-mono text-[10px]" variant="outline">
                {approval.agent_slug}
              </Badge>
              <span className="text-[10px] text-muted-foreground/70">
                {approval.status === "pending"
                  ? isEn ? `wants to ${approval.tool_name.replace(/_/g, " ")}` : `quiere ${approval.tool_name.replace(/_/g, " ")}`
                  : approval.tool_name.replace(/_/g, " ")}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <StatusBadge className="text-[10px]" value={approval.status} />
              <span className="text-[10px] text-muted-foreground/50">
                {relativeTime(approval.created_at, isEn)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
