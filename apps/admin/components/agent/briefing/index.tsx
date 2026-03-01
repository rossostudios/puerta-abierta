"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Message, MessageContent } from "@/components/ui/message";
import { ActivityCard } from "./activity-card";
import { BriefingChips } from "./briefing-chips";
import { EASING, fmtPyg, getGreeting, type Stats } from "./helpers";
import { NeedsInputCard } from "./needs-input-card";
import { OnboardingCard } from "./onboarding-card";
import { ScheduleCard } from "./schedule-card";

export function MorningBriefing({
  stats,
  locale,
  firstName,
  onSend,
  disabled,
}: {
  stats: Stats;
  locale: string;
  firstName?: string;
  onSend: (message: string) => void;
  disabled?: boolean;
}) {
  const isEn = locale === "en-US";
  const greeting = getGreeting(isEn, firstName);

  // Derive onboarding state: use backend field if available, else infer from existing stats
  const onb = stats.onboarding ?? {
    has_properties: (stats.total_properties ?? 0) > 0,
    has_integrations: false,
    has_tenants_or_guests:
      (stats.occupied_units ?? 0) > 0 || (stats.in_house ?? 0) > 0,
    has_ai_config: false,
  };
  const setupComplete =
    onb.has_properties &&
    onb.has_integrations &&
    onb.has_tenants_or_guests &&
    onb.has_ai_config;
  const showOnboarding = !setupComplete;

  const hasSchedule =
    (stats.todays_arrivals?.length ?? 0) +
      (stats.todays_departures?.length ?? 0) +
      (stats.todays_tasks?.length ?? 0) >
    0;

  const hasActivity = (stats.recent_activity ?? []).some(
    (a) => a.status !== "pending"
  );

  const attentionCount =
    (stats.maintenance_items?.length ?? 0) +
    (stats.lease_renewals?.length ?? 0) +
    ((stats.statements_ready?.count ?? 0) > 0 ? 1 : 0) +
    (stats.recent_activity ?? []).filter((a) => a.status === "pending").length;

  const hasAttentionItems = attentionCount > 0;

  const greetingSummary = buildGreetingSummary(stats, isEn, attentionCount);

  return (
    <div className="space-y-5">
      {/* STOA greeting message */}
      <Message className="items-start py-3" from="assistant">
        <MessageContent variant="flat">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="space-y-1"
            initial={{ opacity: 0, y: 6 }}
            transition={{ delay: 0.05, duration: 0.35, ease: EASING }}
          >
            <p className="font-light font-sans text-foreground text-lg tracking-tight">
              {greeting}
            </p>
            <p className="text-muted-foreground/70 text-sm">
              {greetingSummary}
            </p>
          </motion.div>
        </MessageContent>
      </Message>

      {/* Cards */}
      <div className="space-y-4">
        {showOnboarding && onb && (
          <OnboardingCard
            disabled={disabled}
            onboarding={onb}
            onSend={onSend}
          />
        )}

        {hasAttentionItems && (
          <NeedsInputCard
            disabled={disabled}
            isEn={isEn}
            onSend={onSend}
            stats={stats}
          />
        )}

        {hasSchedule && <ScheduleCard isEn={isEn} stats={stats} />}

        {hasActivity && <ActivityCard isEn={isEn} stats={stats} />}

        {showOnboarding && (
          <div className="flex items-center gap-3 py-2">
            <div className="h-px flex-1 bg-muted-foreground/10" />
            <span className="font-medium text-[10px] text-muted-foreground/40 uppercase tracking-widest">
              {isEn ? "Or just ask me anything" : "O simplemente pregúntame"}
            </span>
            <div className="h-px flex-1 bg-muted-foreground/10" />
          </div>
        )}

        <BriefingChips disabled={disabled} isEn={isEn} onSend={onSend} />
      </div>
    </div>
  );
}

function buildGreetingSummary(
  stats: Stats,
  isEn: boolean,
  attentionCount: number
): ReactNode {
  const parts: ReactNode[] = [];
  const revenueMtd = stats.revenue_mtd ?? 0;
  const occupancy = stats.blended_occupancy ?? 0;
  const arrivalsToday = stats.arrivals_today ?? 0;
  const totalProperties = stats.total_properties ?? 0;
  const totalUnits = stats.total_units ?? 0;

  if (isEn) {
    if (revenueMtd > 0) {
      parts.push(
        <span key="perf">
          Your portfolio is performing well &mdash;{" "}
          <strong>{fmtPyg(revenueMtd)} revenue</strong> this month with{" "}
          <strong>{occupancy}% occupancy</strong>.
        </span>
      );
    } else if (totalProperties > 0) {
      parts.push(
        <span key="portfolio">
          You have{" "}
          <strong>
            {totalProperties} propert{totalProperties !== 1 ? "ies" : "y"}
          </strong>{" "}
          and{" "}
          <strong>
            {totalUnits} unit{totalUnits !== 1 ? "s" : ""}
          </strong>{" "}
          set up.
        </span>
      );
    }
    if (attentionCount > 0) {
      parts.push(
        <span key="attn">
          {" "}
          You have{" "}
          <strong>
            {attentionCount} item{attentionCount !== 1 ? "s" : ""}
          </strong>{" "}
          that need{attentionCount === 1 ? "s" : ""} your attention.
        </span>
      );
    }
    if (arrivalsToday > 0) {
      parts.push(
        <span key="arr">
          {" "}
          {arrivalsToday} check-in{arrivalsToday !== 1 ? "s" : ""} scheduled
          today.
        </span>
      );
    }
    if (parts.length === 0) {
      return "I'm ready to help you manage your properties. Ask me anything or follow the setup steps below.";
    }
  } else {
    if (revenueMtd > 0) {
      parts.push(
        <span key="perf">
          Tu portafolio va bien &mdash;{" "}
          <strong>{fmtPyg(revenueMtd)} de ingresos</strong> este mes con{" "}
          <strong>{occupancy}% de ocupaci&oacute;n</strong>.
        </span>
      );
    } else if (totalProperties > 0) {
      parts.push(
        <span key="portfolio">
          Tienes{" "}
          <strong>
            {totalProperties} propiedad{totalProperties !== 1 ? "es" : ""}
          </strong>{" "}
          y{" "}
          <strong>
            {totalUnits} unidad{totalUnits !== 1 ? "es" : ""}
          </strong>{" "}
          configurada{totalUnits !== 1 ? "s" : ""}.
        </span>
      );
    }
    if (attentionCount > 0) {
      parts.push(
        <span key="attn">
          {" "}
          Tienes{" "}
          <strong>
            {attentionCount} elemento{attentionCount !== 1 ? "s" : ""}
          </strong>{" "}
          que requiere{attentionCount !== 1 ? "n" : ""} tu atenci&oacute;n.
        </span>
      );
    }
    if (arrivalsToday > 0) {
      parts.push(
        <span key="arr">
          {" "}
          {arrivalsToday} check-in{arrivalsToday !== 1 ? "s" : ""} programado
          {arrivalsToday !== 1 ? "s" : ""} hoy.
        </span>
      );
    }
    if (parts.length === 0) {
      return "Estoy listo para ayudarte a administrar tus propiedades. Pregúntame lo que necesites o sigue los pasos de configuración.";
    }
  }

  return <>{parts}</>;
}
