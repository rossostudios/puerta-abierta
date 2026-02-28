"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { AgentApproval } from "@/lib/api";
import { useVisibilityPollingInterval } from "@/lib/hooks/use-visibility-polling";

export type PropertyAiStatus =
  | "awaiting-approval"
  | "recently-handled"
  | "monitoring"
  | "offline";

export type PropertyAiContext = {
  status: PropertyAiStatus;
  latestToolName?: string;
  latestAgentSlug?: string;
  lastActiveAt?: string;
  pendingCount: number;
};

type UsePropertyAgentStatusOptions = {
  orgId: string;
  propertyIds: string[];
  agentOnline: boolean;
};

/**
 * Extract property_id from an approval's tool_args using multiple heuristics:
 *  - Direct `tool_args.property_id`
 *  - Nested `tool_args.data.property_id` (for create_row style)
 *  - `tool_args.table === "properties"` + `tool_args.id` (direct property mutations)
 */
function extractPropertyId(approval: AgentApproval): string | null {
  const args = approval.tool_args;
  if (!args) return null;

  if (typeof args.property_id === "string") return args.property_id;

  const data = args.data as Record<string, unknown> | undefined;
  if (data && typeof data.property_id === "string") return data.property_id;

  if (args.table === "properties" && typeof args.id === "string")
    return args.id;

  return null;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function usePropertyAgentStatus({
  orgId,
  propertyIds,
  agentOnline,
}: UsePropertyAgentStatusOptions) {
  const pollInterval = useVisibilityPollingInterval({
    enabled: !!orgId,
    foregroundMs: 45_000,
    backgroundMs: 60_000,
  });

  const { data: approvalsData } = useQuery<{ data?: AgentApproval[] }>({
    queryKey: ["agent-approvals", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/approvals?org_id=${encodeURIComponent(orgId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok) return {};
      return res.json() as Promise<{ data?: AgentApproval[] }>;
    },
    staleTime: 20_000,
    enabled: !!orgId,
    retry: false,
    refetchInterval: pollInterval,
  });

  const approvals = approvalsData?.data ?? [];

  const propertyAgentStatusMap = useMemo(() => {
    const map = new Map<string, PropertyAiContext>();
    const now = Date.now();

    // Initialize all property IDs with default status
    const defaultStatus: PropertyAiStatus = agentOnline
      ? "monitoring"
      : "offline";
    for (const pid of propertyIds) {
      map.set(pid, { status: defaultStatus, pendingCount: 0 });
    }

    // Group approvals by property ID
    const approvalsByProperty = new Map<string, AgentApproval[]>();
    for (const approval of approvals) {
      const pid = extractPropertyId(approval);
      if (!(pid && map.has(pid))) continue;
      const existing = approvalsByProperty.get(pid) ?? [];
      existing.push(approval);
      approvalsByProperty.set(pid, existing);
    }

    // Derive status per property
    for (const [pid, propertyApprovals] of approvalsByProperty) {
      const pending = propertyApprovals.filter((a) => a.status === "pending");
      const handled = propertyApprovals.filter(
        (a) =>
          (a.status === "approved" || a.status === "executed") &&
          a.executed_at &&
          now - new Date(a.executed_at).getTime() < TWO_HOURS_MS
      );

      let status: PropertyAiStatus = agentOnline ? "monitoring" : "offline";
      let latestToolName: string | undefined;
      let latestAgentSlug: string | undefined;
      let lastActiveAt: string | undefined;

      if (pending.length > 0) {
        status = "awaiting-approval";
        const latest = pending[0];
        latestToolName = latest.tool_name;
        latestAgentSlug = latest.agent_slug;
        lastActiveAt = latest.created_at;
      } else if (handled.length > 0) {
        status = "recently-handled";
        const latest = handled[0];
        latestToolName = latest.tool_name;
        latestAgentSlug = latest.agent_slug;
        lastActiveAt = latest.executed_at ?? latest.created_at;
      }

      map.set(pid, {
        status,
        latestToolName,
        latestAgentSlug,
        lastActiveAt,
        pendingCount: pending.length,
      });
    }

    return map;
  }, [approvals, propertyIds, agentOnline]);

  return { propertyAgentStatusMap, approvals };
}
