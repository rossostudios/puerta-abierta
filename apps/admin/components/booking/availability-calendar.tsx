"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { cn } from "@/lib/utils";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

type DayStatus = "available" | "booked" | "blocked" | "past";

type CalendarDay = {
  date: string;
  status: DayStatus;
};

type AvailabilityCalendarProps = {
  orgSlug: string;
  unitId: string;
  isEn: boolean;
  brandColor?: string;
  onDateRangeSelect?: (checkIn: string, checkOut: string) => void;
};

const DAY_LABELS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LABELS_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

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

function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

export function AvailabilityCalendar({
  orgSlug,
  unitId,
  isEn,
  brandColor,
  onDateRangeSelect,
}: AvailabilityCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedCheckIn, setSelectedCheckIn] = useState<string | null>(null);
  const [selectedCheckOut, setSelectedCheckOut] = useState<string | null>(null);

  const monthKey = toMonthKey(currentMonth);
  const monthNames = isEn ? MONTH_NAMES_EN : MONTH_NAMES_ES;
  const dayLabels = isEn ? DAY_LABELS_EN : DAY_LABELS_ES;

  const { data: days = [], isLoading: loading } = useQuery({
    queryKey: ["booking-calendar", orgSlug, unitId, monthKey],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/public/booking/${encodeURIComponent(orgSlug)}/calendar?unit_id=${encodeURIComponent(unitId)}&month=${monthKey}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (data.days != null) {
        return data.days as CalendarDay[];
      }
      return [];
    },
    enabled: !!unitId,
  });

  const handleDayClick = (day: CalendarDay) => {
    if (day.status !== "available") return;

    if (!selectedCheckIn || (selectedCheckIn && selectedCheckOut)) {
      // Start new selection
      setSelectedCheckIn(day.date);
      setSelectedCheckOut(null);
    } else if (day.date <= selectedCheckIn) {
      // Restart selection from an earlier date.
      setSelectedCheckIn(day.date);
      setSelectedCheckOut(null);
    } else {
      // Complete selection
      // Verify no booked/blocked days in between
      const inBetween = days.filter(
        (d) => d.date > selectedCheckIn && d.date < day.date
      );
      const hasBlocker = inBetween.some(
        (d) => d.status === "booked" || d.status === "blocked"
      );
      if (hasBlocker) {
        // Reset and select this day as new check-in
        setSelectedCheckIn(day.date);
        setSelectedCheckOut(null);
      } else {
        setSelectedCheckOut(day.date);
        onDateRangeSelect?.(selectedCheckIn, day.date);
      }
    }
  };

  const isInRange = (date: string) => {
    if (!(selectedCheckIn && selectedCheckOut)) return false;
    return date >= selectedCheckIn && date <= selectedCheckOut;
  };

  const isRangeEdge = (date: string) => {
    return date === selectedCheckIn || date === selectedCheckOut;
  };

  // Determine which dates belong to the current month
  const monthNum = currentMonth.getMonth();
  const yearNum = currentMonth.getFullYear();

  return (
    <div className="rounded-xl border bg-card p-4">
      {/* Month nav */}
      <div className="mb-3 flex items-center justify-between">
        <button
          className="rounded-lg px-2 py-1 text-sm hover:bg-muted"
          onClick={() => {
            setCurrentMonth(addMonths(currentMonth, -1));
          }}
          type="button"
        >
          &larr;
        </button>
        <h3 className="font-medium text-sm">
          {monthNames[monthNum]} {yearNum}
        </h3>
        <button
          className="rounded-lg px-2 py-1 text-sm hover:bg-muted"
          onClick={() => {
            setCurrentMonth(addMonths(currentMonth, 1));
          }}
          type="button"
        >
          &rarr;
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 gap-px text-center font-medium text-[11px] text-muted-foreground">
        {dayLabels.map((label) => (
          <div className="py-1" key={label}>
            {label}
          </div>
        ))}
      </div>

      {/* Day grid */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <p className="animate-pulse text-muted-foreground text-sm">
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
            const clickable = day.status === "available";
            const inRange = isInRange(day.date);
            const edge = isRangeEdge(day.date);

            return (
              <button
                className={cn(
                  "relative flex h-9 items-center justify-center rounded text-xs transition-colors",
                  !isCurrentMonth && "opacity-30",
                  day.status === "past" && "text-muted-foreground/50",
                  day.status === "available" &&
                    "cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/30",
                  day.status === "booked" &&
                    "bg-red-100/60 text-red-600 dark:bg-red-900/20 dark:text-red-400",
                  day.status === "blocked" &&
                    "bg-muted/40 text-muted-foreground line-through",
                  inRange && !edge && "bg-emerald-50 dark:bg-emerald-900/20",
                  edge && "font-semibold text-white"
                )}
                disabled={!clickable}
                key={day.date}
                onClick={() => handleDayClick(day)}
                style={
                  edge
                    ? { backgroundColor: brandColor || "#FF5D46" }
                    : undefined
                }
                type="button"
              >
                {dayNum}
              </button>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
          {isEn ? "Available" : "Disponible"}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-400" />
          {isEn ? "Booked" : "Reservado"}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted" />
          {isEn ? "Blocked" : "Bloqueado"}
        </span>
      </div>

      {selectedCheckIn && selectedCheckOut ? (
        <div className="mt-2 text-muted-foreground text-xs">
          {selectedCheckIn} &rarr; {selectedCheckOut}
        </div>
      ) : selectedCheckIn ? (
        <div className="mt-2 text-muted-foreground text-xs">
          {isEn ? "Select check-out date" : "Selecciona fecha de salida"}
        </div>
      ) : null}
    </div>
  );
}
