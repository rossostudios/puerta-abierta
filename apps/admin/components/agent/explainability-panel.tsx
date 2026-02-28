"use client";

import {
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { useState } from "react";
import {
  ToolTraceBadges,
  type ToolTraceEntry,
} from "@/components/agent/chat-tool-event";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type ReasoningStep = {
  input: string;
  rule: string;
  outcome: string;
};

export type ExplanationPayload = {
  summary: string;
  reasoning_steps?: ReasoningStep[];
};

type ExplainabilityPanelProps = {
  explanation: ExplanationPayload;
  toolTrace?: ToolTraceEntry[] | null;
  isEn: boolean;
};

export function ExplainabilityPanel({
  explanation,
  toolTrace,
  isEn,
}: ExplainabilityPanelProps) {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [traceExpanded, setTraceExpanded] = useState(false);

  const hasReasoning =
    explanation.reasoning_steps && explanation.reasoning_steps.length > 0;
  const hasTrace = toolTrace && toolTrace.length > 0;

  return (
    <div className="mt-3 space-y-2">
      {/* Tier 1: Always-visible summary */}
      <div className="flex items-start gap-2 rounded-xl bg-[var(--sidebar-primary)]/[0.04] px-3 py-2.5">
        <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--sidebar-primary)]/10">
          <Icon
            className="h-2.5 w-2.5 text-[var(--sidebar-primary)]"
            icon={CheckmarkCircle02Icon}
          />
        </div>
        <p className="text-[12.5px] text-foreground/75 leading-relaxed">
          {explanation.summary}
        </p>
      </div>

      {/* Tier 2: Expandable reasoning chain */}
      {hasReasoning ? (
        <div className="rounded-xl border border-border/30">
          <button
            className="flex w-full items-center justify-between px-3 py-2 text-left"
            onClick={() => setReasoningExpanded((prev) => !prev)}
            type="button"
          >
            <span className="font-medium text-[11.5px] text-muted-foreground/80">
              {isEn ? "Reasoning chain" : "Cadena de razonamiento"}
              <span className="ml-1.5 text-muted-foreground/50">
                ({explanation.reasoning_steps?.length}{" "}
                {isEn ? "steps" : "pasos"})
              </span>
            </span>
            <Icon
              className={cn(
                "h-3 w-3 text-muted-foreground/50 transition-transform duration-200",
                reasoningExpanded && "rotate-180"
              )}
              icon={ArrowDown01Icon}
            />
          </button>

          {reasoningExpanded ? (
            <div className="space-y-1.5 border-border/30 border-t px-3 py-2.5">
              {explanation.reasoning_steps?.map((step, idx) => (
                <div
                  className="flex items-start gap-2 rounded-lg bg-background/60 px-2.5 py-2"
                  key={`reason-${idx}`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-[10px] tabular-nums">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-[11.5px] text-foreground/70">
                      <span className="font-medium text-foreground/80">
                        {step.input}
                      </span>
                    </p>
                    <p className="text-[10.5px] text-muted-foreground/60">
                      {step.rule}
                    </p>
                    <Badge
                      className="mt-0.5 border-border/30 bg-transparent font-normal text-[10px]"
                      variant="outline"
                    >
                      {step.outcome}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Tier 3: Existing ToolTraceBadges as raw data */}
      {hasTrace ? (
        <ToolTraceBadges
          isExpanded={traceExpanded}
          onToggle={() => setTraceExpanded((prev) => !prev)}
          trace={toolTrace}
        />
      ) : null}
    </div>
  );
}
