"use client";

import {
  AlertCircleIcon,
  ArrowRight01Icon,
  Calendar03Icon,
  ChartLineData02Icon,
  SparklesIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

function getGreeting(isEn: boolean, firstName: string): string {
  const hour = new Date().getHours();
  if (hour < 12)
    return isEn ? `Good morning, ${firstName}` : `Buenos días, ${firstName}`;
  if (hour < 17)
    return isEn
      ? `Good afternoon, ${firstName}`
      : `Buenas tardes, ${firstName}`;
  return isEn ? `Good evening, ${firstName}` : `Buenas noches, ${firstName}`;
}

// -- Category metadata for quick prompt icons/colors --------------------------

type PromptCategory = "maintenance" | "guests" | "finance" | "general";

const CATEGORY_META: Record<
  PromptCategory,
  { icon: IconSvgElement; color: string }
> = {
  maintenance: {
    icon: Wrench01Icon,
    color: "text-amber-500/70",
  },
  guests: {
    icon: Calendar03Icon,
    color: "text-blue-500/70",
  },
  finance: {
    icon: ChartLineData02Icon,
    color: "text-emerald-500/70",
  },
  general: {
    icon: SparklesIcon,
    color: "text-[var(--sidebar-primary)]/60",
  },
};

function classifyPrompt(prompt: string): PromptCategory {
  const lower = prompt.toLowerCase();
  if (
    lower.includes("maintenan") ||
    lower.includes("repair") ||
    lower.includes("fix") ||
    lower.includes("mantenimi") ||
    lower.includes("reparaci")
  )
    return "maintenance";
  if (
    lower.includes("guest") ||
    lower.includes("check-in") ||
    lower.includes("checkin") ||
    lower.includes("arriving") ||
    lower.includes("huésped") ||
    lower.includes("llegan")
  )
    return "guests";
  if (
    lower.includes("revenue") ||
    lower.includes("financ") ||
    lower.includes("payment") ||
    lower.includes("income") ||
    lower.includes("ingreso") ||
    lower.includes("pago") ||
    lower.includes("cobr")
  )
    return "finance";
  return "general";
}

// -- Daily summary type -------------------------------------------------------

export type DailySummaryItem = {
  label: string;
  count: number;
  urgent?: boolean;
};

// -- Component ----------------------------------------------------------------

export function ChatEmptyState({
  quickPrompts,
  contextualSuggestions,
  onSendPrompt,
  isEn,
  disabled,
  agentName,
  agentDescription: _agentDescription,
  firstName,
  dailySummary,
}: {
  quickPrompts: string[];
  contextualSuggestions?: string[];
  onSendPrompt: (prompt: string) => void;
  isEn: boolean;
  disabled?: boolean;
  agentName?: string;
  agentDescription?: string;
  firstName?: string;
  dailySummary?: DailySummaryItem[];
}) {
  const hasUrgent = dailySummary?.some((item) => item.urgent && item.count > 0);

  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center px-4 pb-8">
      {/* Greeting + Agent identity */}
      <div className="relative mb-8 flex flex-col items-center gap-3">
        {firstName ? (
          <h1 className="animate-[fadeInUp_0.5s_ease-out_both] font-sans text-3xl text-foreground/90 tracking-tight">
            {getGreeting(isEn, firstName)}
          </h1>
        ) : null}

        {/* Agent identity badge */}
        <div
          className="flex animate-[fadeInUp_0.5s_ease-out_both] items-center gap-2"
          style={{ animationDelay: "60ms" }}
        >
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-casaora-gradient">
            <Icon
              className="h-3 w-3 text-white"
              icon={SparklesIcon}
              strokeWidth={2}
            />
          </div>
          <span className="font-medium text-[13px] text-muted-foreground/70">
            {agentName || "Casaora AI"}
          </span>
        </div>
      </div>

      {/* Daily summary briefing */}
      {dailySummary && dailySummary.length > 0 ? (
        <div
          className="mb-8 w-full max-w-xl animate-[fadeInUp_0.4s_ease-out_both]"
          style={{ animationDelay: "120ms" }}
        >
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border px-4 py-3",
              hasUrgent
                ? "border-amber-500/20 bg-amber-500/[0.04]"
                : "border-border/40 bg-muted/30"
            )}
          >
            {hasUrgent ? (
              <Icon
                className="h-4 w-4 shrink-0 text-amber-500/80"
                icon={AlertCircleIcon}
              />
            ) : null}
            <p className="text-[13px] text-foreground/70 leading-relaxed">
              {dailySummary
                .filter((item) => item.count > 0)
                .map((item, i, arr) => (
                  <span key={item.label}>
                    <span
                      className={cn(
                        "font-medium",
                        item.urgent
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-foreground/90"
                      )}
                    >
                      {item.count} {item.label}
                    </span>
                    {i < arr.length - 1 ? (
                      <span className="text-muted-foreground/40">
                        {" "}
                        &middot;{" "}
                      </span>
                    ) : null}
                  </span>
                ))}
            </p>
          </div>
        </div>
      ) : null}

      {/* Contextual suggestions (dynamic, portfolio-aware) */}
      {contextualSuggestions && contextualSuggestions.length > 0 ? (
        <div className="relative flex w-full max-w-xl flex-col items-center gap-2.5">
          <p
            className="mb-1 flex animate-[fadeInUp_0.5s_ease-out_both] items-center gap-1.5 font-medium text-[11px] text-muted-foreground/60 uppercase tracking-widest"
            style={{ animationDelay: "200ms" }}
          >
            <Icon
              className="h-3 w-3 text-[var(--sidebar-primary)]/60"
              icon={SparklesIcon}
            />
            {isEn ? "Suggested for you" : "Sugerido para ti"}
          </p>
          <div className="flex w-full flex-col gap-2">
            {contextualSuggestions.slice(0, 3).map((prompt, i) => (
              <button
                className={cn(
                  "group glass-liquid relative w-full cursor-pointer rounded-xl border-l-2 border-l-[var(--sidebar-primary)]/30 px-4 py-3.5 text-left text-[13px] text-foreground/80 leading-snug",
                  "transition-all duration-200 ease-out",
                  "hover:border-[var(--sidebar-primary)]/20 hover:border-l-[var(--sidebar-primary)]/50 hover:bg-[var(--sidebar-primary)]/[0.06] hover:text-foreground hover:shadow-sm",
                  "active:scale-[0.99]",
                  "disabled:pointer-events-none disabled:opacity-40",
                  "animate-[fadeInUp_0.4s_ease-out_both]"
                )}
                disabled={disabled}
                key={prompt}
                onClick={() => onSendPrompt(prompt)}
                style={{ animationDelay: `${i * 80 + 260}ms` }}
                type="button"
              >
                <span className="relative flex items-center justify-between gap-3">
                  <span>{prompt}</span>
                  <Icon
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--sidebar-primary)]/60"
                    icon={ArrowRight01Icon}
                  />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Categorized quick prompts */}
      {quickPrompts.length > 0 ? (
        <div className="relative mt-5 flex w-full max-w-xl flex-col items-center gap-2.5">
          <p
            className="mb-1 animate-[fadeInUp_0.5s_ease-out_both] font-medium text-[11px] text-muted-foreground/40 uppercase tracking-widest"
            style={{ animationDelay: "500ms" }}
          >
            {isEn ? "Try asking" : "Prueba preguntar"}
          </p>
          <div className="flex w-full flex-wrap justify-center gap-2">
            {quickPrompts.slice(0, 3).map((prompt, i) => {
              const category = classifyPrompt(prompt);
              const meta = CATEGORY_META[category];
              return (
                <button
                  className={cn(
                    "group glass-liquid relative flex cursor-pointer items-center gap-1.5 rounded-full py-2 pr-4 pl-3 text-center text-[12.5px] text-muted-foreground/70 leading-snug",
                    "transition-all duration-200 ease-out",
                    "hover:border-[var(--sidebar-primary)]/20 hover:bg-[var(--sidebar-primary)]/[0.04] hover:text-foreground/80 hover:shadow-sm",
                    "active:scale-[0.97]",
                    "disabled:pointer-events-none disabled:opacity-40",
                    "animate-[fadeInUp_0.4s_ease-out_both]"
                  )}
                  disabled={disabled}
                  key={prompt}
                  onClick={() => onSendPrompt(prompt)}
                  style={{ animationDelay: `${i * 60 + 560}ms` }}
                  type="button"
                >
                  <Icon
                    className={cn("h-3 w-3 shrink-0", meta.color)}
                    icon={meta.icon}
                    strokeWidth={1.8}
                  />
                  <span className="relative">{prompt}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
