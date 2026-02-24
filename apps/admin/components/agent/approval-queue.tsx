"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/supabase/use-realtime-subscription";
import { cn } from "@/lib/utils";

type Approval = {
  id: string;
  agent_slug: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  reason?: string | null;
  estimated_impact?: Record<string, unknown> | null;
  delivery_status?: string | null;
  status: string;
  created_at: string;
};

type ApprovalQueueProps = {
  orgId: string;
  locale: Locale;
};

const KIND_FILTERS = ["all", "approval", "anomaly"] as const;
const PRIORITY_FILTERS = ["all", "critical", "high", "medium"] as const;

function confidenceTone(pct: number): string {
  if (pct >= 80) return "text-emerald-600 bg-emerald-500/10 border-emerald-500/30";
  if (pct >= 60) return "text-amber-600 bg-amber-500/10 border-amber-500/30";
  return "text-red-600 bg-red-500/10 border-red-500/30";
}

export function ApprovalQueue({ orgId, locale }: ApprovalQueueProps) {
  "use no memo";
  const isEn = locale === "en-US";
  const queryClient = useQueryClient();
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [expandedWhy, setExpandedWhy] = useState<Set<string>>(new Set());
  const [expandedArgs, setExpandedArgs] = useState<Set<string>>(new Set());

  const { data: approvals = [], isPending: loading } = useQuery({
    queryKey: ["agent-approvals", orgId],
    queryFn: async () => {
      const response = await fetch(
        `/api/agent/approvals?org_id=${encodeURIComponent(orgId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!response.ok) return [];
      const payload = (await response.json()) as { data?: Approval[] };
      return payload.data ?? [];
    },
    refetchInterval: 30_000,
  });

  // --- Realtime delivery status updates ---
  const handleRealtimeUpdate = useCallback(
    (payload: {
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) => {
      const newRow = payload.new;
      const id = typeof newRow.id === "string" ? newRow.id : null;
      const deliveryStatus =
        typeof newRow.delivery_status === "string"
          ? newRow.delivery_status
          : null;
      if (!id || !deliveryStatus) return;

      queryClient.setQueryData(
        ["agent-approvals", orgId],
        (prev: Approval[] | undefined) =>
          prev
            ? prev.map((a) =>
                a.id === id ? { ...a, delivery_status: deliveryStatus } : a
              )
            : []
      );

      if (deliveryStatus === "delivered" || deliveryStatus === "sent") {
        const recipient =
          typeof newRow.tool_args === "object" &&
          newRow.tool_args !== null &&
          typeof (newRow.tool_args as Record<string, unknown>).recipient ===
            "string"
            ? (newRow.tool_args as Record<string, unknown>).recipient
            : isEn
              ? "guest"
              : "huésped";
        toast.success(
          isEn
            ? `Reply delivered to ${recipient}`
            : `Respuesta entregada a ${recipient}`
        );
      }
    },
    [orgId, queryClient, isEn]
  );

  useRealtimeSubscription({
    table: "agent_approvals",
    event: "UPDATE",
    filter: `organization_id=eq.${orgId}`,
    enabled: !!orgId,
    onUpdate: handleRealtimeUpdate,
  });

  const handleReview = async (
    id: string,
    action: "approve" | "reject",
    approval?: Approval
  ) => {
    setBusy((prev) => ({ ...prev, [id]: true }));
    const note = reviewNotes[id] || null;
    try {
      await fetch(
        `/api/agent/approvals/${id}/${action}?org_id=${encodeURIComponent(orgId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ note }),
        }
      );

      // Item 8: "Saved you X min" toast for send_message approvals
      if (action === "approve" && approval?.tool_name === "send_message") {
        const recipient =
          typeof approval.tool_args.recipient === "string"
            ? approval.tool_args.recipient
            : isEn
              ? "guest"
              : "huésped";
        toast.success(isEn ? "Agent saved you ~4 min" : "El agente te ahorro ~4 min", {
          description: isEn
            ? `Auto-drafted reply to ${recipient}`
            : `Respuesta auto-redactada para ${recipient}`,
        });
      }

      queryClient.setQueryData(
        ["agent-approvals", orgId],
        (prev: Approval[] | undefined) =>
          prev ? prev.filter((a) => a.id !== id) : []
      );
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setBusy((prev) => ({ ...prev, [id]: false }));
    } catch {
      setBusy((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleBatchReview = async (action: "approve" | "reject") => {
    if (selected.size === 0) return;
    setBatchBusy(true);
    try {
      await fetch(
        `/api/agent/approvals/batch?org_id=${encodeURIComponent(orgId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            ids: Array.from(selected),
            action,
          }),
        }
      );
      queryClient.setQueryData(
        ["agent-approvals", orgId],
        (prev: Approval[] | undefined) =>
          prev ? prev.filter((a) => !selected.has(a.id)) : []
      );
      setSelected(new Set());
    } catch {
      // silently fail
    } finally {
      setBatchBusy(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === approvals.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(approvals.map((a) => a.id)));
    }
  };

  const toggleWhy = (id: string) => {
    setExpandedWhy((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleArgs = (id: string) => {
    setExpandedArgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (approvals.length === 0) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="space-y-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">
            {isEn ? "Pending approvals" : "Aprobaciones pendientes"}
          </CardTitle>
          <Badge className="font-mono" variant="secondary">
            {approvals.length}
          </Badge>
        </div>
        <CardDescription>
          {isEn
            ? "AI agent actions awaiting human review"
            : "Acciones de agentes IA esperando revisión humana"}
        </CardDescription>

        {/* Batch actions */}
        {approvals.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={toggleSelectAll} size="sm" variant="outline">
              {selected.size === approvals.length
                ? isEn
                  ? "Deselect all"
                  : "Deseleccionar todo"
                : isEn
                  ? "Select all"
                  : "Seleccionar todo"}
            </Button>
            {selected.size > 0 && (
              <>
                <Button
                  disabled={batchBusy}
                  onClick={() => {
                    handleBatchReview("approve").catch(() => undefined);
                  }}
                  size="sm"
                >
                  {isEn
                    ? `Approve ${selected.size} selected`
                    : `Aprobar ${selected.size} seleccionados`}
                </Button>
                <Button
                  disabled={batchBusy}
                  onClick={() => {
                    handleBatchReview("reject").catch(() => undefined);
                  }}
                  size="sm"
                  variant="outline"
                >
                  {isEn
                    ? `Reject ${selected.size} selected`
                    : `Rechazar ${selected.size} seleccionados`}
                </Button>
              </>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {approvals.map((approval) => {
          const impact = approval.estimated_impact;
          const confidence =
            typeof impact?.confidence === "number" ? impact.confidence : null;
          const channel =
            typeof impact?.channel === "string" ? impact.channel : null;
          const recipient =
            typeof impact?.recipient === "string"
              ? impact.recipient
              : typeof approval.tool_args.recipient === "string"
                ? (approval.tool_args.recipient as string)
                : null;
          const hasWhyData =
            confidence !== null || channel !== null || recipient !== null;
          const whyOpen = expandedWhy.has(approval.id);
          const argsOpen = expandedArgs.has(approval.id);

          return (
            <div
              className={`space-y-2 rounded-xl border bg-card p-3 transition-colors ${
                selected.has(approval.id)
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/60"
              }`}
              key={approval.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                {approvals.length > 1 && (
                  <input
                    checked={selected.has(approval.id)}
                    className="h-3.5 w-3.5 rounded border-border"
                    onChange={() => toggleSelect(approval.id)}
                    type="checkbox"
                  />
                )}
                <Badge className="font-mono text-[11px]" variant="outline">
                  {approval.agent_slug}
                </Badge>
                <Badge className="font-mono text-[11px]" variant="secondary">
                  {approval.tool_name}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {new Date(approval.created_at).toLocaleString(locale)}
                </span>
                {/* Item 2a: Delivery status pill */}
                {approval.delivery_status ? (
                  <StatusBadge
                    className="text-[10px]"
                    value={approval.delivery_status}
                  />
                ) : null}
              </div>

              {/* Reason text from LLM */}
              {approval.reason && (
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {approval.reason}
                </p>
              )}

              {/* Item 1: "Why this reply?" collapsible card */}
              {hasWhyData ? (
                <div className="rounded-lg border border-border/40 bg-muted/20">
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => toggleWhy(approval.id)}
                    type="button"
                  >
                    <span
                      className={cn(
                        "transition-transform",
                        whyOpen && "rotate-90"
                      )}
                    >
                      ▸
                    </span>
                    {isEn ? "Why this reply?" : "¿Por qué esta respuesta?"}
                    {confidence !== null ? (
                      <span
                        className={cn(
                          "ml-auto inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                          confidenceTone(confidence)
                        )}
                        title={
                          isEn
                            ? `Confidence: ${confidence}%`
                            : `Confianza: ${confidence}%`
                        }
                      >
                        {confidence}%
                      </span>
                    ) : null}
                  </button>
                  {whyOpen ? (
                    <div className="space-y-1.5 border-t border-border/30 px-3 py-2">
                      {confidence !== null ? (
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-muted-foreground">
                            {isEn ? "Confidence" : "Confianza"}
                          </span>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                              confidenceTone(confidence)
                            )}
                          >
                            {confidence}%
                          </span>
                        </div>
                      ) : null}
                      {channel ? (
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-muted-foreground">
                            {isEn ? "Channel" : "Canal"}
                          </span>
                          <StatusBadge
                            className="text-[10px]"
                            value={channel}
                          />
                        </div>
                      ) : null}
                      {recipient ? (
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-muted-foreground">
                            {isEn ? "Recipient" : "Destinatario"}
                          </span>
                          <span className="font-medium text-foreground/80">
                            {recipient}
                          </span>
                        </div>
                      ) : null}
                      {/* Render remaining estimated_impact fields */}
                      {impact
                        ? Object.entries(impact)
                            .filter(
                              ([k]) =>
                                k !== "confidence" &&
                                k !== "channel" &&
                                k !== "recipient"
                            )
                            .map(([k, v]) => (
                              <div
                                className="flex items-center gap-2 text-[11px]"
                                key={k}
                              >
                                <span className="text-muted-foreground">
                                  {k.replace(/_/g, " ")}
                                </span>
                                <span className="font-medium text-foreground/80">
                                  {typeof v === "string" || typeof v === "number"
                                    ? String(v)
                                    : JSON.stringify(v)}
                                </span>
                              </div>
                            ))
                        : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Collapsible tool_args JSON */}
              <div className="rounded-lg border border-border/40 bg-muted/20">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleArgs(approval.id)}
                  type="button"
                >
                  <span
                    className={cn(
                      "transition-transform",
                      argsOpen && "rotate-90"
                    )}
                  >
                    ▸
                  </span>
                  {isEn ? "Tool arguments" : "Argumentos de herramienta"}
                  <Badge
                    className="ml-auto font-mono text-[9px]"
                    variant="outline"
                  >
                    {Object.keys(approval.tool_args).length}{" "}
                    {isEn ? "fields" : "campos"}
                  </Badge>
                </button>
                {argsOpen ? (
                  <pre className="overflow-x-auto border-t border-border/30 px-3 py-2 text-[11px]">
                    {JSON.stringify(approval.tool_args, null, 2)}
                  </pre>
                ) : null}
              </div>

              <Textarea
                className="text-[12px]"
                maxLength={500}
                onChange={(e) =>
                  setReviewNotes((prev) => ({
                    ...prev,
                    [approval.id]: e.target.value,
                  }))
                }
                placeholder={
                  isEn
                    ? "Optional review note..."
                    : "Nota de revisión opcional..."
                }
                rows={2}
                value={reviewNotes[approval.id] ?? ""}
              />

              <div className="flex items-center gap-2">
                <Button
                  disabled={busy[approval.id]}
                  onClick={() => {
                    handleReview(approval.id, "approve", approval).catch(
                      () => undefined
                    );
                  }}
                  size="sm"
                >
                  {isEn ? "Approve & execute" : "Aprobar y ejecutar"}
                </Button>
                <Button
                  disabled={busy[approval.id]}
                  onClick={() => {
                    handleReview(approval.id, "reject", approval).catch(
                      () => undefined
                    );
                  }}
                  size="sm"
                  variant="outline"
                >
                  {isEn ? "Reject" : "Rechazar"}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
