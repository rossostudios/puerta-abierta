"use client";

import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type CalendarProps = {
  value?: string;
  onValueChange?: (value: string) => void;
  locale?: "es-PY" | "en-US";
  min?: string;
  max?: string;
  className?: string;
};

const WEEKDAY_COUNT = 7;
const GRID_DAY_COUNT = 42;

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const [rawYear, rawMonth, rawDay] = value.split("-");
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (
    !(
      Number.isInteger(year) &&
      Number.isInteger(month) &&
      Number.isInteger(day)
    )
  ) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1, 12, 0, 0, 0);
}

function addDays(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(value: Date, amount: number): Date {
  return new Date(
    value.getFullYear(),
    value.getMonth() + amount,
    1,
    12,
    0,
    0,
    0
  );
}

function isSameMonth(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  );
}

function weekStartsOnMonday(date: Date): Date {
  const dayIndex = (date.getDay() + 6) % 7;
  return addDays(date, -dayIndex);
}

function weekdayLabels(locale: "es-PY" | "en-US"): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const monday = weekStartsOnMonday(new Date(2026, 0, 5, 12, 0, 0, 0));
  return Array.from({ length: WEEKDAY_COUNT }, (_, index) => {
    return formatter.format(addDays(monday, index));
  });
}

function monthDays(displayMonth: Date): Date[] {
  const firstVisible = weekStartsOnMonday(monthStart(displayMonth));
  return Array.from({ length: GRID_DAY_COUNT }, (_, index) =>
    addDays(firstVisible, index)
  );
}

function clampMonth(
  nextMonth: Date,
  minDate: Date | null,
  maxDate: Date | null
): Date {
  if (minDate && nextMonth < monthStart(minDate)) {
    return monthStart(minDate);
  }
  if (maxDate && nextMonth > monthStart(maxDate)) {
    return monthStart(maxDate);
  }
  return nextMonth;
}

function isWithinRange(
  value: Date,
  minDate: Date | null,
  maxDate: Date | null
): boolean {
  const normalized = toIsoDate(value);
  if (minDate && normalized < toIsoDate(minDate)) return false;
  if (maxDate && normalized > toIsoDate(maxDate)) return false;
  return true;
}

export function Calendar({
  value,
  onValueChange,
  locale = "es-PY",
  min,
  max,
  className,
}: CalendarProps) {
  const minDate = useMemo(() => parseIsoDate(min), [min]);
  const maxDate = useMemo(() => parseIsoDate(max), [max]);
  const selectedDate = useMemo(() => parseIsoDate(value), [value]);

  const [displayMonth, setDisplayMonth] = useState<Date>(() => {
    const base = selectedDate ?? new Date();
    return monthStart(base);
  });

  // When the selected date changes, jump to its month (derive during render).
  const prevSelectedRef = useRef(selectedDate);
  if (selectedDate && selectedDate !== prevSelectedRef.current) {
    const target = monthStart(selectedDate);
    if (target.getTime() !== displayMonth.getTime()) {
      setDisplayMonth(target);
    }
  }
  prevSelectedRef.current = selectedDate;

  const labels = useMemo(() => weekdayLabels(locale), [locale]);
  const days = useMemo(() => monthDays(displayMonth), [displayMonth]);

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
    }).format(displayMonth);
  }, [displayMonth, locale]);

  const canGoPrev = !minDate || displayMonth > monthStart(minDate);
  const canGoNext = !maxDate || displayMonth < monthStart(maxDate);

  const todayIso = toIsoDate(new Date());
  const selectedIso = selectedDate ? toIsoDate(selectedDate) : "";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <Button
          aria-label={locale === "en-US" ? "Previous month" : "Mes anterior"}
          disabled={!canGoPrev}
          onClick={() =>
            setDisplayMonth((current) =>
              clampMonth(addMonths(current, -1), minDate, maxDate)
            )
          }
          size="icon"
          type="button"
          variant="ghost"
        >
          <Icon icon={ArrowLeft01Icon} size={14} />
        </Button>

        <p className="font-medium text-sm capitalize">{monthLabel}</p>

        <Button
          aria-label={locale === "en-US" ? "Next month" : "Mes siguiente"}
          disabled={!canGoNext}
          onClick={() =>
            setDisplayMonth((current) =>
              clampMonth(addMonths(current, 1), minDate, maxDate)
            )
          }
          size="icon"
          type="button"
          variant="ghost"
        >
          <Icon icon={ArrowRight01Icon} size={14} />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {labels.map((label) => (
          <div
            className="px-1 text-center text-[11px] text-muted-foreground uppercase"
            key={label}
          >
            {label}
          </div>
        ))}

        {days.map((day) => {
          const dayIso = toIsoDate(day);
          const outsideMonth = !isSameMonth(day, displayMonth);
          const isToday = dayIso === todayIso;
          const isSelected = dayIso === selectedIso;
          const disabled = !isWithinRange(day, minDate, maxDate);

          return (
            <button
              className={cn(
                "inline-flex h-9 items-center justify-center rounded-lg border text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isSelected
                  ? "border-foreground/20 bg-foreground text-background"
                  : "border-transparent text-foreground hover:bg-muted",
                outsideMonth && !isSelected ? "text-muted-foreground" : "",
                isToday && !isSelected ? "border-border" : "",
                disabled
                  ? "cursor-not-allowed opacity-40 hover:bg-transparent"
                  : ""
              )}
              disabled={disabled}
              key={dayIso}
              onClick={() => onValueChange?.(dayIso)}
              type="button"
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
