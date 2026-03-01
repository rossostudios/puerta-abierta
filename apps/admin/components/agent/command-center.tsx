"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  ArrowUp02Icon,
  Building01Icon,
  Calendar02Icon,
  CheckmarkCircle02Icon,
  ChartLineData02Icon,
  Clock01Icon,
  Globe02Icon,
  InformationCircleIcon,
  Money01Icon,
  PlusSignIcon,
  Settings02Icon,
  SparklesIcon,
  Tick01Icon,
  UserGroupIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Sheet } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type AgentStatus,
  type ArrivalDeparture,
  type Stats,
  CARD,
  EASING,
  SectionLabel,
  TrendBadge,
  fmtPyg,
  getGreeting,
  relativeTime,
  statusTone,
} from "./briefing/helpers";

export type CommandCenterProps = {
  initialStats: Record<string, unknown>;
  locale: string;
  firstName?: string;
  embedded?: boolean;
  onSend?: (message: string) => void;
  orgId?: string;
};

/* ── Agent network ── */
const AGENTS = [
  { slug: "guest-concierge", label: "Guest Concierge", icon: UserGroupIcon, color: "var(--agentic-lavender)", angle: 234 },
  { slug: "maintenance", label: "Maintenance", icon: Wrench01Icon, color: "var(--agentic-cyan)", angle: 306 },
  { slug: "finance", label: "Finance", icon: Money01Icon, color: "var(--agentic-rose-gold)", angle: 18 },
  { slug: "leasing", label: "Leasing", icon: ChartLineData02Icon, color: "var(--chart-2)", angle: 90 },
  { slug: "supervisor", label: "Supervisor", icon: Settings02Icon, color: "var(--chart-4)", angle: 162 },
] as const;

/* ── Prompt chip suggestions ── */
const PROMPT_CHIPS_EN = [
  "Show today's arrivals",
  "Summarize open maintenance tickets",
  "Draft a welcome message",
  "Generate owner statement",
];
const PROMPT_CHIPS_ES = [
  "Mostrar llegadas de hoy",
  "Resumir tickets de mantenimiento",
  "Redactar mensaje de bienvenida",
  "Generar estado de cuenta",
];

/* ── Onboarding steps ── */
const ONBOARDING_EN = [
  { label: "Add your first property", href: "/app/properties?new=1", icon: Building01Icon },
  { label: "Invite team members", href: "/module/settings/team", icon: UserGroupIcon },
  { label: "Connect your booking channels", href: "/module/integrations", icon: Globe02Icon },
];
const ONBOARDING_ES = [
  { label: "Agrega tu primera propiedad", href: "/app/properties?new=1", icon: Building01Icon },
  { label: "Invita a tu equipo", href: "/module/settings/team", icon: UserGroupIcon },
  { label: "Conecta tus canales de reserva", href: "/module/integrations", icon: Globe02Icon },
];

/* ── Spotlight Input with Prompt Chips ── */

function SpotlightInput({
  isEn,
  onSend,
}: {
  isEn: boolean;
  onSend: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const chips = isEn ? PROMPT_CHIPS_EN : PROMPT_CHIPS_ES;

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <div className="space-y-2.5">
      <div
        className={cn(
          CARD,
          "flex items-center gap-3 px-5 py-3 transition-all focus-within:ring-2 focus-within:ring-ring/30"
        )}
      >
        <Icon className="shrink-0 text-muted-foreground/60" icon={SparklesIcon} size={18} />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={
            isEn
              ? "What would you like Casaora AI to handle today?"
              : "¿Qué te gustaría que Casaora IA maneje hoy?"
          }
          ref={inputRef}
          type="text"
          value={value}
        />
        <Button
          className="h-8 w-8 shrink-0 rounded-lg"
          disabled={!value.trim()}
          onClick={handleSubmit}
          size="icon-xs"
        >
          <Icon icon={ArrowUp02Icon} size={16} />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            className="rounded-full glass-inner px-3 py-1.5 text-xs text-muted-foreground/70 transition-all hover:text-foreground hover:shadow-sm"
            key={chip}
            onClick={() => onSend(chip)}
            type="button"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Info tooltip ── */
function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="ml-1 inline-flex align-middle text-muted-foreground/40 transition-colors hover:text-muted-foreground/70"
          type="button"
        >
          <Icon icon={InformationCircleIcon} size={13} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px]" side="top" sideOffset={6}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/* ── Big metric (enhanced) ── */
function BigMetric({
  label,
  value,
  accent,
  tooltip,
  trend,
}: {
  label: string;
  value: string | number;
  accent?: string;
  tooltip?: string;
  trend?: { current: number; previous: number | undefined; suffix?: string };
}) {
  return (
    <div>
      <div className="flex items-baseline">
        <p
          className="font-bold text-2xl tabular-nums leading-none"
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </p>
        {trend && (
          <TrendBadge
            current={trend.current}
            previous={trend.previous}
            suffix={trend.suffix}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {label}
        {tooltip && <InfoTip text={tooltip} />}
      </p>
    </div>
  );
}

/* ── Guest mini-list for front desk ── */
function GuestMiniList({
  items,
  timeKey,
  isEn,
}: {
  items: ArrivalDeparture[];
  timeKey: "check_in_time" | "check_out_time";
  isEn: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1 space-y-1.5">
      {items.slice(0, 3).map((item, i) => (
        <div
          className="flex items-center gap-2 rounded-lg glass-inner px-2.5 py-1.5"
          key={`${item.unit_code}-${i}`}
        >
          <Badge className="shrink-0 font-mono text-[10px]" variant="secondary">
            {item.unit_code}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
            {item.guest_name}
          </span>
          {item[timeKey] && (
            <span className="shrink-0 flex items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground">
              <Icon icon={Clock01Icon} size={10} />
              {item[timeKey]}
            </span>
          )}
        </div>
      ))}
      {items.length > 3 && (
        <p className="text-center text-[10px] text-muted-foreground/50">
          {isEn ? `+${items.length - 3} more` : `+${items.length - 3} más`}
        </p>
      )}
    </div>
  );
}

/* ── Onboarding checklist (empty state) ── */
function OnboardingChecklist({ isEn }: { isEn: boolean }) {
  const steps = isEn ? ONBOARDING_EN : ONBOARDING_ES;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-3">
      {steps.map((step, i) => (
        <Link
          className={cn(
            CARD,
            "group flex flex-col items-center gap-4 p-6 text-center transition-all hover:shadow-md"
          )}
          href={step.href}
          key={step.href}
        >
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="flex h-14 w-14 items-center justify-center rounded-2xl glass-inner shadow-sm transition-transform group-hover:scale-105"
            initial={{ opacity: 0, y: 8 }}
            transition={{ delay: 0.1 + i * 0.08, duration: 0.35, ease: EASING }}
          >
            <Icon className="text-foreground/70" icon={step.icon} size={24} />
          </motion.div>
          <div className="space-y-1">
            <p className="font-medium text-sm text-foreground/80">{step.label}</p>
            <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground/50">
              <Icon icon={PlusSignIcon} size={12} />
              {isEn ? "Get started" : "Comenzar"}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ── Component ── */

export function CommandCenter({
  initialStats,
  locale,
  firstName,
  embedded,
  onSend,
  orgId,
}: CommandCenterProps) {
  const isEn = locale === "en-US";
  const stats = initialStats as unknown as Stats;

  const agents = stats.agents ?? { total: 0, active: 0 };
  const approvals = stats.approvals_24h ?? {};
  const recentActivity = stats.recent_activity ?? [];
  const agentStatuses = stats.agent_statuses ?? [];
  const totalProperties = stats.total_properties ?? 0;
  const totalUnits = stats.total_units ?? 0;
  const occupancy = stats.blended_occupancy ?? 0;
  const revenueMtd = stats.revenue_mtd ?? 0;
  const prevOccupancy = stats.prev_month_occupancy;
  const prevRevenue = stats.prev_month_revenue;
  const arrivals = stats.arrivals_today ?? 0;
  const departures = stats.departures_today ?? 0;
  const inHouse = stats.in_house ?? 0;
  const todaysArrivals = stats.todays_arrivals ?? [];
  const todaysDepartures = stats.todays_departures ?? [];
  const openTickets = stats.open_tickets ?? 0;
  const dispatched = stats.dispatched ?? 0;
  const avgResolution = stats.avg_resolution_hrs ?? 0;

  const pendingApprovals = recentActivity
    .filter((a) => a.status === "pending")
    .slice(0, 4);

  /* Agent status map for network visualization */
  const statusMap = useMemo(() => {
    const m = new Map<string, AgentStatus>();
    for (const s of agentStatuses) m.set(s.slug, s);
    return m;
  }, [agentStatuses]);

  /* Agent detail sheet state */
  const [selectedAgentSlug, setSelectedAgentSlug] = useState<string | null>(null);
  const selectedAgentData = AGENTS.find((a) => a.slug === selectedAgentSlug);
  const selectedAgentStatus = selectedAgentSlug ? statusMap.get(selectedAgentSlug) : undefined;
  const selectedAgentActivity = recentActivity.filter((a) => a.agent_slug === selectedAgentSlug);

  /* ── AI Briefing ── */
  function buildBriefing(): string {
    const parts: string[] = [];
    if (isEn) {
      if (arrivals > 0)
        parts.push(`You have ${arrivals} check-in${arrivals !== 1 ? "s" : ""} today — your concierge agent is ready.`);
      if (openTickets > 0)
        parts.push(`There ${openTickets === 1 ? "is" : "are"} ${openTickets} open maintenance ticket${openTickets !== 1 ? "s" : ""}${dispatched > 0 ? `, ${dispatched} dispatched` : ""}.`);
      if (pendingApprovals.length > 0)
        parts.push(`${pendingApprovals.length} agent action${pendingApprovals.length !== 1 ? "s" : ""} need${pendingApprovals.length === 1 ? "s" : ""} your review.`);
      if (parts.length === 0)
        parts.push("All systems quiet — a great time to review your portfolio.");
    } else {
      if (arrivals > 0)
        parts.push(`Tienes ${arrivals} check-in${arrivals !== 1 ? "s" : ""} hoy — tu agente concierge está listo.`);
      if (openTickets > 0)
        parts.push(`Hay ${openTickets} ticket${openTickets !== 1 ? "s" : ""} de mantenimiento abierto${openTickets !== 1 ? "s" : ""}${dispatched > 0 ? `, ${dispatched} despachado${dispatched !== 1 ? "s" : ""}` : ""}.`);
      if (pendingApprovals.length > 0)
        parts.push(`${pendingApprovals.length} acción${pendingApprovals.length !== 1 ? "es" : ""} de agente requiere${pendingApprovals.length !== 1 ? "n" : ""} tu revisión.`);
      if (parts.length === 0)
        parts.push("Todo en calma — buen momento para revisar tu portafolio.");
    }
    return parts.join(" ");
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-5">
      {/* ── AI Briefing Hero ── */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 animate-[fadeIn_0.3s_ease-out_both]">
          <span className="inline-flex items-center gap-1.5 rounded-full glass-inner px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {isEn ? "AI Briefing" : "Informe IA"}
          </span>
        </div>
        <h1 className="animate-[fadeInUp_0.5s_ease-out_both] font-sans text-3xl font-light tracking-tight text-foreground">
          {getGreeting(isEn, firstName)}
        </h1>
        <p className="animate-[fadeInUp_0.5s_ease-out_both] text-sm text-muted-foreground/70 [animation-delay:60ms]">
          {buildBriefing()}
        </p>
      </div>

      {/* ── Spotlight ── */}
      {embedded && onSend ? (
        <SpotlightInput isEn={isEn} onSend={onSend} />
      ) : !embedded ? (
        <div className="space-y-2.5">
          <Link
            className={cn(
              CARD,
              "flex items-center gap-3 px-5 py-3.5 transition-all hover:shadow-md"
            )}
            href="/app/agents?new=1"
          >
            <Icon className="text-muted-foreground/60" icon={SparklesIcon} size={18} />
            <span className="flex-1 text-sm text-muted-foreground/60">
              {isEn ? "Ask your AI agents anything..." : "Pregúntale a tus agentes IA..."}
            </span>
            <kbd className="hidden rounded-md border border-border/50 bg-muted/30 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground/50 sm:inline-block">
              /
            </kbd>
          </Link>
          {/* Non-embedded prompt chips (navigate to chat) */}
          <div className="flex flex-wrap gap-2">
            {(isEn ? PROMPT_CHIPS_EN : PROMPT_CHIPS_ES).map((chip) => (
              <Link
                className="rounded-full glass-inner px-3 py-1.5 text-xs text-muted-foreground/70 transition-all hover:text-foreground hover:shadow-sm"
                href={`/app/agents?new=1&q=${encodeURIComponent(chip)}`}
                key={chip}
              >
                {chip}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Bento Grid ── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-[auto_auto_auto]">

        {/* ── Onboarding banner (shown when no properties/units yet) ── */}
        {totalUnits === 0 && totalProperties === 0 && (
          <div className={cn(CARD, "flex items-center gap-4 p-5 lg:col-span-4")}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl glass-inner">
              <Icon className="text-muted-foreground/60" icon={Building01Icon} size={20} />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm text-foreground/80">
                {isEn ? "Your portfolio is empty — let's set it up!" : "Tu portafolio está vacío — ¡vamos a configurarlo!"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground/50">
                {isEn ? "Add properties, invite your team, and connect channels." : "Agrega propiedades, invita a tu equipo y conecta canales."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(isEn ? ONBOARDING_EN : ONBOARDING_ES).map((step) => (
                <Link
                  className="inline-flex items-center gap-1.5 rounded-full glass-inner px-3 py-1.5 text-xs font-medium text-foreground/80 transition-all hover:shadow-sm"
                  href={step.href}
                  key={step.href}
                >
                  <Icon icon={step.icon} size={13} />
                  {step.label}
                </Link>
              ))}
            </div>
          </div>
        )}
          {/* ═══ ROW 1 — Daily Operations ═══ */}

          {/* ── Front Desk ── */}
          <div className={cn(CARD, "flex flex-col gap-4 p-5 lg:col-span-2")}>
            <div className="flex items-center gap-2">
              <Icon className="text-muted-foreground/50" icon={Calendar02Icon} size={14} />
              <SectionLabel>
                {isEn ? "Front Desk" : "Recepción"}
              </SectionLabel>
            </div>
            {arrivals === 0 && departures === 0 && inHouse === 0 ? (
              <div className="flex flex-1 items-center gap-3 rounded-xl glass-inner px-4 py-3">
                <Icon className="shrink-0 text-muted-foreground/30" icon={Calendar02Icon} size={20} />
                <p className="text-sm text-muted-foreground/50">
                  {isEn ? "No guest movement today — your front desk is clear." : "Sin movimiento de huéspedes hoy — tu recepción está libre."}
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <BigMetric
                  accent="var(--agentic-cyan)"
                  label={isEn ? "Arrivals" : "Llegadas"}
                  value={arrivals}
                />
                <GuestMiniList isEn={isEn} items={todaysArrivals} timeKey="check_in_time" />
              </div>
              <div>
                <BigMetric
                  label={isEn ? "Departures" : "Salidas"}
                  value={departures}
                />
                <GuestMiniList isEn={isEn} items={todaysDepartures} timeKey="check_out_time" />
              </div>
              <BigMetric
                accent="var(--agentic-lavender)"
                label={isEn ? "In-House" : "Hospedados"}
                value={inHouse}
              />
            </div>
          </div>

          {/* ── Maintenance Hub ── */}
          <div className={cn(CARD, "flex flex-col gap-4 p-5 lg:col-span-2")}>
            <div className="flex items-center gap-2">
              <Icon className="text-muted-foreground/50" icon={Wrench01Icon} size={14} />
              <SectionLabel>
                {isEn ? "Maintenance Hub" : "Mantenimiento"}
              </SectionLabel>
            </div>
            {openTickets === 0 ? (
              <div className="flex items-center gap-3 rounded-xl glass-inner px-4 py-3">
                <Icon className="shrink-0 text-emerald-500/60" icon={CheckmarkCircle02Icon} size={20} />
                <p className="text-sm text-muted-foreground/50">
                  {isEn ? "Zero open tickets — your properties are in great shape!" : "Cero tickets abiertos — ¡tus propiedades están en excelente estado!"}
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-4">
              <BigMetric
                accent="var(--agentic-rose-gold)"
                label={isEn ? "Open Tickets" : "Tickets Abiertos"}
                value={openTickets}
              />
              <BigMetric
                accent="var(--agentic-cyan)"
                label={isEn ? "Dispatched" : "Despachados"}
                value={dispatched}
              />
              <BigMetric
                label={isEn ? "Avg Resolution" : "Resolución Prom."}
                tooltip={
                  isEn
                    ? "Average hours to resolve maintenance requests over the last 30 days."
                    : "Horas promedio para resolver solicitudes de mantenimiento en los últimos 30 días."
                }
                value={avgResolution > 0 ? `${avgResolution}h` : "—"}
              />
            </div>
          </div>

          {/* ═══ ROW 2 — Overview ═══ */}

          {/* ── Portfolio Overview ── */}
          <div className={cn(CARD, "flex flex-col gap-4 p-5 lg:col-span-2")}>
            <SectionLabel>
              {isEn ? "Portfolio Overview" : "Resumen del Portafolio"}
            </SectionLabel>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <BigMetric
                label={isEn ? "Properties" : "Propiedades"}
                value={totalProperties}
              />
              <BigMetric
                label={isEn ? "Units" : "Unidades"}
                value={totalUnits}
              />
              <BigMetric
                accent="var(--agentic-lavender)"
                label={isEn ? "Occupancy" : "Ocupación"}
                tooltip={
                  isEn
                    ? "Percentage of active units currently occupied by a lease or checked-in reservation."
                    : "Porcentaje de unidades activas actualmente ocupadas por un contrato o reserva con check-in."
                }
                trend={{ current: occupancy, previous: prevOccupancy }}
                value={`${occupancy}%`}
              />
              <BigMetric
                accent="var(--agentic-rose-gold)"
                label={isEn ? "Revenue MTD" : "Ingresos del Mes"}
                tooltip={
                  isEn
                    ? "Total income this month from lease payments and completed reservations."
                    : "Ingreso total este mes por pagos de alquiler y reservas completadas."
                }
                trend={{
                  current: revenueMtd,
                  previous: prevRevenue,
                  suffix: "%",
                }}
                value={revenueMtd > 0 ? fmtPyg(revenueMtd) : "—"}
              />
            </div>
          </div>

          {/* ── Pending Approvals ── */}
          <div className={cn(CARD, "flex flex-col gap-3 p-5 lg:col-span-2")}>
            <div className="flex items-center gap-2">
              <Icon className="text-muted-foreground/50" icon={CheckmarkCircle02Icon} size={14} />
              <SectionLabel>
                {isEn ? "Pending Approvals" : "Aprobaciones"}
              </SectionLabel>
            </div>
            {pendingApprovals.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="flex items-center gap-3 text-center">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <div>
                    <p className="text-sm text-muted-foreground/50">
                      {isEn ? "All clear" : "Sin pendientes"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/40">
                      {isEn
                        ? "Your agents are operating autonomously"
                        : "Tus agentes operan de forma autónoma"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                {pendingApprovals.map((item, i) => (
                  <div
                    className="space-y-2 rounded-xl glass-inner p-4"
                    key={`approval-${item.tool_name}-${i}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-sm">
                        {item.tool_name.replace(/_/g, " ")}
                      </span>
                      {item.agent_slug && (
                        <Badge className="shrink-0 font-normal text-[11px]" variant="secondary">
                          {item.agent_slug}
                        </Badge>
                      )}
                    </div>
                    {item.reasoning && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {item.reasoning}
                      </p>
                    )}
                    <Button disabled size="xs" variant="outline">
                      <Icon icon={Tick01Icon} size={12} />
                      {isEn ? "Approve" : "Aprobar"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ═══ ROW 3 — System Monitoring ═══ */}

          {/* ── Agent Network (2-col) ── */}
          <div
            className={cn(
              CARD,
              "relative flex min-h-[220px] items-center justify-center overflow-hidden p-5 lg:col-span-2"
            )}
          >
            <SectionLabel>
              <span className="absolute top-5 left-5">
                {isEn ? "Agent Network" : "Red de Agentes"}
              </span>
            </SectionLabel>

            {/* SVG connecting lines */}
            <svg
              className="absolute inset-0 h-full w-full"
              preserveAspectRatio="xMidYMid meet"
              viewBox="0 0 400 280"
            >
              {AGENTS.map((a) => {
                const rad = (a.angle * Math.PI) / 180;
                const cx = 200 + Math.cos(rad) * 120;
                const cy = 140 + Math.sin(rad) * 100;
                return (
                  <line
                    className="animate-pulse stroke-foreground/[0.06]"
                    key={a.slug}
                    strokeDasharray="4 6"
                    strokeWidth={1}
                    x1={200}
                    x2={cx}
                    y1={140}
                    y2={cy}
                  />
                );
              })}
            </svg>

            {/* Center node */}
            <div className="absolute top-1/2 left-1/2 z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full glass-inner shadow-sm">
              <Icon className="text-foreground/80" icon={SparklesIcon} size={26} />
            </div>

            {/* Satellite agent nodes */}
            {AGENTS.map((a, i) => {
              const rad = (a.angle * Math.PI) / 180;
              const pctX = 50 + Math.cos(rad) * 30;
              const pctY = 50 + Math.sin(rad) * 35;
              const agentStatus = statusMap.get(a.slug)?.status ?? "idle";
              return (
                <motion.div
                  animate="visible"
                  className="absolute z-10 flex flex-col items-center gap-1.5"
                  initial="hidden"
                  key={a.slug}
                  style={{ left: `${pctX}%`, top: `${pctY}%`, transform: "translate(-50%, -50%)" }}
                  variants={{
                    hidden: { opacity: 0, scale: 0.5 },
                    visible: {
                      opacity: 1,
                      scale: 1,
                      transition: { delay: 0.1 + i * 0.06, duration: 0.35, ease: EASING },
                    },
                  }}
                >
                  <button
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full glass-inner shadow-sm transition-transform hover:scale-110",
                      agentStatus === "active" && "ring-2 ring-emerald-400/60 animate-[ring-pulse_2s_ease-in-out_infinite]",
                      agentStatus === "error" && "ring-2 ring-rose-400/60 animate-[ring-pulse_3s_ease-in-out_infinite]",
                    )}
                    onClick={() => setSelectedAgentSlug(a.slug)}
                    style={{ borderColor: a.color }}
                    type="button"
                  >
                    <Icon icon={a.icon} size={20} style={{ color: a.color }} />
                  </button>
                  <button
                    className="text-[11px] font-medium text-muted-foreground/70 transition-colors hover:text-foreground"
                    onClick={() => setSelectedAgentSlug(a.slug)}
                    type="button"
                  >
                    {a.label}
                  </button>
                </motion.div>
              );
            })}

            {/* Agent count */}
            <div className="absolute right-5 bottom-4 flex items-center gap-2">
              <span className="font-semibold text-base tabular-nums text-foreground/80">
                {agents.active}/{agents.total}
              </span>
              <span className="text-xs text-muted-foreground">
                {isEn ? "active" : "activos"}
              </span>
            </div>
          </div>

          {/* ── Agent Task Queue (2-col) ── */}
          <div className={cn(CARD, "flex flex-col gap-3 p-5 lg:col-span-2")}>
            <SectionLabel>
              {isEn ? "Agent Task Queue" : "Cola de Tareas"}
            </SectionLabel>
            {recentActivity.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-center">
                  <Icon className="text-muted-foreground/25" icon={SparklesIcon} size={24} />
                  <p className="text-sm text-muted-foreground/50">
                    {isEn ? "No agent activity yet" : "Sin actividad de agentes aún"}
                  </p>
                  <p className="text-xs text-muted-foreground/40">
                    {isEn
                      ? "Ask your AI to handle something!"
                      : "¡Pídele a tu IA que haga algo!"}
                  </p>
                  {!embedded && (
                    <Link
                      className="mt-1 inline-flex items-center gap-1 rounded-full glass-inner px-3 py-1.5 text-xs text-muted-foreground/60 transition-all hover:text-foreground hover:shadow-sm"
                      href="/app/agents?new=1"
                    >
                      <Icon icon={SparklesIcon} size={12} />
                      {isEn ? "Open AI chat" : "Abrir chat IA"}
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 space-y-2">
                {recentActivity.slice(0, 6).map((item, i) => {
                  const agentDef = AGENTS.find((a) => a.slug === item.agent_slug);
                  return (
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-3 rounded-xl glass-inner px-3.5 py-2.5 transition-colors hover:bg-foreground/[0.02]"
                      initial={{ opacity: 0, y: 6 }}
                      key={`${item.tool_name}-${item.created_at}-${i}`}
                      transition={{ delay: i * 0.04, duration: 0.3, ease: EASING }}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: agentDef?.color ?? "var(--muted-foreground)" }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-sm">
                            {item.tool_name.replace(/_/g, " ")}
                          </span>
                          {item.agent_slug && (
                            <Badge className="shrink-0 font-normal text-[10px]" variant="secondary">
                              {item.agent_slug}
                            </Badge>
                          )}
                        </div>
                        {item.property_name && (
                          <p className="truncate text-[11px] text-muted-foreground/50">
                            {item.property_name}
                          </p>
                        )}
                      </div>
                      <Badge
                        className={cn("shrink-0 text-[10px]", statusTone(item.status))}
                        variant="outline"
                      >
                        {item.status}
                      </Badge>
                      <span className="shrink-0 text-[11px] text-muted-foreground/50 tabular-nums">
                        {relativeTime(item.created_at)}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
      </div>

      {/* ── Agent Detail Sheet ── */}
      <Sheet
        onOpenChange={(open) => { if (!open) setSelectedAgentSlug(null); }}
        open={!!selectedAgentSlug}
        title={
          selectedAgentData ? (
            <span className="flex items-center gap-2">
              <Icon icon={selectedAgentData.icon} size={18} style={{ color: selectedAgentData.color }} />
              {selectedAgentData.label}
            </span>
          ) : undefined
        }
        description={
          selectedAgentStatus
            ? isEn
              ? `Status: ${selectedAgentStatus.status}${selectedAgentStatus.last_active_at ? ` · Last active ${relativeTime(selectedAgentStatus.last_active_at)}` : ""}`
              : `Estado: ${selectedAgentStatus.status}${selectedAgentStatus.last_active_at ? ` · Última actividad ${relativeTime(selectedAgentStatus.last_active_at)}` : ""}`
            : isEn ? "Status: idle" : "Estado: inactivo"
        }
        footer={
          <Link href="/module/agent-dashboard">
            <Button className="w-full" variant="outline">
              {isEn ? "View Full Analytics" : "Ver Analíticas Completas"}
            </Button>
          </Link>
        }
      >
        <div className="space-y-5">
          {/* Status badge */}
          <div className="flex items-center gap-3">
            <Badge
              className={cn(
                "text-xs",
                selectedAgentStatus?.status === "active" && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                selectedAgentStatus?.status === "error" && "bg-rose-500/10 text-rose-600 border-rose-500/20",
              )}
              variant="outline"
            >
              {selectedAgentStatus?.status ?? "idle"}
            </Badge>
            {selectedAgentStatus?.last_active_at && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Icon icon={Clock01Icon} size={12} />
                {relativeTime(selectedAgentStatus.last_active_at)}
              </span>
            )}
          </div>

          {/* Recent activity for this agent */}
          <div>
            <SectionLabel>
              {isEn ? "Recent Activity" : "Actividad Reciente"}
            </SectionLabel>
            {selectedAgentActivity.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground/50">
                {isEn ? "No recent activity for this agent." : "Sin actividad reciente para este agente."}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {selectedAgentActivity.slice(0, 8).map((item, i) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-lg glass-inner px-3 py-2"
                    key={`sheet-${item.tool_name}-${i}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">
                        {item.tool_name.replace(/_/g, " ")}
                      </p>
                      {item.reasoning && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/60">
                          {item.reasoning}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        className={cn("text-[10px]", statusTone(item.status))}
                        variant="outline"
                      >
                        {item.status}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground/50 tabular-nums">
                        {relativeTime(item.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
