"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Trace = {
  id: string;
  agent_slug: string;
  chat_id: string | null;
  model_used: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  tool_count: number;
  tool_calls: { name?: string; ok?: boolean }[];
  fallback_used: boolean;
  success: boolean;
  error_message: string | null;
  created_at: string;
};

type Props = {
  orgId: string;
};

function estimateCost(
  _model: string | null,
  prompt: number,
  completion: number
): number {
  // Rough GPT-5.2 pricing: $5/1M prompt, $15/1M completion
  const promptRate = 5.0 / 1_000_000;
  const completionRate = 15.0 / 1_000_000;
  return prompt * promptRate + completion * completionRate;
}

export function AgentTraces({ orgId }: Props) {
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const { data: traces = [], isPending } = useQuery({
    queryKey: ["agent-traces", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/traces?org_id=${encodeURIComponent(orgId)}&limit=100`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok) return [];
      const payload = (await res.json()) as { data?: Trace[] };
      return payload.data ?? [];
    },
    refetchInterval: 60_000,
  });

  const agentSlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const t of traces) slugs.add(t.agent_slug);
    return ["all", ...Array.from(slugs).sort()];
  }, [traces]);

  const filtered = useMemo(() => {
    if (agentFilter === "all") return traces;
    return traces.filter((t) => t.agent_slug === agentFilter);
  }, [traces, agentFilter]);

  // Aggregate stats
  const stats = useMemo(() => {
    const totalTokens = filtered.reduce((s, t) => s + t.total_tokens, 0);
    const avgLatency =
      filtered.length > 0
        ? Math.round(
            filtered.reduce((s, t) => s + t.latency_ms, 0) / filtered.length
          )
        : 0;
    const totalCost = filtered.reduce(
      (s, t) =>
        s + estimateCost(t.model_used, t.prompt_tokens, t.completion_tokens),
      0
    );
    const errorCount = filtered.filter((t) => !t.success).length;
    const toolCalls = filtered.reduce((s, t) => s + t.tool_count, 0);
    return {
      totalTokens,
      avgLatency,
      totalCost,
      errorCount,
      toolCalls,
      count: filtered.length,
    };
  }, [filtered]);

  if (isPending) {
    return (
      <p className="py-6 text-center text-muted-foreground text-sm">
        Loading traces...
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Aggregate stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-muted-foreground text-xs">Traces</p>
          <p className="font-semibold text-2xl">{stats.count}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-muted-foreground text-xs">Total Tokens</p>
          <p className="font-mono font-semibold text-2xl">
            {stats.totalTokens.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-muted-foreground text-xs">Avg Latency</p>
          <p className="font-mono font-semibold text-2xl">
            {stats.avgLatency}ms
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-muted-foreground text-xs">Est. Cost</p>
          <p className="font-mono font-semibold text-2xl">
            ${stats.totalCost.toFixed(4)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-muted-foreground text-xs">Tool Calls</p>
          <p className="font-semibold text-2xl">{stats.toolCalls}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-muted-foreground text-xs">Errors</p>
          <p
            className={`font-semibold text-2xl ${stats.errorCount > 0 ? "text-red-600" : ""}`}
          >
            {stats.errorCount}
          </p>
        </div>
      </div>

      {/* Agent filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {agentSlugs.map((slug) => (
          <Button
            key={slug}
            onClick={() => setAgentFilter(slug)}
            size="sm"
            variant={agentFilter === slug ? "default" : "outline"}
          >
            {slug === "all" ? "All agents" : slug}
          </Button>
        ))}
      </div>

      {/* Trace list */}
      {filtered.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-sm">
          No traces recorded yet. Traces are created after each agent
          interaction.
        </p>
      ) : (
        <div className="space-y-1">
          {filtered.slice(0, 50).map((trace) => (
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs"
              key={trace.id}
            >
              <Badge className="text-[9px]" variant="outline">
                {trace.agent_slug}
              </Badge>
              {trace.model_used && (
                <span className="font-mono text-muted-foreground">
                  {trace.model_used}
                </span>
              )}
              <span className="text-muted-foreground">
                {trace.total_tokens.toLocaleString()} tok
              </span>
              <span className="font-mono text-muted-foreground">
                {trace.latency_ms}ms
              </span>
              <span className="text-muted-foreground">
                {trace.tool_count} tools
              </span>
              {trace.fallback_used && (
                <Badge
                  className="bg-amber-500/10 text-[9px] text-amber-600"
                  variant="outline"
                >
                  fallback
                </Badge>
              )}
              {!trace.success && (
                <Badge
                  className="bg-red-500/10 text-[9px] text-red-600"
                  variant="outline"
                >
                  error
                </Badge>
              )}
              <span className="font-mono text-muted-foreground">
                $
                {estimateCost(
                  trace.model_used,
                  trace.prompt_tokens,
                  trace.completion_tokens
                ).toFixed(4)}
              </span>
              <span className="ml-auto text-muted-foreground">
                {new Date(trace.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
