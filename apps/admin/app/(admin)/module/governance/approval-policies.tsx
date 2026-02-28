"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { authedFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApprovalMode = "required" | "auto" | "disabled";

type ApprovalPolicy = {
  id: string;
  tool_name: string;
  approval_mode: string;
  enabled: boolean;
  updated_at?: string;
};

/** Map backend fields to the UI's three-state mode. */
function toUiMode(p: ApprovalPolicy): ApprovalMode {
  if (!p.enabled) return "disabled";
  return p.approval_mode === "auto" ? "auto" : "required";
}

/** Map UI mode to backend payload. */
function toBackendPayload(mode: ApprovalMode): {
  approval_mode: string;
  enabled: boolean;
} {
  if (mode === "disabled") return { approval_mode: "required", enabled: false };
  return { approval_mode: mode, enabled: true };
}

type ApprovalPoliciesProps = {
  orgId: string;
  isEn: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MUTATION_TOOLS = [
  "create_row",
  "update_row",
  "delete_row",
  "send_message",
  "create_maintenance_task",
  "auto_assign_maintenance",
  "escalate_maintenance",
  "dispatch_to_vendor",
  "verify_completion",
  "request_vendor_quote",
  "select_vendor",
  "apply_pricing_recommendation",
  "score_application",
  "classify_and_delegate",
  "auto_populate_lease_charges",
  "create_defect_tickets",
  "import_bank_transactions",
  "auto_reconcile_batch",
  "handle_split_payment",
  "voice_create_maintenance_request",
  "generate_access_code",
  "send_access_code",
  "revoke_access_code",
  "process_sensor_event",
  "execute_playbook",
] as const;

const MODE_STYLES: Record<ApprovalMode, string> = {
  required:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  auto: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  disabled: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

const MODE_LABELS: Record<ApprovalMode, { en: string; es: string }> = {
  required: { en: "Approval Required", es: "Aprobacion Requerida" },
  auto: { en: "Auto-Approve", es: "Auto-Aprobar" },
  disabled: { en: "Disabled", es: "Deshabilitado" },
};

const MODE_CYCLE: ApprovalMode[] = ["required", "auto", "disabled"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApprovalPolicies({ orgId, isEn }: ApprovalPoliciesProps) {
  const queryClient = useQueryClient();
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  // -- Fetch approval policies -----------------------------------------------

  const { data: policies = [], isPending: loadingPolicies } = useQuery<
    ApprovalPolicy[]
  >({
    queryKey: ["approval-policies", orgId],
    queryFn: async () => {
      try {
        const payload = await authedFetch<{ data?: ApprovalPolicy[] }>(
          `/agent/approval-policies?org_id=${encodeURIComponent(orgId)}`
        );
        return payload.data ?? [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  // -- Build lookup map for policies -----------------------------------------

  const policyMap = new Map(policies.map((p) => [p.tool_name, p]));

  // -- Toggle policy mode ----------------------------------------------------

  const cyclePolicyMode = useCallback(
    async (toolName: string) => {
      const existing = policyMap.get(toolName);
      const currentMode: ApprovalMode = existing ? toUiMode(existing) : "required";
      const currentIdx = MODE_CYCLE.indexOf(currentMode);
      const nextMode = MODE_CYCLE[(currentIdx + 1) % MODE_CYCLE.length];

      const key = existing?.id ?? toolName;
      setTogglingIds((prev) => new Set([...prev, key]));

      try {
        await authedFetch(
          `/agent/approval-policies/${encodeURIComponent(toolName)}?org_id=${encodeURIComponent(orgId)}`,
          {
            method: "PATCH",
            body: JSON.stringify(toBackendPayload(nextMode)),
          }
        );

        queryClient.setQueryData(
          ["approval-policies", orgId],
          (prev: ApprovalPolicy[] | undefined) => {
            if (!prev) return prev;
            const idx = prev.findIndex((p) => p.tool_name === toolName);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], ...toBackendPayload(nextMode) };
              return updated;
            }
            return [
              ...prev,
              {
                id: toolName,
                tool_name: toolName,
                ...toBackendPayload(nextMode),
                updated_at: new Date().toISOString(),
              },
            ];
          }
        );
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [orgId, policyMap, queryClient]
  );

  // -- Render ----------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Approval Policy Table */}
      <Card>
        <CardHeader className="space-y-1 border-border/70 border-b pb-4">
          <CardTitle className="text-base">
            {isEn
              ? "Tool Approval Policies"
              : "Politicas de Aprobacion de Herramientas"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Control which mutation tools require human approval before execution"
              : "Controla cuales herramientas de mutacion requieren aprobacion humana antes de ejecutarse"}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {loadingPolicies ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((k) => (
                <Skeleton className="h-12 w-full rounded-xl" key={k} />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {MUTATION_TOOLS.map((toolName) => {
                const policy = policyMap.get(toolName);
                const mode: ApprovalMode = policy ? toUiMode(policy) : "required";
                const toggling = togglingIds.has(policy?.id ?? toolName);

                return (
                  <div
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/30 bg-muted/10 px-4 py-2.5"
                    key={toolName}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[12.5px] text-foreground/90">
                        {toolName}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={cn(
                          "whitespace-nowrap text-[10px]",
                          MODE_STYLES[mode]
                        )}
                        variant="outline"
                      >
                        {isEn ? MODE_LABELS[mode].en : MODE_LABELS[mode].es}
                      </Badge>
                      <Button
                        className="shrink-0"
                        disabled={toggling}
                        onClick={() => {
                          cyclePolicyMode(toolName).catch(() => undefined);
                        }}
                        size="sm"
                        variant="outline"
                      >
                        {toggling ? "..." : isEn ? "Cycle" : "Cambiar"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
