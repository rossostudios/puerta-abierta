"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import type { PropertyAiContext } from "@/app/(admin)/module/properties/hooks/use-property-agent-status";
import { fmtPyg } from "@/components/agent/briefing/helpers";
import type { PropertyPortfolioRow } from "@/lib/features/properties/types";
import { useActiveLocale } from "@/lib/i18n/client";
import { EASING } from "@/lib/module-helpers";
import { cn } from "@/lib/utils";

type PropertyCardProps = {
  row: PropertyPortfolioRow;
  agentContext?: PropertyAiContext;
};

const TYPE_LABELS: Record<string, string> = {
  ltr: "LTR",
  str: "STR",
  mixed: "MIX",
};

const TYPE_COLORS: Record<string, string> = {
  ltr: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  str: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  mixed: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

export function PropertyCard({ row, agentContext }: PropertyCardProps) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const [expanded, setExpanded] = useState(false);

  const needsAttention = row.health !== "stable";
  const occupancyColor =
    row.occupancyRate >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : row.occupancyRate >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="glass-inner overflow-hidden rounded-2xl transition-shadow hover:shadow-[var(--shadow-soft)]"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.3, ease: EASING }}
    >
      {/* Main card row — clickable to expand */}
      <button
        className="flex w-full items-start gap-3 p-4 text-left sm:p-5"
        onClick={() => setExpanded((p) => !p)}
        type="button"
      >
        {/* Emoji avatar */}
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-lg">
          {row.propertyType === "str" ? "\uD83C\uDFD6\uFE0F" : "\uD83C\uDFE2"}
        </span>

        {/* Center content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-foreground text-sm tracking-tight">
              {row.name}
            </h3>

            {/* Type badge */}
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 font-semibold text-[10px] uppercase tracking-wider",
                TYPE_COLORS[row.propertyType] ?? TYPE_COLORS.str
              )}
            >
              {TYPE_LABELS[row.propertyType] ?? "STR"}
            </span>

            {/* Attention dot */}
            {needsAttention && (
              <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-red-500" />
            )}
          </div>

          <p className="mt-0.5 truncate text-muted-foreground/60 text-xs">
            {row.address}
            {row.city ? `, ${row.city}` : ""}
          </p>

          {/* Metrics row */}
          <div className="mt-2.5 flex items-center gap-1.5 text-muted-foreground text-xs">
            <span className="tabular-nums">
              {row.unitCount} {isEn ? "units" : "unid"}
            </span>
            <span className="text-muted-foreground/30">&middot;</span>
            <span className={cn("tabular-nums", occupancyColor)}>
              {row.occupancyRate}% {isEn ? "occ" : "ocup"}
            </span>
            <span className="text-muted-foreground/30">&middot;</span>
            <span className="tabular-nums">{fmtPyg(row.revenueMtdPyg)}</span>
          </div>
        </div>
      </button>

      {/* Expandable detail panel */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASING }}
          >
            <div className="border-border/40 border-t px-4 py-4 sm:px-5">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <DetailItem
                  label={isEn ? "Active Leases" : "Contratos activos"}
                  value={String(row.activeLeaseCount)}
                />
                <DetailItem
                  label={isEn ? "Avg Rent" : "Renta prom."}
                  value={fmtPyg(row.avgRentPyg)}
                />
                <DetailItem
                  label={isEn ? "Open Tickets" : "Tickets abiertos"}
                  tone={row.openTaskCount > 0 ? "warning" : undefined}
                  value={String(row.openTaskCount)}
                />
                <DetailItem
                  label={isEn ? "Overdue" : "Vencidos"}
                  tone={row.overdueCollectionCount > 0 ? "danger" : undefined}
                  value={String(row.overdueCollectionCount)}
                />
              </div>

              {/* Agent status */}
              {agentContext && (
                <div className="mt-3 flex items-center gap-2 text-muted-foreground/70 text-xs">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      agentContext.status === "monitoring" && "bg-emerald-500",
                      agentContext.status === "awaiting-approval" &&
                        "bg-amber-500",
                      agentContext.status === "recently-handled" &&
                        "bg-sky-500",
                      agentContext.status === "offline" &&
                        "bg-muted-foreground/30"
                    )}
                  />
                  <span>
                    {agentContext.status === "monitoring" &&
                      (isEn ? "STOA monitoring" : "STOA monitoreando")}
                    {agentContext.status === "awaiting-approval" &&
                      (isEn
                        ? `${agentContext.pendingCount} pending approval${agentContext.pendingCount !== 1 ? "s" : ""}`
                        : `${agentContext.pendingCount} aprobación${agentContext.pendingCount !== 1 ? "es" : ""} pendiente${agentContext.pendingCount !== 1 ? "s" : ""}`)}
                    {agentContext.status === "recently-handled" &&
                      (isEn ? "Recently handled" : "Atendido recientemente")}
                    {agentContext.status === "offline" &&
                      (isEn ? "Agent offline" : "Agente desconectado")}
                  </span>
                </div>
              )}

              {/* Link to detail page */}
              <Link
                className="mt-3 inline-block text-primary text-xs hover:underline"
                href={`/module/properties/${row.id}`}
              >
                {isEn ? "View details \u2192" : "Ver detalles \u2192"}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DetailItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning" | "danger";
}) {
  return (
    <div>
      <p className="text-muted-foreground/60">{label}</p>
      <p
        className={cn(
          "font-medium tabular-nums",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-red-600 dark:text-red-400",
          !tone && "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}
