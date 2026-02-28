"use client";

import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type StreamToolEvent = {
  phase: "call" | "result";
  tool_name: string;
  tool_call_id: string;
  ok?: boolean;
  preview?: string;
  error_explanation?: string;
  suggested_actions?: Array<{ label: string; action: string }>;
};

export type ToolTraceEntry = {
  tool?: string;
  ok?: boolean;
  preview?: string;
  args?: Record<string, unknown>;
};

export type PlanStep = {
  index: number;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  tool_name?: string;
  result_preview?: string;
};

function formatToolName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function ChatToolEventCard({
  event,
  isEn,
  onSuggestedAction,
}: {
  event: StreamToolEvent;
  isEn: boolean;
  onSuggestedAction?: (action: string) => void;
}) {
  const isResult = event.phase === "result";
  const isOk = event.ok !== false;
  const hasError = isResult && !isOk;

  return (
    <div className="glass-inner rounded-xl px-3 py-2 transition-all duration-200">
      <div className="flex items-center gap-2.5">
        {isResult ? (
          isOk ? (
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/10">
              <Icon
                className="h-2.5 w-2.5 text-emerald-500"
                icon={CheckmarkCircle02Icon}
              />
            </div>
          ) : (
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-destructive/10">
              <Icon
                className="h-2.5 w-2.5 text-destructive"
                icon={Cancel01Icon}
              />
            </div>
          )
        ) : (
          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--sidebar-primary)]/10">
            <Icon
              className="h-2.5 w-2.5 animate-spin text-[var(--sidebar-primary)]"
              icon={Loading03Icon}
            />
          </div>
        )}
        <span className="font-medium text-[11.5px] text-foreground/80">
          {formatToolName(event.tool_name)}
        </span>
        {isResult && event.preview ? (
          <span className="truncate text-[11px] text-muted-foreground/60">
            {event.preview}
          </span>
        ) : isResult ? null : (
          <span className="text-[11px] text-muted-foreground/50">
            {isEn ? "Running..." : "Ejecutando..."}
          </span>
        )}
      </div>

      {/* Error explanation + suggested actions */}
      {hasError && event.error_explanation ? (
        <div className="mt-1.5 ml-6.5 space-y-1.5">
          <p className="text-[11px] text-destructive/80">
            {event.error_explanation}
          </p>
          {event.suggested_actions?.length ? (
            <div className="flex flex-wrap gap-1">
              {event.suggested_actions.map((sa) => (
                <button
                  className="rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 font-medium text-[10px] text-foreground/70 transition-colors hover:border-[var(--sidebar-primary)]/40 hover:bg-[var(--sidebar-primary)]/[0.06] hover:text-foreground"
                  key={sa.action}
                  onClick={() => onSuggestedAction?.(sa.action)}
                  type="button"
                >
                  {sa.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ChatToolEventStrip({
  events,
  isEn,
  onSuggestedAction,
}: {
  events: StreamToolEvent[];
  isEn: boolean;
  onSuggestedAction?: (action: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  if (events.length === 0) return null;

  const shouldVirtualize = events.length > 5 && !showAll;
  const hiddenCount = shouldVirtualize ? events.length - 3 : 0;
  const visibleEvents = shouldVirtualize ? events.slice(-3) : events;

  return (
    <div className="flex flex-col gap-1.5 py-1" style={{ contain: "layout" }}>
      {shouldVirtualize ? (
        <button
          className="self-start rounded-lg px-2.5 py-1 font-medium text-[10.5px] text-muted-foreground/60 transition-colors hover:bg-muted/30 hover:text-muted-foreground"
          onClick={() => setShowAll(true)}
          type="button"
        >
          {hiddenCount} {isEn ? "more tools..." : "herramientas más..."}
        </button>
      ) : null}
      {visibleEvents.map((event) => (
        <ChatToolEventCard
          event={event}
          isEn={isEn}
          key={`${event.tool_call_id}-${event.phase}-${event.preview ?? ""}`}
          onSuggestedAction={onSuggestedAction}
        />
      ))}
    </div>
  );
}

export function ToolTraceBadges({
  trace,
  isExpanded,
  onToggle,
}: {
  trace: ToolTraceEntry[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  if (trace.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        className="flex flex-wrap items-center gap-1.5"
        onClick={onToggle}
        type="button"
      >
        {trace.map((tool) => (
          <Badge
            className={cn(
              "cursor-pointer gap-1.5 border-border/30 bg-transparent font-normal text-[10px] transition-all duration-150",
              "hover:border-border/60 hover:bg-muted/30"
            )}
            key={`trace-${tool.tool ?? "tool"}-${tool.preview ?? ""}-${tool.ok !== false ? "ok" : "error"}`}
            variant="outline"
          >
            {tool.ok !== false ? (
              <Icon
                className="h-2.5 w-2.5 text-emerald-500"
                icon={CheckmarkCircle02Icon}
              />
            ) : (
              <Icon
                className="h-2.5 w-2.5 text-destructive"
                icon={Cancel01Icon}
              />
            )}
            <span className="text-muted-foreground/70">
              {tool.tool ?? "tool"}
            </span>
          </Badge>
        ))}
      </button>

      {isExpanded ? (
        <div className="glass-inner mt-2 space-y-1 rounded-xl p-2">
          {trace.map((tool) => (
            <div
              className="flex items-center justify-between gap-2 rounded-lg bg-background/60 px-2.5 py-1.5"
              key={`trace-detail-${tool.tool ?? "tool"}-${tool.preview ?? ""}-${tool.ok !== false ? "ok" : "error"}`}
            >
              <span className="font-mono text-[10.5px] text-foreground/70">
                {tool.tool ?? "tool"}
              </span>
              <span className="text-[10.5px] text-muted-foreground/50">
                {tool.preview || (tool.ok !== false ? "ok" : "error")}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Display execution plan steps with expand/collapse and status indicators. */
export function PlanStepsCard({
  steps,
  isExpanded,
  onToggle,
  isEn,
}: {
  steps: PlanStep[];
  isExpanded: boolean;
  onToggle: () => void;
  isEn: boolean;
}) {
  if (steps.length === 0) return null;

  const completed = steps.filter((s) => s.status === "completed").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const inProgress = steps.filter((s) => s.status === "in_progress").length;

  return (
    <div className="mt-2 rounded-lg border border-border/50 bg-muted/10">
      <button
        className="flex w-full items-center justify-between px-3 py-2"
        onClick={onToggle}
        type="button"
      >
        <span className="font-medium text-xs">
          {isEn ? "Execution Plan" : "Plan de Ejecución"}{" "}
          <span className="text-muted-foreground">
            ({completed}/{steps.length} {isEn ? "steps" : "pasos"})
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          {inProgress > 0 && (
            <Badge className="text-[10px]" variant="secondary">
              <Icon
                className="mr-0.5 h-2.5 w-2.5 animate-spin"
                icon={Loading03Icon}
              />
              {inProgress} {isEn ? "running" : "activos"}
            </Badge>
          )}
          {failed > 0 && (
            <Badge className="text-[10px] text-destructive" variant="outline">
              {failed} {isEn ? "failed" : "fallidos"}
            </Badge>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-1 border-border/50 border-t px-3 py-2">
          {steps.map((step) => (
            <div
              className="flex items-center gap-2 rounded-md px-2 py-1.5"
              key={`plan-step-${step.index}`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-[10px] tabular-nums">
                {step.index + 1}
              </span>
              {step.status === "completed" ? (
                <Icon
                  className="h-3 w-3 shrink-0 text-emerald-500"
                  icon={CheckmarkCircle02Icon}
                />
              ) : step.status === "failed" ? (
                <Icon
                  className="h-3 w-3 shrink-0 text-destructive"
                  icon={Cancel01Icon}
                />
              ) : step.status === "in_progress" ? (
                <Icon
                  className="h-3 w-3 shrink-0 animate-spin text-[var(--sidebar-primary)]"
                  icon={Loading03Icon}
                />
              ) : (
                <span className="h-3 w-3 shrink-0 rounded-full border border-border/60" />
              )}
              <span
                className={cn(
                  "text-xs",
                  step.status === "completed" && "text-muted-foreground",
                  step.status === "failed" && "text-destructive"
                )}
              >
                {step.description}
              </span>
              {step.tool_name && (
                <Badge className="ml-auto text-[9px]" variant="outline">
                  {step.tool_name.replace(/_/g, " ")}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
