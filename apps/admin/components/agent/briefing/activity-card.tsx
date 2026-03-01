"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CARD,
  EASING,
  relativeTime,
  SectionLabel,
  type Stats,
} from "./helpers";

const AGENT_LABELS: Record<string, { label: string; color: string }> = {
  "guest-concierge": {
    label: "GUEST COMMS",
    color: "bg-[var(--agentic-lavender)]/15 text-[var(--agentic-lavender)]",
  },
  "finance-agent": {
    label: "FINANCE",
    color: "bg-[var(--agentic-rose-gold)]/15 text-[var(--agentic-rose-gold)]",
  },
  "leasing-agent": {
    label: "LEASE MGMT",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  "maintenance-triage": {
    label: "MAINTENANCE",
    color: "bg-[var(--agentic-cyan)]/15 text-[var(--agentic-cyan)]",
  },
  supervisor: {
    label: "PRICING",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
};

const INITIAL_VISIBLE = 4;

function humanizeToolName(tool: string): string {
  return tool.replace(/_/g, " ");
}

export function ActivityCard({ stats, isEn }: { stats: Stats; isEn: boolean }) {
  const allItems = (stats.recent_activity ?? []).filter(
    (a) => a.status !== "pending"
  );
  const [expanded, setExpanded] = useState(false);

  if (allItems.length === 0) return null;

  const visibleItems = expanded ? allItems : allItems.slice(0, INITIAL_VISIBLE);
  const hiddenCount = allItems.length - INITIAL_VISIBLE;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(CARD, "space-y-4 p-5")}
      initial={{ opacity: 0, y: 12 }}
      transition={{ delay: 0.3, duration: 0.4, ease: EASING }}
    >
      <SectionLabel>
        {isEn ? "What I've Been Doing" : "Lo Que He Estado Haciendo"}
      </SectionLabel>

      <div className="space-y-2">
        {visibleItems.map((item, i) => {
          const agentMeta = AGENT_LABELS[item.agent_slug ?? ""] ?? {
            label: (item.agent_slug ?? "AGENT").toUpperCase(),
            color: "bg-muted text-muted-foreground",
          };

          const description = item.reasoning
            ? item.reasoning
            : humanizeToolName(item.tool_name);

          return (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 py-1.5"
              initial={{ opacity: 0, y: 6 }}
              key={`${item.tool_name}-${item.created_at}-${i}`}
              transition={{
                delay: 0.35 + i * 0.06,
                duration: 0.25,
                ease: EASING,
              }}
            >
              <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground/50 tabular-nums">
                {relativeTime(item.created_at)}
              </span>
              <p className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">
                {description}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  className={cn(
                    "border-0 font-medium text-[9px] tracking-wider",
                    agentMeta.color
                  )}
                  variant="secondary"
                >
                  {agentMeta.label}
                </Badge>
                {item.property_name && (
                  <span className="hidden text-[11px] text-muted-foreground/40 sm:inline">
                    {item.property_name}
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {hiddenCount > 0 && !expanded && (
        <button
          className="w-full pt-1 text-center font-medium text-[12px] text-muted-foreground/60 transition-colors hover:text-foreground"
          onClick={() => setExpanded(true)}
          type="button"
        >
          {isEn ? `Show ${hiddenCount} more` : `Mostrar ${hiddenCount} más`}
        </button>
      )}
    </motion.div>
  );
}
