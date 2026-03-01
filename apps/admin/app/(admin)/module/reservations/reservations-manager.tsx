"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SectionLabel } from "@/components/agent/briefing/helpers";
import { Icon } from "@/components/ui/icon";
import { useActiveLocale } from "@/lib/i18n/client";
import { EASING, bold, fmtPyg, initials, isoToday } from "@/lib/module-helpers";
import { cn } from "@/lib/utils";
import {
  asNumber,
  asString,
  daysBetween,
  humanizeStatus,
  isIsoDate,
  type ReservationRow,
  type UnitRow,
} from "./reservations-types";

/* Normalized internal row */
type NormalizedRow = {
  id: string;
  status: string;
  check_in_date: string | null;
  check_out_date: string | null;
  unit_id: string | null;
  unit_name: string | null;
  property_name: string | null;
  guest_name: string | null;
  guest_id: string | null;
  channel_name: string | null;
  source: string | null;
  total_amount: number;
  currency: string;
  adults: number;
  children: number;
  nights: number;
  nightly_rate: number;
};

function toNormalized(r: ReservationRow): NormalizedRow {
  const checkIn = isIsoDate(r.check_in_date) ? r.check_in_date : null;
  const checkOut = isIsoDate(r.check_out_date) ? r.check_out_date : null;
  const nights = daysBetween(checkIn, checkOut) ?? 0;
  const total = asNumber(r.total_amount) ?? 0;
  return {
    id: asString(r.id).trim(),
    status: asString(r.status).trim().toLowerCase(),
    check_in_date: checkIn,
    check_out_date: checkOut,
    unit_id: asString(r.unit_id).trim() || null,
    unit_name: asString(r.unit_name).trim() || null,
    property_name: asString(r.property_name).trim() || null,
    guest_name: asString(r.guest_name).trim() || null,
    guest_id: asString(r.guest_id).trim() || null,
    channel_name: asString(r.channel_name).trim() || null,
    source: asString(r.source).trim() || null,
    total_amount: total,
    currency: asString(r.currency).trim().toUpperCase() || "PYG",
    adults: asNumber(r.adults) ?? 0,
    children: asNumber(r.children) ?? 0,
    nights,
    nightly_rate: nights > 0 ? Math.round(total / nights) : 0,
  };
}

type NormalizedUnit = {
  id: string;
  name: string;
  property_name: string;
};

function toNormalizedUnit(u: UnitRow): NormalizedUnit {
  return {
    id: asString(u.id).trim(),
    name: asString(u.name).trim() || asString(u.code).trim() || "Unit",
    property_name: asString(u.property_name).trim() || "",
  };
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  confirmed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  checked_in: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  checked_out: "bg-muted text-muted-foreground",
  cancelled: "bg-red-500/15 text-red-700 dark:text-red-400",
  no_show: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const CHANNEL_COLORS: Record<string, string> = {
  airbnb: "text-rose-500",
  "booking.com": "text-blue-500",
  casaora: "text-emerald-500",
  direct_booking: "text-emerald-500",
  manual: "text-muted-foreground",
};

function channelLabel(row: NormalizedRow): string {
  const ch = row.channel_name?.toLowerCase();
  if (ch) {
    if (ch.includes("airbnb")) return "Airbnb";
    if (ch.includes("booking")) return "Booking.com";
    if (ch.includes("casaora") || ch.includes("marketplace")) return "Casaora";
  }
  const src = row.source?.toLowerCase();
  if (src === "direct_booking") return "Casaora";
  if (src === "manual") return "Manual";
  return row.channel_name || "Direct";
}

function channelColor(row: NormalizedRow): string {
  const label = channelLabel(row).toLowerCase();
  return CHANNEL_COLORS[label] ?? CHANNEL_COLORS.manual ?? "text-muted-foreground";
}

/* ------------------------------------------------------------------ */
/* ReservationsManager                                                 */
/* ------------------------------------------------------------------ */

export function ReservationsManager({
  orgId,
  reservations,
  units,
  error: errorLabel,
  success: successMessage,
}: {
  orgId: string;
  reservations: Record<string, unknown>[];
  units: Record<string, unknown>[];
  error?: string;
  success?: string;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const fmtLocale = isEn ? "en-US" : "es-PY";

  const today = useMemo(isoToday, []);

  const rows = useMemo<NormalizedRow[]>(
    () => (reservations as ReservationRow[]).map(toNormalized),
    [reservations],
  );

  const unitList = useMemo<NormalizedUnit[]>(
    () => (units as UnitRow[]).map(toNormalizedUnit).filter((u) => u.id),
    [units],
  );

  /* ------- Stats ------- */
  const totalRevenue = rows.reduce((s, r) => s + r.total_amount, 0);
  const activeStatuses = new Set(["confirmed", "checked_in", "pending"]);
  const activeRows = rows.filter((r) => activeStatuses.has(r.status));
  const totalNights = rows.reduce((s, r) => s + r.nights, 0);
  const avgNights = rows.length > 0 ? +(totalNights / rows.length).toFixed(1) : 0;

  // Occupancy: days with at least one guest checked in / total unit-days this month
  const daysInMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    0,
  ).getDate();
  const totalUnitDays = Math.max(unitList.length, 1) * daysInMonth;
  const occupiedDays = rows.reduce((s, r) => {
    if (r.status === "cancelled" || r.status === "no_show") return s;
    return s + r.nights;
  }, 0);
  const occupancyPct = totalUnitDays > 0 ? Math.min(100, Math.round((occupiedDays / totalUnitDays) * 100)) : 0;

  // Channel distribution
  const channelCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "cancelled" || r.status === "no_show") continue;
    const ch = channelLabel(r);
    channelCounts.set(ch, (channelCounts.get(ch) ?? 0) + 1);
  }
  const validBookings = rows.filter((r) => r.status !== "cancelled" && r.status !== "no_show").length;
  const channelSegments = [...channelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name,
      pct: validBookings > 0 ? Math.round((count / validBookings) * 100) : 0,
      color:
        name.toLowerCase().includes("airbnb") ? "bg-rose-500" :
        name.toLowerCase().includes("booking") ? "bg-blue-500" :
        name.toLowerCase().includes("casaora") || name.toLowerCase() === "direct" ? "bg-emerald-500" :
        "bg-muted-foreground/50",
    }));

  /* ------- Today's activity ------- */
  const todayActivity = useMemo(() => {
    const items: { time: string; label: string; sub: string; status: "done" | "live" | "upcoming" }[] = [];

    // Check-outs today
    for (const r of rows) {
      if (r.check_out_date === today && r.status === "checked_out") {
        items.push({
          time: "11:00 AM",
          label: `${r.guest_name ?? "Guest"} ${isEn ? "checks out" : "check-out"}`,
          sub: r.unit_name ?? r.property_name ?? "",
          status: "done",
        });
      }
    }

    // Currently checked-in with check-out today (departures pending)
    for (const r of rows) {
      if (r.check_out_date === today && r.status === "checked_in") {
        items.push({
          time: "11:00 AM",
          label: `${r.guest_name ?? "Guest"} ${isEn ? "checks out" : "check-out"}`,
          sub: r.unit_name ?? r.property_name ?? "",
          status: "upcoming",
        });
      }
    }

    // Check-ins today
    for (const r of rows) {
      if (r.check_in_date === today && (r.status === "confirmed" || r.status === "pending")) {
        items.push({
          time: "4:00 PM",
          label: `${r.guest_name ?? "Guest"} ${isEn ? "checks in" : "check-in"}`,
          sub: r.unit_name ?? r.property_name ?? "",
          status: "upcoming",
        });
      }
      if (r.check_in_date === today && r.status === "checked_in") {
        items.push({
          time: "4:00 PM",
          label: `${r.guest_name ?? "Guest"} ${isEn ? "checked in" : "ya ingresó"}`,
          sub: r.unit_name ?? r.property_name ?? "",
          status: "done",
        });
      }
    }

    // Mid-stays (checked in, spans today)
    for (const r of rows) {
      if (
        r.status === "checked_in" &&
        r.check_in_date &&
        r.check_out_date &&
        r.check_in_date < today &&
        r.check_out_date > today
      ) {
        const totalNightsStay = daysBetween(r.check_in_date, r.check_out_date) ?? 0;
        const dayNum = (daysBetween(r.check_in_date, today) ?? 0) + 1;
        items.push({
          time: "\u2014",
          label: `${r.guest_name ?? "Guest"} \u2014 ${isEn ? "mid-stay" : "estad\u00EDa"} (${isEn ? `day ${dayNum} of ${totalNightsStay}` : `d\u00EDa ${dayNum} de ${totalNightsStay}`})`,
          sub: r.unit_name ?? r.property_name ?? "",
          status: "live",
        });
      }
    }

    return items;
  }, [rows, today, isEn]);

  /* ------- Occupancy grid (next 14 days) ------- */
  const gridDays = useMemo(() => {
    const days: string[] = [];
    const d = new Date();
    for (let i = 0; i < 14; i++) {
      const day = new Date(d);
      day.setDate(d.getDate() + i);
      days.push(day.toISOString().slice(0, 10));
    }
    return days;
  }, []);

  // Map: unitId → array of reservations touching next 14 days
  const unitReservations = useMemo(() => {
    const map = new Map<string, NormalizedRow[]>();
    for (const r of rows) {
      if (!r.unit_id || !r.check_in_date || !r.check_out_date) continue;
      if (r.status === "cancelled" || r.status === "no_show") continue;
      const first = gridDays[0];
      const last = gridDays[gridDays.length - 1];
      if (r.check_out_date <= first || r.check_in_date > last) continue;
      const arr = map.get(r.unit_id) ?? [];
      arr.push(r);
      map.set(r.unit_id, arr);
    }
    return map;
  }, [rows, gridDays]);

  // Only show units that have reservations in the window (or all if few)
  const gridUnits = useMemo(() => {
    if (unitList.length <= 6) return unitList;
    return unitList.filter((u) => unitReservations.has(u.id));
  }, [unitList, unitReservations]);

  /* ------- Filter tabs ------- */
  const [activeTab, setActiveTab] = useState<"all" | "active" | "upcoming" | "past">("all");

  const filteredRows = useMemo(() => {
    if (activeTab === "all") return rows;
    if (activeTab === "active") return rows.filter((r) => r.status === "checked_in");
    if (activeTab === "upcoming") return rows.filter((r) => r.status === "confirmed" || r.status === "pending");
    if (activeTab === "past") return rows.filter((r) => r.status === "checked_out" || r.status === "cancelled" || r.status === "no_show");
    return rows;
  }, [rows, activeTab]);

  const tabCounts = useMemo(() => ({
    all: rows.length,
    active: rows.filter((r) => r.status === "checked_in").length,
    upcoming: rows.filter((r) => r.status === "confirmed" || r.status === "pending").length,
    past: rows.filter((r) => r.status === "checked_out" || r.status === "cancelled" || r.status === "no_show").length,
  }), [rows]);

  // Month name
  const monthName = new Date().toLocaleString(isEn ? "en-US" : "es-PY", { month: "long" }).toUpperCase();

  // Chips — contextual
  const firstGuest = rows.find((r) => r.status === "confirmed" && r.check_in_date === today)?.guest_name;
  const chips = isEn
    ? [
        "Who's checking in today?",
        "Show me upcoming gaps",
        "How are my guests doing?",
        "What's my booking pipeline?",
        ...(firstGuest ? [`Draft a welcome message for ${firstGuest.split(" ")[0]}`] : []),
        "Compare Airbnb vs direct bookings",
      ]
    : [
        "¿Quién hace check-in hoy?",
        "Mostrar espacios disponibles próximos",
        "¿Cómo están mis huéspedes?",
        "¿Cuál es mi pipeline de reservas?",
        ...(firstGuest ? [`Redactar mensaje de bienvenida para ${firstGuest.split(" ")[0]}`] : []),
        "Comparar Airbnb vs reservas directas",
      ];

  return (
    <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl flex-col px-4 py-8 sm:px-6">
      <div className="space-y-8">
        {/* Alex overview */}
        <AlexOverview
          activeRows={activeRows}
          fmtLocale={fmtLocale}
          isEn={isEn}
          rows={rows}
          today={today}
          totalRevenue={totalRevenue}
        />

        {/* Monthly bookings metrics */}
        <SectionLabel>{monthName} {isEn ? "BOOKINGS" : "RESERVAS"}</SectionLabel>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="glass-inner overflow-hidden rounded-2xl"
          initial={{ opacity: 0, y: 8 }}
          transition={{ delay: 0.1, duration: 0.35, ease: EASING }}
        >
          <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
            <MetricCell
              change={null}
              isFirst
              label={isEn ? "BOOKING REVENUE" : "INGRESOS POR RESERVAS"}
              value={fmtPyg(totalRevenue, fmtLocale)}
            />
            <MetricCell
              label={isEn ? "OCCUPANCY" : "OCUPACIÓN"}
              value={`${occupancyPct}%`}
            />
            <MetricCell
              label={isEn ? "AVG NIGHTS" : "NOCHES PROM."}
              value={String(avgNights)}
            />
            <MetricCell
              label={isEn ? "BOOKINGS" : "RESERVAS"}
              value={String(validBookings)}
            />
          </div>

          {/* Channel distribution bar */}
          {channelSegments.length > 0 && (
            <div className="border-border/20 border-t px-5 py-3">
              <div className="flex h-2 w-full overflow-hidden rounded-full">
                {channelSegments.map((seg) => (
                  <motion.div
                    animate={{ width: `${seg.pct}%` }}
                    className={cn("h-full first:rounded-l-full last:rounded-r-full", seg.color)}
                    initial={{ width: 0 }}
                    key={seg.name}
                    transition={{ delay: 0.4, duration: 0.5, ease: EASING }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {channelSegments.map((seg) => (
                  <span className="flex items-center gap-1.5 text-muted-foreground/70 text-xs" key={seg.name}>
                    <span className={cn("inline-block h-2 w-2 rounded-sm", seg.color)} />
                    {seg.name} {seg.pct}%
                  </span>
                ))}
              </div>
            </div>
          )}
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

        {/* Today's Activity */}
        {todayActivity.length > 0 && (
          <>
            <SectionLabel>{isEn ? "TODAY\u2019S ACTIVITY" : "ACTIVIDAD DE HOY"}</SectionLabel>
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="glass-inner overflow-hidden rounded-2xl"
              initial={{ opacity: 0, y: 8 }}
              transition={{ delay: 0.15, duration: 0.35, ease: EASING }}
            >
              <div className="divide-y divide-border/20">
                {todayActivity.map((item, idx) => (
                  <ActivityRow item={item} key={`${item.label}-${idx}`} />
                ))}
              </div>
            </motion.div>
          </>
        )}

        {/* Occupancy Grid — Next 14 Days */}
        {gridUnits.length > 0 && (
          <>
            <SectionLabel>{isEn ? "OCCUPANCY \u2014 NEXT 14 DAYS" : "OCUPACI\u00D3N \u2014 PR\u00D3XIMOS 14 D\u00CDAS"}</SectionLabel>
            <OccupancyGrid
              gridDays={gridDays}
              isEn={isEn}
              today={today}
              unitReservations={unitReservations}
              units={gridUnits}
            />
          </>
        )}

        {/* Reservations */}
        <SectionLabel>{isEn ? "RESERVATIONS" : "RESERVAS"}</SectionLabel>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "all", label: isEn ? "All" : "Todas" },
              { key: "active", label: isEn ? "Active stays" : "Activas" },
              { key: "upcoming", label: isEn ? "Upcoming" : "Próximas" },
              { key: "past", label: isEn ? "Past" : "Pasadas" },
            ] as const
          ).map((tab) => (
            <button
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                activeTab === tab.key
                  ? "border-foreground/20 bg-foreground/10 text-foreground"
                  : "border-border/40 text-muted-foreground/60 hover:text-muted-foreground",
              )}
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              {tab.label}{tab.key === "all" ? ` (${tabCounts.all})` : ""}
            </button>
          ))}
        </div>

        {/* Reservation cards */}
        {filteredRows.length > 0 ? (
          <div className="space-y-3">
            {filteredRows.map((row) => (
              <ReservationCard
                fmtLocale={fmtLocale}
                isEn={isEn}
                key={row.id}
                row={row}
              />
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground/60 text-sm">
            {isEn ? "No reservations in this category." : "Sin reservas en esta categor\u00EDa."}
          </div>
        )}
      </div>

      {/* Chat + chips pinned to bottom */}
      <div className="mt-auto space-y-4 pt-12">
        <ChatInput isEn={isEn} placeholder={isEn ? "Ask about your reservations..." : "Pregunta sobre tus reservas..."} />
        <Chips chips={chips} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AlexOverview                                                        */
/* ------------------------------------------------------------------ */

function AlexOverview({
  rows,
  activeRows,
  today,
  totalRevenue,
  fmtLocale,
  isEn,
}: {
  rows: NormalizedRow[];
  activeRows: NormalizedRow[];
  today: string;
  totalRevenue: number;
  fmtLocale: string;
  isEn: boolean;
}) {
  if (rows.length === 0) {
    const text = isEn
      ? "No reservations yet. Tell me about an incoming booking and I\u2019ll set it up."
      : "Sin reservas a\u00FAn. Cu\u00E9ntame sobre una reserva y te ayudo a crearla.";
    return (
      <div className="space-y-1">
        <p className="font-semibold text-foreground text-sm">Alex</p>
        <p className="text-muted-foreground text-sm leading-relaxed">{text}</p>
      </div>
    );
  }

  const parts: string[] = [];

  // Next check-in today
  const nextCheckIn = rows.find(
    (r) => r.check_in_date === today && (r.status === "confirmed" || r.status === "pending"),
  );
  // Mid-stays
  const midStays = rows.filter(
    (r) =>
      r.status === "checked_in" &&
      r.check_in_date &&
      r.check_out_date &&
      r.check_in_date < today &&
      r.check_out_date > today,
  );

  if (isEn) {
    if (nextCheckIn) {
      parts.push(`**${nextCheckIn.guest_name ?? "A guest"} checks in today**`);
      if (nextCheckIn.unit_name) parts.push(` at ${nextCheckIn.unit_name}`);
      parts.push(". ");
    }
    if (midStays.length > 0) {
      const ms = midStays[0];
      const totalN = daysBetween(ms.check_in_date, ms.check_out_date) ?? 0;
      const dayNum = (daysBetween(ms.check_in_date, today) ?? 0) + 1;
      parts.push(
        `${ms.guest_name ?? "A guest"} is on day ${dayNum} of ${totalN} at ${ms.unit_name ?? ms.property_name ?? "a property"}. `,
      );
    }
    parts.push(
      `You have **${activeRows.length} ${activeRows.length === 1 ? "booking" : "bookings"}** generating **${fmtPyg(totalRevenue, fmtLocale)} in revenue**.`,
    );
  } else {
    if (nextCheckIn) {
      parts.push(`**${nextCheckIn.guest_name ?? "Un hu\u00E9sped"} hace check-in hoy**`);
      if (nextCheckIn.unit_name) parts.push(` en ${nextCheckIn.unit_name}`);
      parts.push(". ");
    }
    if (midStays.length > 0) {
      const ms = midStays[0];
      const totalN = daysBetween(ms.check_in_date, ms.check_out_date) ?? 0;
      const dayNum = (daysBetween(ms.check_in_date, today) ?? 0) + 1;
      parts.push(
        `${ms.guest_name ?? "Un hu\u00E9sped"} est\u00E1 en el d\u00EDa ${dayNum} de ${totalN} en ${ms.unit_name ?? ms.property_name ?? "una propiedad"}. `,
      );
    }
    parts.push(
      `Tienes **${activeRows.length} ${activeRows.length === 1 ? "reserva" : "reservas"}** generando **${fmtPyg(totalRevenue, fmtLocale)} en ingresos**.`,
    );
  }

  return (
    <div className="space-y-1">
      <p className="font-semibold text-foreground text-sm">Alex</p>
      <p className="text-muted-foreground text-sm leading-relaxed">{bold(parts.join(""))}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MetricCell                                                          */
/* ------------------------------------------------------------------ */

function MetricCell({
  label,
  value,
  change,
  isFirst,
}: {
  label: string;
  value: string;
  change?: { pct: number; positive: boolean } | null;
  isFirst?: boolean;
}) {
  return (
    <div className={cn("p-5", isFirst && "border-border/20 sm:border-r")}>
      <p className="text-center font-semibold text-2xl tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-1 text-center text-muted-foreground/50 text-[10px] font-medium tracking-wider uppercase">
        {label}
      </p>
      {change && (
        <p className={cn("mt-1 text-center text-xs", change.positive ? "text-emerald-500" : "text-red-500")}>
          {change.positive ? "\u2191" : "\u2193"} {change.pct}% vs last month
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ActivityRow                                                         */
/* ------------------------------------------------------------------ */

function ActivityRow({
  item,
}: {
  item: { time: string; label: string; sub: string; status: "done" | "live" | "upcoming" };
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <span className="w-16 shrink-0 text-right font-mono text-muted-foreground/50 text-xs tabular-nums">
        {item.time}
      </span>
      <span
        className={cn(
          "h-2.5 w-2.5 shrink-0 rounded-full",
          item.status === "done" && "bg-emerald-500",
          item.status === "live" && "bg-blue-500",
          item.status === "upcoming" && "border-2 border-muted-foreground/30 bg-transparent",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground text-sm">{item.label}</p>
        <p className="truncate text-muted-foreground/50 text-xs">{item.sub}</p>
      </div>
      <span
        className={cn(
          "shrink-0 text-xs font-medium tracking-wide",
          item.status === "done" && "text-emerald-500",
          item.status === "live" && "text-blue-500",
          item.status === "upcoming" && "text-muted-foreground/40",
        )}
      >
        {item.status === "done" && "\u2713 DONE"}
        {item.status === "live" && "\u25CF LIVE"}
        {item.status === "upcoming" && "\u25CB UPCOMING"}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* OccupancyGrid                                                       */
/* ------------------------------------------------------------------ */

function OccupancyGrid({
  units,
  gridDays,
  unitReservations,
  today,
  isEn,
}: {
  units: NormalizedUnit[];
  gridDays: string[];
  unitReservations: Map<string, NormalizedRow[]>;
  today: string;
  isEn: boolean;
}) {
  const dayLabels = gridDays.map((d) => {
    const dt = new Date(`${d}T12:00:00`);
    return {
      iso: d,
      dayOfWeek: dt.toLocaleDateString(isEn ? "en-US" : "es-PY", { weekday: "short" }).toUpperCase().slice(0, 3),
      dayNum: dt.getDate(),
      isToday: d === today,
    };
  });

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="glass-inner overflow-hidden rounded-2xl"
      initial={{ opacity: 0, y: 8 }}
      transition={{ delay: 0.2, duration: 0.35, ease: EASING }}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[640px] px-5 py-4">
          {/* Day headers */}
          <div className="mb-3 grid" style={{ gridTemplateColumns: `140px repeat(${gridDays.length}, 1fr)` }}>
            <div />
            {dayLabels.map((d) => (
              <div className="text-center" key={d.iso}>
                <p className="text-muted-foreground/40 text-[9px] font-medium">{d.dayOfWeek}</p>
                <p
                  className={cn(
                    "mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums",
                    d.isToday
                      ? "bg-foreground text-background font-semibold"
                      : "text-muted-foreground/60",
                  )}
                >
                  {d.dayNum}
                </p>
              </div>
            ))}
          </div>

          {/* Unit rows */}
          {units.map((unit) => {
            const resForUnit = unitReservations.get(unit.id) ?? [];
            return (
              <div
                className="grid items-center border-border/10 border-t py-2"
                key={unit.id}
                style={{ gridTemplateColumns: `140px repeat(${gridDays.length}, 1fr)` }}
              >
                <p className="truncate pr-3 text-muted-foreground text-xs">
                  {unit.property_name || unit.name}
                </p>
                {gridDays.map((day) => {
                  const res = resForUnit.find(
                    (r) =>
                      r.check_in_date &&
                      r.check_out_date &&
                      day >= r.check_in_date &&
                      day < r.check_out_date,
                  );
                  if (!res) {
                    return <div className="h-7 px-0.5" key={day}><div className="h-full rounded-sm" /></div>;
                  }
                  const isStart = day === res.check_in_date;
                  const isEndPrev = (() => {
                    const nextDay = new Date(`${day}T12:00:00`);
                    nextDay.setDate(nextDay.getDate() + 1);
                    return nextDay.toISOString().slice(0, 10) === res.check_out_date;
                  })();
                  const color =
                    res.status === "checked_in" ? "bg-blue-500/80" :
                    res.status === "confirmed" ? "bg-emerald-500/80" :
                    res.status === "pending" ? "bg-amber-500/80" :
                    "bg-muted-foreground/30";
                  const guestInitial = res.guest_name ? res.guest_name.split(" ").map((w) => w[0]).join("").slice(0, 2) : "";
                  return (
                    <div className="h-7 px-0.5" key={day}>
                      <div
                        className={cn(
                          "flex h-full items-center justify-center text-[9px] font-medium text-white",
                          color,
                          isStart && "rounded-l-md",
                          isEndPrev && "rounded-r-md",
                        )}
                      >
                        {isStart ? guestInitial : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* ReservationCard                                                     */
/* ------------------------------------------------------------------ */

function ReservationCard({
  row,
  isEn,
  fmtLocale,
}: {
  row: NormalizedRow;
  isEn: boolean;
  fmtLocale: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const statusBadge = STATUS_BADGE[row.status] ?? STATUS_BADGE.pending;
  const chLabel = channelLabel(row);
  const chColor = channelColor(row);
  const isCheckedIn = row.status === "checked_in";

  const dateRange = [row.check_in_date, row.check_out_date].filter(Boolean).join(" \u2192 ");
  const nightsLabel = row.nights > 0
    ? `${row.nights} ${isEn ? (row.nights === 1 ? "night" : "nights") : (row.nights === 1 ? "noche" : "noches")}`
    : "";
  const rateLabel = row.nightly_rate > 0 ? `${fmtPyg(row.nightly_rate, fmtLocale)}/${isEn ? "night" : "noche"}` : "";
  const detail = [dateRange, nightsLabel, rateLabel].filter(Boolean).join(" \u00B7 ");

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "glass-inner overflow-hidden rounded-2xl transition-shadow hover:shadow-[var(--shadow-soft)]",
        isCheckedIn && "ring-1 ring-blue-500/30",
      )}
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.3, ease: EASING }}
    >
      <button
        className="flex w-full items-center gap-4 p-4 text-left sm:p-5"
        onClick={() => setExpanded((p) => !p)}
        type="button"
      >
        {/* Initials avatar */}
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-medium text-xs",
            isCheckedIn ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" : "bg-muted/60 text-foreground/70",
          )}
        >
          {initials(row.guest_name ?? "?")}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-foreground text-sm tracking-tight">
              {row.guest_name ?? (isEn ? "Guest" : "Hu\u00E9sped")}
            </h3>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", statusBadge)}>
              {humanizeStatus(row.status, isEn)}
            </span>
            <span className={cn("shrink-0 text-xs font-medium", chColor)}>
              via {chLabel}
            </span>
          </div>

          <p className="mt-0.5 truncate text-muted-foreground/60 text-xs">
            {row.unit_name ?? row.property_name ?? ""}
          </p>

          <p className="mt-1.5 text-muted-foreground text-xs tabular-nums">
            {detail}
          </p>
        </div>

        {/* Payout + expand */}
        <div className="shrink-0 text-right">
          <p className="font-semibold text-lg tabular-nums tracking-tight text-foreground">
            {fmtPyg(row.total_amount, fmtLocale)}
          </p>
          <p className="text-muted-foreground/40 text-[10px] font-medium uppercase tracking-wider">
            {isEn ? "HOST PAYOUT" : "PAGO AL HOST"}
          </p>
        </div>

        <span className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/40 text-muted-foreground/40 transition-colors hover:text-foreground">
          <motion.span
            animate={{ rotate: expanded ? 45 : 0 }}
            transition={{ duration: 0.2 }}
          >
            +
          </motion.span>
        </span>
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
              {/* Details grid */}
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <Stat label={isEn ? "Check-in" : "Check-in"} value={row.check_in_date ?? "\u2014"} />
                <Stat label={isEn ? "Check-out" : "Check-out"} value={row.check_out_date ?? "\u2014"} />
                <Stat label={isEn ? "Guests" : "Hu\u00E9spedes"} value={`${row.adults}${row.children > 0 ? ` + ${row.children} ${isEn ? "children" : "ni\u00F1os"}` : ""}`} />
                <Stat label={isEn ? "Source" : "Fuente"} value={chLabel} />
              </div>

              {/* Action buttons */}
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionChip
                  label={isEn ? "Message guest" : "Mensaje al hu\u00E9sped"}
                  prompt={isEn ? `Send a message to ${row.guest_name ?? "the guest"}` : `Enviar mensaje a ${row.guest_name ?? "el hu\u00E9sped"}`}
                />
                {row.status === "confirmed" && (
                  <ActionChip
                    label={isEn ? "Send welcome" : "Enviar bienvenida"}
                    prompt={isEn ? `Draft a welcome message for ${row.guest_name ?? "the guest"}` : `Redactar mensaje de bienvenida para ${row.guest_name ?? "el hu\u00E9sped"}`}
                  />
                )}
                {row.status === "checked_in" && (
                  <ActionChip
                    label={isEn ? "Check satisfaction" : "Verificar satisfacci\u00F3n"}
                    prompt={isEn ? `Check how ${row.guest_name ?? "the guest"} is doing at ${row.property_name ?? "the property"}` : `Verificar c\u00F3mo est\u00E1 ${row.guest_name ?? "el hu\u00E9sped"} en ${row.property_name ?? "la propiedad"}`}
                  />
                )}
                <button
                  className="rounded-full border border-border/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                  onClick={() => router.push(`/module/reservations/${row.id}`)}
                  type="button"
                >
                  {isEn ? "View full details" : "Ver detalles completos"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat                                                                */
/* ------------------------------------------------------------------ */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground/60">{label}</p>
      <p className="font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ActionChip                                                          */
/* ------------------------------------------------------------------ */

function ActionChip({ label, prompt }: { label: string; prompt: string }) {
  return (
    <Link
      className="rounded-full border border-border/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
      href={`/app/agents?prompt=${encodeURIComponent(prompt)}`}
    >
      {label}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* ChatInput                                                           */
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
/* Chips                                                               */
/* ------------------------------------------------------------------ */

function Chips({ chips }: { chips: string[] }) {
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
