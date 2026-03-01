"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SectionLabel } from "@/components/agent/briefing/helpers";
import { Icon } from "@/components/ui/icon";
import { useActiveLocale } from "@/lib/i18n/client";
import { bold } from "@/lib/module-helpers";
import { cn } from "@/lib/utils";
import { OperationsCard } from "./components/operations-card";
import { OperationsChips } from "./components/operations-chips";
import { OperationsMetricsBar } from "./components/operations-metrics-bar";
import { useOperationsPortfolio } from "./hooks/use-operations-portfolio";

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

type OperationsManagerProps = {
  currentUserId: string | null;
  members: Record<string, unknown>[];
  orgId: string;
  properties: Record<string, unknown>[];
  requests: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  units: Record<string, unknown>[];
  error?: string;
  success?: string;
};

/* ------------------------------------------------------------------ */
/* Filter type                                                         */
/* ------------------------------------------------------------------ */

type Filter = "all" | "tasks" | "maintenance" | "urgent";

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function OperationsManager({
  tasks,
  requests,
  properties,
  units,
  members,
  error: errorLabel,
  success: successMessage,
}: OperationsManagerProps) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const [filter, setFilter] = useState<Filter>("all");

  const { items, summary } = useOperationsPortfolio({
    tasks,
    requests,
    properties,
    units,
    members,
    isEn,
  });

  const filtered = useMemo(() => {
    switch (filter) {
      case "tasks":
        return items.filter((i) => i.kind === "task");
      case "maintenance":
        return items.filter((i) => i.kind === "maintenance");
      case "urgent":
        return items.filter((i) => i.isUrgent || i.isOverdue);
      default:
        return items;
    }
  }, [items, filter]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl flex-col px-4 py-8 sm:px-6">
      <div className="space-y-8">
        {/* Alex overview */}
        <AlexOverview isEn={isEn} summary={summary} />

        {/* Metric cards */}
        <OperationsMetricsBar isEn={isEn} summary={summary} />

        {/* Feedback */}
        <OperationsFeedback error={errorLabel} success={successMessage} />

        {/* Section label + filter pills */}
        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel>{isEn ? "OPERATIONS" : "OPERACIONES"}</SectionLabel>
          <FilterPills filter={filter} isEn={isEn} setFilter={setFilter} />
        </div>

        {/* Card grid */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => (
              <OperationsCard isEn={isEn} item={item} key={item.id} />
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground/60 text-sm">
            {filter === "all"
              ? isEn
                ? "No open tasks or maintenance requests. Everything\u2019s under control."
                : "Sin tareas ni solicitudes abiertas. Todo est\u00e1 bajo control."
              : isEn
                ? "No items match this filter."
                : "Ning\u00fan item coincide con este filtro."}
          </div>
        )}
      </div>

      {/* Push chat to bottom */}
      <div className="mt-auto space-y-4 pt-12">
        <ChatInput isEn={isEn} />
        <OperationsChips isEn={isEn} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AlexOverview                                                        */
/* ------------------------------------------------------------------ */

function AlexOverview({
  summary,
  isEn,
}: {
  summary: {
    openTaskCount: number;
    overdueTaskCount: number;
    maintenanceCount: number;
    emergencyCount: number;
  };
  isEn: boolean;
}) {
  const text = isEn ? buildOverviewEn(summary) : buildOverviewEs(summary);

  return (
    <div className="space-y-1">
      <p className="font-semibold text-foreground text-sm">Alex</p>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {bold(text)}
      </p>
    </div>
  );
}

function buildOverviewEn(s: {
  openTaskCount: number;
  overdueTaskCount: number;
  maintenanceCount: number;
  emergencyCount: number;
}): string {
  if (s.openTaskCount === 0 && s.maintenanceCount === 0) {
    return "All clear \u2014 no open tasks or maintenance requests. Ask me to create one.";
  }
  const parts: string[] = ["Here\u2019s your operations overview \u2014 "];
  parts.push(
    `**${s.openTaskCount} open ${s.openTaskCount === 1 ? "task" : "tasks"}**`
  );
  if (s.overdueTaskCount > 0) {
    parts.push(` (${s.overdueTaskCount} overdue)`);
  }
  parts.push(
    ` and **${s.maintenanceCount} maintenance ${s.maintenanceCount === 1 ? "request" : "requests"}**`
  );
  if (s.emergencyCount > 0) {
    parts.push(
      ` (${s.emergencyCount} ${s.emergencyCount === 1 ? "emergency" : "emergencies"})`
    );
  }
  parts.push(". Tap any item to expand.");
  return parts.join("");
}

function buildOverviewEs(s: {
  openTaskCount: number;
  overdueTaskCount: number;
  maintenanceCount: number;
  emergencyCount: number;
}): string {
  if (s.openTaskCount === 0 && s.maintenanceCount === 0) {
    return "Todo en orden \u2014 sin tareas ni solicitudes abiertas. P\u00eddeme crear una.";
  }
  const parts: string[] = ["Resumen de operaciones \u2014 "];
  parts.push(
    `**${s.openTaskCount} ${s.openTaskCount === 1 ? "tarea abierta" : "tareas abiertas"}**`
  );
  if (s.overdueTaskCount > 0) {
    parts.push(
      ` (${s.overdueTaskCount} ${s.overdueTaskCount === 1 ? "vencida" : "vencidas"})`
    );
  }
  parts.push(
    ` y **${s.maintenanceCount} ${s.maintenanceCount === 1 ? "solicitud de mantenimiento" : "solicitudes de mantenimiento"}**`
  );
  if (s.emergencyCount > 0) {
    parts.push(
      ` (${s.emergencyCount} ${s.emergencyCount === 1 ? "emergencia" : "emergencias"})`
    );
  }
  parts.push(". Toca cualquier item para expandir.");
  return parts.join("");
}

/* ------------------------------------------------------------------ */
/* FilterPills                                                         */
/* ------------------------------------------------------------------ */

const FILTERS: { key: Filter; en: string; es: string }[] = [
  { key: "all", en: "All", es: "Todos" },
  { key: "tasks", en: "Tasks", es: "Tareas" },
  { key: "maintenance", en: "Maintenance", es: "Mantenimiento" },
  { key: "urgent", en: "Urgent", es: "Urgente" },
];

function FilterPills({
  filter,
  setFilter,
  isEn,
}: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  isEn: boolean;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/40 bg-muted/20 p-1">
      {FILTERS.map((f) => (
        <button
          className={cn(
            "rounded-md px-2.5 py-1 font-medium text-xs transition-colors",
            filter === f.key
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
          key={f.key}
          onClick={() => setFilter(f.key)}
          type="button"
        >
          {isEn ? f.en : f.es}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ChatInput                                                           */
/* ------------------------------------------------------------------ */

function ChatInput({ isEn }: { isEn: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    router.push(`/app/agents?prompt=${encodeURIComponent(trimmed)}`);
  };

  return (
    <form className="relative" onSubmit={handleSubmit}>
      <input
        className={cn(
          "h-12 w-full rounded-full border border-border/50 bg-background pr-12 pl-5 text-sm",
          "placeholder:text-muted-foreground/40",
          "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20",
          "transition-colors"
        )}
        onChange={(e) => setValue(e.target.value)}
        placeholder={
          isEn
            ? "Ask about your operations..."
            : "Pregunta sobre tus operaciones..."
        }
        type="text"
        value={value}
      />
      <button
        className={cn(
          "absolute top-1/2 right-1.5 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
          "bg-foreground text-background transition-opacity",
          value.trim() ? "opacity-100" : "opacity-30"
        )}
        disabled={!value.trim()}
        type="submit"
      >
        <Icon icon={ArrowRight01Icon} size={16} />
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* OperationsFeedback                                                  */
/* ------------------------------------------------------------------ */

function OperationsFeedback({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  if (!(error || success)) return null;

  return (
    <>
      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-red-600 text-sm dark:text-red-400">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-emerald-600 text-sm dark:text-emerald-400">
          {success}
        </div>
      ) : null}
    </>
  );
}
