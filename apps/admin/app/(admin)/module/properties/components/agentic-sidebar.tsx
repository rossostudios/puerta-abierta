"use client";

import {
  AiVoiceGeneratorIcon,
  DollarCircleIcon,
  Home01Icon,
  InformationCircleIcon,
  Invoice03Icon,
  SparklesIcon,
  Task01Icon,
} from "@hugeicons/core-free-icons";
import { motion } from "motion/react";
import Link from "next/link";
import { useMemo } from "react";

import { Icon } from "@/components/ui/icon";
import type { AgentApproval } from "@/lib/api";
import type {
  PropertyActivityItem,
  PropertyPortfolioRow,
} from "@/lib/features/properties/types";
import { formatCompactCurrency, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const EASING = [0.22, 1, 0.36, 1] as const;

type AgenticSidebarProps = {
  totalValuePyg: number;
  occupancyRate: number;
  avgRentPyg: number;
  totalRevenueMtdPyg: number;
  totalOverdueCollections: number;
  totalVacantUnits: number;
  vacancyCostPyg: number;
  recentActivity: PropertyActivityItem[];
  approvals: AgentApproval[];
  propertyRows: PropertyPortfolioRow[];
  isEn: boolean;
  formatLocale: "en-US" | "es-PY";
  orgId?: string;
  agentOnline: boolean;
};

/* ── helpers ── */

function occupancyColor(rate: number): string {
  if (rate >= 90) return "text-[var(--agentic-lavender)]";
  if (rate >= 70) return "text-[var(--agentic-cyan)]";
  return "text-[var(--agentic-rose-gold)]";
}

type WorkLogEntry = {
  id: string;
  text: string;
  time: string;
  type: "activity" | "approval-executed" | "approval-pending";
  timestamp: number;
};

function buildWorkLog(
  recentActivity: PropertyActivityItem[],
  approvals: AgentApproval[],
  propertyRows: PropertyPortfolioRow[],
  isEn: boolean
): WorkLogEntry[] {
  const propertyNameMap = new Map(propertyRows.map((r) => [r.id, r.name]));
  const entries: WorkLogEntry[] = [];

  for (const item of recentActivity) {
    let text: string;
    if (item.id.startsWith("task")) {
      text = isEn
        ? `Completed maintenance '${item.title}'`
        : `Completó mantenimiento '${item.title}'`;
    } else if (item.id.startsWith("collection")) {
      text = isEn
        ? `Reconciled payment · ${item.detail}`
        : `Concilió pago · ${item.detail}`;
    } else {
      text = item.title;
    }
    entries.push({
      id: item.id,
      text,
      time: formatRelativeTime(item.timestamp, isEn),
      type: "activity",
      timestamp: item.timestamp.getTime(),
    });
  }

  for (const approval of approvals.slice(0, 8)) {
    const toolLabel = approval.tool_name.replace(/_/g, " ");
    const agentLabel = approval.agent_slug;
    const isPending = approval.status === "pending";

    // Try to find property name from tool_args
    const args = approval.tool_args;
    const pid =
      (typeof args?.property_id === "string" && args.property_id) ||
      ((args?.data as Record<string, unknown> | undefined)?.property_id as string | undefined) ||
      (args?.table === "properties" && typeof args.id === "string" ? args.id : null);
    const propName = pid ? propertyNameMap.get(pid) : undefined;
    const propSuffix = propName ? ` · ${propName}` : "";

    const text = isPending
      ? isEn
        ? `Needs your approval: ${toolLabel}${propSuffix}`
        : `Necesita tu aprobación: ${toolLabel}${propSuffix}`
      : isEn
        ? `Executed ${toolLabel} via ${agentLabel}${propSuffix}`
        : `Ejecutó ${toolLabel} vía ${agentLabel}${propSuffix}`;

    const ts = approval.executed_at ?? approval.created_at;

    entries.push({
      id: `approval-${approval.id}`,
      text,
      time: formatRelativeTime(ts, isEn),
      type: isPending ? "approval-pending" : "approval-executed",
      timestamp: new Date(ts).getTime(),
    });
  }

  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries.slice(0, 10);
}

/* ── component ── */

export function AgenticSidebar({
  totalValuePyg,
  occupancyRate,
  avgRentPyg,
  totalRevenueMtdPyg,
  totalOverdueCollections,
  totalVacantUnits,
  vacancyCostPyg,
  recentActivity,
  approvals,
  propertyRows,
  isEn,
  formatLocale,
  orgId,
  agentOnline,
}: AgenticSidebarProps) {
  const hasAlerts = totalOverdueCollections > 0 || totalVacantUnits > 0;
  const workLog = useMemo(
    () => buildWorkLog(recentActivity, approvals, propertyRows, isEn),
    [recentActivity, approvals, propertyRows, isEn]
  );

  return (
    <div className="glass-panel rounded-2xl p-5">
      {/* Section A: Agent Status Header */}
      <div className="space-y-1.5 pb-5">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-[11px] text-muted-foreground/70 uppercase tracking-widest">
            {isEn ? "Agent's Workspace" : "Espacio del Agente"}
          </h3>
          {agentOnline && (
            <span className="gentle-pulse inline-block h-1.5 w-1.5 rounded-full bg-[var(--agentic-cyan)]" />
          )}
        </div>
        <div className="font-bold text-3xl tracking-tight text-foreground">
          {formatCompactCurrency(totalValuePyg, "PYG", formatLocale)}
        </div>
        <div className="text-xs text-muted-foreground/70">
          {isEn ? "Total asset value" : "Valor total de activos"}
        </div>
      </div>

      <div className="h-px bg-border/30" />

      {/* Section B: Portfolio Metrics */}
      <div className="grid grid-cols-3 gap-3 py-5">
        <div>
          <div className="font-bold text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            {isEn ? "Revenue MTD" : "Ingresos Mes"}
          </div>
          <div className="mt-1 font-semibold text-sm text-foreground">
            {formatCompactCurrency(totalRevenueMtdPyg, "PYG", formatLocale)}
          </div>
        </div>
        <div>
          <div className="font-bold text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            {isEn ? "Occupancy" : "Ocupación"}
          </div>
          <div className={cn("mt-1 font-semibold text-sm", occupancyColor(occupancyRate))}>
            {Math.round(occupancyRate)}%
          </div>
        </div>
        <div>
          <div className="font-bold text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            {isEn ? "Avg. Rent" : "Alq. Prom."}
          </div>
          <div className="mt-1 font-semibold text-sm text-foreground">
            {formatCompactCurrency(avgRentPyg, "PYG", formatLocale)}
          </div>
        </div>
      </div>

      {/* Section C: Agent Insights */}
      {hasAlerts && (
        <>
          <div className="h-px bg-border/30" />

          <div className="space-y-3 py-5">
            <h3 className="font-bold text-[11px] text-muted-foreground/70 uppercase tracking-widest">
              {isEn ? "Agent Insights" : "Perspectivas del Agente"}
            </h3>

            {totalOverdueCollections > 0 && (
              <div className="glass-inner attention-glow rounded-xl p-3.5 space-y-2">
                <div className="flex items-start gap-2.5">
                  <Icon
                    className="mt-0.5 shrink-0 text-[var(--agentic-rose-gold)]"
                    icon={Invoice03Icon}
                    size={15}
                  />
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-xs font-medium text-foreground leading-snug">
                      {isEn
                        ? `I found ${totalOverdueCollections} overdue collections. I can draft follow-up reminders.`
                        : `Encontré ${totalOverdueCollections} cobros vencidos. Puedo redactar recordatorios.`}
                    </p>
                    <Link
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--agentic-rose-gold)] hover:underline"
                      href={orgId ? `/module/agent-playground?agent=collections` : "#"}
                    >
                      <Icon icon={SparklesIcon} size={10} />
                      {isEn ? "Let me handle it" : "Déjame gestionarlo"}
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {totalVacantUnits > 0 && (
              <div className="glass-inner attention-glow rounded-xl p-3.5 space-y-2">
                <div className="flex items-start gap-2.5">
                  <Icon
                    className="mt-0.5 shrink-0 text-[var(--agentic-rose-gold)]"
                    icon={Home01Icon}
                    size={15}
                  />
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-xs font-medium text-foreground leading-snug">
                      {isEn
                        ? `${totalVacantUnits} vacant units (~${formatCompactCurrency(vacancyCostPyg, "PYG", formatLocale)}/mo). I can adjust pricing and refresh the listing.`
                        : `${totalVacantUnits} unidades vacantes (~${formatCompactCurrency(vacancyCostPyg, "PYG", formatLocale)}/mes). Puedo ajustar precios y renovar el anuncio.`}
                    </p>
                    <Link
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--agentic-rose-gold)] hover:underline"
                      href={orgId ? `/module/agent-playground?agent=dynamic-pricing` : "#"}
                    >
                      <Icon icon={SparklesIcon} size={10} />
                      {isEn ? "Review strategy" : "Revisar estrategia"}
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Section D: Agent Work Log */}
      <div className="h-px bg-border/30" />

      <div className="space-y-3 py-5">
        <h3 className="font-bold text-[11px] text-muted-foreground/70 uppercase tracking-widest">
          {isEn ? "Work Log" : "Registro de Actividad"}
        </h3>

        {workLog.length === 0 ? (
          <div className="py-4 text-center">
            <Icon className="mx-auto mb-2.5 text-[var(--agentic-cyan)]/50" icon={AiVoiceGeneratorIcon} size={20} />
            <p className="text-xs text-muted-foreground italic leading-relaxed">
              {isEn
                ? "I'm monitoring your portfolio. I'll update you when I take action."
                : "Estoy monitoreando tu portafolio. Te avisaré cuando tome acción."}
            </p>
          </div>
        ) : (
          <motion.div
            animate="visible"
            className="space-y-2"
            initial="hidden"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.04 } },
            }}
          >
            {workLog.map((entry) => (
              <motion.div
                className={cn(
                  "glass-inner rounded-lg p-2.5 text-xs",
                  entry.type === "approval-pending" && "border-[var(--agentic-rose-gold-border)]"
                )}
                key={entry.id}
                variants={{
                  hidden: { opacity: 0, y: 6 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.25, ease: EASING },
                  },
                }}
              >
                <div className="flex items-start gap-2">
                  <Icon
                    className={cn(
                      "mt-0.5 shrink-0",
                      entry.type === "approval-pending"
                        ? "text-[var(--agentic-rose-gold)]"
                        : entry.type === "approval-executed"
                          ? "text-[var(--agentic-lavender)]"
                          : "text-muted-foreground/60"
                    )}
                    icon={
                      entry.type === "approval-pending"
                        ? SparklesIcon
                        : entry.type === "approval-executed"
                          ? SparklesIcon
                          : entry.id.startsWith("task")
                            ? Task01Icon
                            : entry.id.startsWith("collection")
                              ? Invoice03Icon
                              : InformationCircleIcon
                    }
                    size={13}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      "font-medium leading-snug",
                      entry.type === "approval-pending" && "text-[var(--agentic-rose-gold)]"
                    )}>
                      {entry.text}
                    </p>
                    <span className="text-[10px] text-muted-foreground/50">{entry.time}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Section E: Quick Actions */}
      {orgId && (
        <>
          <div className="h-px bg-border/30" />

          <div className="flex flex-wrap gap-2.5 pt-5">
            <Link
              className="glass-inner rounded-full px-3.5 py-2 text-[11px] font-semibold text-foreground transition-transform hover:-translate-y-0.5 hover:shadow-sm"
              href="/module/agent-playground?agent=portfolio-advisor"
            >
              <Icon className="mr-1.5 inline" icon={AiVoiceGeneratorIcon} size={11} />
              {isEn ? "Ask about vacancies" : "Preguntar vacantes"}
            </Link>
            <Link
              className="glass-inner rounded-full px-3.5 py-2 text-[11px] font-semibold text-foreground transition-transform hover:-translate-y-0.5 hover:shadow-sm"
              href="/module/agent-playground?agent=dynamic-pricing"
            >
              <Icon className="mr-1.5 inline" icon={DollarCircleIcon} size={11} />
              {isEn ? "Run pricing analysis" : "Análisis de precios"}
            </Link>
            <Link
              className="glass-inner rounded-full px-3.5 py-2 text-[11px] font-semibold text-foreground transition-transform hover:-translate-y-0.5 hover:shadow-sm"
              href="/module/agent-playground?agent=maintenance-coordinator"
            >
              <Icon className="mr-1.5 inline" icon={Task01Icon} size={11} />
              {isEn ? "Scan maintenance" : "Escanear mantenimiento"}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
