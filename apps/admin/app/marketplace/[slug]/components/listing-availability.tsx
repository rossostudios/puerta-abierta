"use client";

import { Calendar02Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

type DayStatus = "available" | "booked" | "blocked" | "past";

type CalendarDay = {
  date: string;
  status: DayStatus;
};

const MONTH_NAMES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_NAMES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const DAY_LABELS_EN = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY_LABELS_ES = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

type ListingAvailabilityProps = {
  availableFrom: string;
  minimumLeaseMonths: number | null;
  isEn: boolean;
  slug?: string;
  unitId?: string;
};

export function ListingAvailability({
  availableFrom,
  minimumLeaseMonths,
  isEn,
  slug,
  unitId,
}: ListingAvailabilityProps) {
  if (!availableFrom) return null;

  const availDate = new Date(availableFrom);
  const today = new Date();
  const isAvailableNow = availDate <= today;

  return (
    <section>
      <h2 className="mb-4 font-medium font-serif text-[var(--marketplace-text)] text-xl tracking-tight">
        {isEn ? "Availability" : "Disponibilidad"}
      </h2>
      <div className="h-px bg-[#e8e4df]" />
      <div className="mt-4 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <Icon className="text-primary" icon={Calendar02Icon} size={18} />
        </span>
        <div>
          <p className="font-medium text-[var(--marketplace-text)] text-sm">
            {isAvailableNow
              ? isEn
                ? "Available now"
                : "Disponible ahora"
              : isEn
                ? `Available from ${availableFrom}`
                : `Disponible desde ${availableFrom}`}
          </p>
          {minimumLeaseMonths ? (
            <p className="text-[var(--marketplace-text-muted)] text-xs">
              {isEn
                ? `Minimum lease: ${minimumLeaseMonths} months`
                : `Contrato mínimo: ${minimumLeaseMonths} meses`}
            </p>
          ) : null}
        </div>
      </div>

      {slug && unitId ? (
        <div className="mt-5">
          <ListingCalendar isEn={isEn} slug={slug} />
        </div>
      ) : null}
    </section>
  );
}

function ListingCalendar({ slug, isEn }: { slug: string; isEn: boolean }) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const monthKey = toMonthKey(currentMonth);
  const monthNames = isEn ? MONTH_NAMES_EN : MONTH_NAMES_ES;
  const dayLabels = isEn ? DAY_LABELS_EN : DAY_LABELS_ES;

  const { data: days = [], isLoading: loading } = useQuery({
    queryKey: ["listing-availability", slug, monthKey],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/public/listings/${encodeURIComponent(slug)}/availability?month=${monthKey}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (data.days != null) {
        return data.days as CalendarDay[];
      }
      return [];
    },
  });

  const monthNum = currentMonth.getMonth();
  const yearNum = currentMonth.getFullYear();

  return (
    <div className="rounded-xl border border-[#e8e4df] p-3">
      {/* Month nav */}
      <div className="mb-2 flex items-center justify-between">
        <button
          className="rounded px-2 py-0.5 text-sm hover:bg-[#f5f0eb]"
          onClick={() => {
            setCurrentMonth(addMonths(currentMonth, -1));
          }}
          type="button"
        >
          &larr;
        </button>
        <span className="font-medium text-[var(--marketplace-text)] text-sm">
          {monthNames[monthNum]} {yearNum}
        </span>
        <button
          className="rounded px-2 py-0.5 text-sm hover:bg-[#f5f0eb]"
          onClick={() => {
            setCurrentMonth(addMonths(currentMonth, 1));
          }}
          type="button"
        >
          &rarr;
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 gap-px text-center font-medium text-[10px] text-[var(--marketplace-text-muted)]">
        {dayLabels.map((label) => (
          <div className="py-0.5" key={label}>
            {label}
          </div>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <p className="animate-pulse text-[var(--marketplace-text-muted)] text-xs">
            {isEn ? "Loading..." : "Cargando..."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-px">
          {days.map((day) => {
            const dayDate = new Date(`${day.date}T00:00:00`);
            const isCurrentMonth =
              dayDate.getMonth() === monthNum &&
              dayDate.getFullYear() === yearNum;
            const dayNum = dayDate.getDate();

            return (
              <div
                className={cn(
                  "flex h-7 items-center justify-center text-[11px]",
                  !isCurrentMonth && "opacity-25"
                )}
                key={day.date}
              >
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full",
                    day.status === "available" &&
                      "bg-emerald-400/20 text-emerald-700 dark:text-emerald-400",
                    day.status === "booked" &&
                      "bg-red-400/20 text-red-600 dark:text-red-400",
                    day.status === "blocked" && "bg-gray-300/30 text-gray-400",
                    day.status === "past" &&
                      "text-[var(--marketplace-text-muted)]/40"
                  )}
                >
                  {dayNum}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-[var(--marketplace-text-muted)]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          {isEn ? "Available" : "Disponible"}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
          {isEn ? "Booked" : "Reservado"}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
          {isEn ? "Blocked" : "Bloqueado"}
        </span>
      </div>
    </div>
  );
}
