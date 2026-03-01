"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SectionLabel } from "@/components/agent/briefing/helpers";
import { Icon } from "@/components/ui/icon";
import type { UnitRow } from "@/components/units/unit-notion-table";
import { useActiveLocale } from "@/lib/i18n/client";
import { bold, EASING } from "@/lib/module-helpers";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type InternalUnitRow = {
  id: string;
  property_id?: string | null;
  property_name?: string | null;
  code?: string | null;
  name?: string | null;
  max_guests?: number | string | null;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  currency?: string | null;
  is_active?: boolean | null;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}

function asNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* UnitsManager                                                       */
/* ------------------------------------------------------------------ */

export function UnitsManager({
  orgId,
  units,
  properties,
  error: errorLabel,
  success: successMessage,
}: {
  orgId: string;
  units: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  error?: string;
  success?: string;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const propertyCount = properties.filter((p) => asStr(p.id).trim()).length;

  const rows = useMemo<UnitRow[]>(
    () =>
      (units as InternalUnitRow[]).map((r) => ({
        id: asStr(r.id).trim(),
        property_id: asStr(r.property_id).trim() || null,
        property_name: asStr(r.property_name).trim() || null,
        code: asStr(r.code).trim() || null,
        name: asStr(r.name).trim() || null,
        max_guests: asNum(r.max_guests),
        bedrooms: asNum(r.bedrooms),
        bathrooms: asNum(r.bathrooms),
        currency: asStr(r.currency).trim() || null,
        is_active: typeof r.is_active === "boolean" ? r.is_active : Boolean(r.is_active),
      })),
    [units],
  );

  const occupied = rows.filter((r) => r.is_active).length;
  const occupancyPct = rows.length > 0 ? Math.round((occupied / rows.length) * 100) : 0;

  const metrics = [
    { label: isEn ? "Revenue MTD" : "Ingresos del mes", value: "\u20B20", tone: "default" as const },
    {
      label: isEn ? "Avg Occupancy" : "Ocupaci\u00F3n prom.",
      value: `${occupancyPct}%`,
      tone: occupancyPct >= 80 ? ("success" as const) : occupancyPct >= 50 ? ("warning" as const) : ("danger" as const),
    },
    { label: isEn ? "Units Occupied" : "Unidades ocupadas", value: `${occupied}/${rows.length}`, tone: "default" as const },
    { label: isEn ? "Open Tickets" : "Tickets abiertos", value: "0", tone: "default" as const },
  ];

  return (
    <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl flex-col px-4 py-8 sm:px-6">
      <div className="space-y-8">
        {/* Alex overview */}
        <AlexOverview isEn={isEn} rows={rows} propertyCount={propertyCount} />

        {/* Metric cards */}
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          initial={{ opacity: 0, y: 8 }}
          transition={{ delay: 0.1, duration: 0.35, ease: EASING }}
        >
          {metrics.map((m, i) => (
            <motion.div
              animate={{ opacity: 1, scale: 1 }}
              className="glass-inner rounded-xl p-4"
              initial={{ opacity: 0, scale: 0.97 }}
              key={m.label}
              transition={{ delay: 0.15 + i * 0.05, duration: 0.3, ease: EASING }}
            >
              <p
                className={cn(
                  "font-semibold text-xl tabular-nums tracking-tight",
                  m.tone === "success" && "text-emerald-600 dark:text-emerald-400",
                  m.tone === "warning" && "text-amber-600 dark:text-amber-400",
                  m.tone === "danger" && "text-red-600 dark:text-red-400",
                  m.tone === "default" && "text-foreground",
                )}
              >
                {m.value}
              </p>
              <p className="mt-1 text-muted-foreground/70 text-xs">{m.label}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Feedback */}
        {errorLabel ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-red-600 text-sm dark:text-red-400">
            {errorLabel}
          </div>
        ) : null}
        {successMessage ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-emerald-600 text-sm dark:text-emerald-400">
            {successMessage}
          </div>
        ) : null}

        {/* Section label */}
        <SectionLabel>{isEn ? "YOUR UNITS" : "TUS UNIDADES"}</SectionLabel>

        {/* Unit cards */}
        {rows.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <UnitCard isEn={isEn} key={row.id} row={row} />
            ))}
            <AddUnitCard isEn={isEn} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AddUnitCard isEn={isEn} />
          </div>
        )}
      </div>

      {/* Chat + chips pinned to bottom */}
      <div className="mt-auto space-y-4 pt-12">
        <ChatInput isEn={isEn} placeholder={isEn ? "Ask about your units..." : "Pregunta sobre tus unidades..."} />
        <Chips isEn={isEn} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AlexOverview                                                       */
/* ------------------------------------------------------------------ */

function AlexOverview({ isEn, rows, propertyCount }: { isEn: boolean; rows: UnitRow[]; propertyCount: number }) {
  const total = rows.length;
  const occupied = rows.filter((r) => r.is_active).length;

  let text: string;
  if (total === 0) {
    text = isEn
      ? "No units yet. Tell me about your property and I\u2019ll help you set up units."
      : "Sin unidades a\u00FAn. Cu\u00E9ntame sobre tu propiedad y te ayudo a configurar unidades.";
  } else {
    const firstName = rows.find((r) => r.name)?.name;
    if (isEn) {
      const parts = [`Here are your units \u2014 **${total} ${total === 1 ? "unit" : "units"}**, **${occupied} occupied**.`];
      if (firstName && total <= 3) {
        const unlistedCount = rows.filter((r) => !r.is_active).length;
        if (unlistedCount > 0) {
          parts.push(` ${firstName} is set up but not yet listed.`);
        }
      }
      parts.push(" Tap to expand, or add a new unit below.");
      text = parts.join("");
    } else {
      const parts = [`Estas son tus unidades \u2014 **${total} ${total === 1 ? "unidad" : "unidades"}**, **${occupied} ${occupied === 1 ? "ocupada" : "ocupadas"}**.`];
      if (firstName && total <= 3) {
        const unlistedCount = rows.filter((r) => !r.is_active).length;
        if (unlistedCount > 0) {
          parts.push(` ${firstName} est\u00E1 configurada pero a\u00FAn no listada.`);
        }
      }
      parts.push(" Toca para expandir, o agrega una nueva unidad abajo.");
      text = parts.join("");
    }
  }

  return (
    <div className="space-y-1">
      <p className="font-semibold text-foreground text-sm">Alex</p>
      <p className="text-muted-foreground text-sm leading-relaxed">{bold(text)}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UnitCard                                                           */
/* ------------------------------------------------------------------ */

function UnitCard({ row, isEn }: { row: UnitRow; isEn: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const capacity = [
    row.bedrooms != null ? `${row.bedrooms} bed` : null,
    row.bathrooms != null ? `${row.bathrooms} bath` : null,
    row.max_guests != null ? `${row.max_guests} guests` : null,
  ]
    .filter(Boolean)
    .join(" \u00B7 ");

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="glass-inner overflow-hidden rounded-2xl transition-shadow hover:shadow-[var(--shadow-soft)]"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.3, ease: EASING }}
    >
      <button
        className="flex w-full items-start gap-3 p-4 text-left sm:p-5"
        onClick={() => setExpanded((p) => !p)}
        type="button"
      >
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-lg">
          {"\uD83C\uDFE2"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-foreground text-sm tracking-tight">
              {row.name ?? row.code ?? "Unit"}
            </h3>
            {!row.is_active && (
              <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-red-500" />
            )}
          </div>

          <p className="mt-0.5 truncate text-muted-foreground/60 text-xs">
            {row.property_name ?? (isEn ? "No property" : "Sin propiedad")}
          </p>

          {capacity && (
            <p className="mt-2.5 text-muted-foreground text-xs">{capacity}</p>
          )}
        </div>
      </button>

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
                <Stat label={isEn ? "Status" : "Estado"} value={row.is_active ? (isEn ? "Active" : "Activa") : (isEn ? "Vacant" : "Vacante")} tone={row.is_active ? undefined : "danger"} />
                <Stat label={isEn ? "Occupancy" : "Ocupaci\u00F3n"} value={row.is_active ? "100%" : "0%"} tone={row.is_active ? "success" : "danger"} />
                <Stat label={isEn ? "Revenue MTD" : "Ingresos del mes"} value="\u20B20" />
                <Stat label={isEn ? "Open Tickets" : "Tickets"} value="0" />
              </div>

              <Link
                className="mt-3 inline-block text-primary text-xs hover:underline"
                href={`/module/units/${row.id}`}
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div>
      <p className="text-muted-foreground/60">{label}</p>
      <p
        className={cn(
          "font-medium tabular-nums",
          tone === "success" && "text-emerald-600 dark:text-emerald-400",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-red-600 dark:text-red-400",
          !tone && "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AddUnitCard — dashed CTA                                           */
/* ------------------------------------------------------------------ */

function AddUnitCard({ isEn }: { isEn: boolean }) {
  const router = useRouter();

  return (
    <button
      className="group flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/40 p-6 transition-colors hover:border-border/70 hover:bg-muted/10"
      onClick={() =>
        router.push(
          `/app/agents?prompt=${encodeURIComponent(isEn ? "Add a new unit" : "Agregar una nueva unidad")}`,
        )
      }
      type="button"
    >
      <span className="text-muted-foreground/40 text-xl transition-colors group-hover:text-muted-foreground/60">+</span>
      <span className="font-medium text-muted-foreground/50 text-sm transition-colors group-hover:text-muted-foreground/70">
        {isEn ? "Add another unit" : "Agregar otra unidad"}
      </span>
      <span className="text-muted-foreground/30 text-xs transition-colors group-hover:text-muted-foreground/50">
        {isEn ? "Tell Alex about it or click to start" : "Cu\u00E9ntale a Alex o haz clic para comenzar"}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* ChatInput                                                          */
/* ------------------------------------------------------------------ */

function ChatInput({ isEn, placeholder }: { isEn: boolean; placeholder: string }) {
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
          "transition-colors",
        )}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      <button
        className={cn(
          "absolute top-1/2 right-1.5 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
          "bg-foreground text-background transition-opacity",
          value.trim() ? "opacity-100" : "opacity-30",
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
/* Chips                                                              */
/* ------------------------------------------------------------------ */

const CHIPS_EN = [
  "What should I focus on today?",
  "How do I add a new unit?",
  "Set up pricing for my unit",
  "Create a listing for my unit",
];
const CHIPS_ES = [
  "\u00BFEn qu\u00E9 deber\u00EDa enfocarme hoy?",
  "\u00BFC\u00F3mo agrego una nueva unidad?",
  "Configurar precios para mi unidad",
  "Crear un listado para mi unidad",
];

function Chips({ isEn }: { isEn: boolean }) {
  const chips = isEn ? CHIPS_EN : CHIPS_ES;
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-wrap gap-2"
      initial={{ opacity: 0, y: 8 }}
      transition={{ delay: 0.3, duration: 0.4, ease: EASING }}
    >
      {chips.map((chip, i) => (
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          initial={{ opacity: 0, scale: 0.95 }}
          key={chip}
          transition={{ delay: 0.35 + i * 0.04, duration: 0.25, ease: EASING }}
        >
          <Link
            className="glass-inner inline-block rounded-full px-3.5 py-2 text-[12.5px] text-muted-foreground/70 transition-all hover:text-foreground hover:shadow-sm"
            href={`/app/agents?prompt=${encodeURIComponent(chip)}`}
          >
            {chip}
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
