"use client";

import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type StreamToolEvent = {
  phase: "call" | "result";
  tool_name: string;
  tool_call_id: string;
  ok?: boolean;
  preview?: string;
};

export type ToolTraceEntry = {
  tool?: string;
  ok?: boolean;
  preview?: string;
  args?: Record<string, unknown>;
};

function formatToolName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function ChatToolEventCard({
  event,
  isEn,
}: {
  event: StreamToolEvent;
  isEn: boolean;
}) {
  const isResult = event.phase === "result";
  const isOk = event.ok !== false;

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
      {isResult ? (
        isOk ? (
          <Icon
            className="h-3.5 w-3.5 text-emerald-500"
            icon={CheckmarkCircle02Icon}
          />
        ) : (
          <Icon className="h-3.5 w-3.5 text-destructive" icon={Cancel01Icon} />
        )
      ) : (
        <Icon
          className="h-3.5 w-3.5 animate-spin text-[var(--sidebar-primary)]"
          icon={Loading03Icon}
        />
      )}
      <span className="font-medium text-xs">
        {formatToolName(event.tool_name)}
      </span>
      {isResult && event.preview ? (
        <span className="truncate text-muted-foreground text-xs">
          {event.preview}
        </span>
      ) : isResult ? null : (
        <span className="text-muted-foreground text-xs">
          {isEn ? "Running..." : "Ejecutando..."}
        </span>
      )}
    </div>
  );
}

export function ChatToolEventStrip({
  events,
  isEn,
}: {
  events: StreamToolEvent[];
  isEn: boolean;
}) {
  if (events.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 py-1">
      {events.map((event) => (
        <ChatToolEventCard
          event={event}
          isEn={isEn}
          key={`${event.tool_call_id}-${event.phase}-${event.preview ?? ""}`}
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
    <div className="mt-2">
      <button
        className="flex flex-wrap items-center gap-1.5"
        onClick={onToggle}
        type="button"
      >
        {trace.map((tool) => (
          <Badge
            className={cn(
              "cursor-pointer gap-1 font-normal text-[10px] transition-colors",
              "hover:bg-muted"
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
            {tool.tool ?? "tool"}
          </Badge>
        ))}
      </button>

      {isExpanded ? (
        <div className="mt-2 space-y-1 rounded-lg border border-border/50 bg-muted/20 p-2">
          {trace.map((tool) => (
            <div
              className="flex items-center justify-between gap-2 rounded-md bg-background/80 px-2.5 py-1.5"
              key={`trace-detail-${tool.tool ?? "tool"}-${tool.preview ?? ""}-${tool.ok !== false ? "ok" : "error"}`}
            >
              <span className="font-mono text-[11px]">
                {tool.tool ?? "tool"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {tool.preview || (tool.ok !== false ? "ok" : "error")}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
