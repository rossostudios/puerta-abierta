"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import { Calendar02Icon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  placeholder?: string;
  locale?: "es-PY" | "en-US";
  allowClear?: boolean;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isIsoDate(value: string): boolean {
  return ISO_DATE_RE.test(value);
}

function clampDate(value: string, min?: string, max?: string): string {
  if (!isIsoDate(value)) return "";
  if (min && isIsoDate(min) && value < min) return min;
  if (max && isIsoDate(max) && value > max) return max;
  return value;
}

function formatDateLabel(
  value: string,
  locale: "es-PY" | "en-US",
  placeholder: string
): string {
  if (!value) return placeholder;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.valueOf())) return placeholder;

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function DatePicker({
  value,
  defaultValue,
  onValueChange,
  name,
  id,
  className,
  disabled = false,
  min,
  max,
  placeholder,
  locale = "es-PY",
  allowClear = true,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");

  const isControlled = value !== undefined;
  const resolvedValue = isControlled ? value : internalValue;

  const defaultPlaceholder =
    locale === "en-US" ? "Select date" : "Seleccionar fecha";
  const placeholderLabel = placeholder ?? defaultPlaceholder;

  const label = useMemo(
    () => formatDateLabel(resolvedValue, locale, placeholderLabel),
    [locale, placeholderLabel, resolvedValue]
  );

  function updateValue(next: string) {
    const bounded = clampDate(next, min, max);
    if (!isControlled) {
      setInternalValue(bounded);
    }
    onValueChange?.(bounded);
  }

  function setToday() {
    const today = clampDate(toIsoDate(new Date()), min, max);
    updateValue(today);
    setOpen(false);
  }

  function clearDate() {
    updateValue("");
  }

  return (
    <>
      {name ? <input name={name} type="hidden" value={resolvedValue} /> : null}
      <BasePopover.Root onOpenChange={setOpen} open={open}>
        <BasePopover.Trigger
          className={cn(
            "inline-flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 py-1 text-left text-sm shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50",
            resolvedValue ? "text-foreground" : "text-muted-foreground",
            className
          )}
          disabled={disabled}
          id={id}
          type="button"
        >
          <span className="truncate">{label}</span>
          <Icon
            className="text-muted-foreground"
            icon={Calendar02Icon}
            size={15}
          />
        </BasePopover.Trigger>

        <BasePopover.Portal>
          <BasePopover.Positioner
            align="start"
            collisionPadding={8}
            side="bottom"
            sideOffset={8}
          >
            <BasePopover.Popup
              className={(state) =>
                cn(
                  "glass-float z-50 w-[min(92vw,18rem)] rounded-2xl p-3 text-popover-foreground",
                  "transition-[opacity,transform] duration-[140ms] ease-[var(--shell-ease)] motion-reduce:transition-none",
                  state.open
                    ? "translate-y-0 opacity-100"
                    : "translate-y-1 opacity-0"
                )
              }
            >
              <div className="space-y-3">
                <Calendar
                  locale={locale}
                  max={max}
                  min={min}
                  onValueChange={(next) => {
                    updateValue(next);
                    setOpen(false);
                  }}
                  value={resolvedValue}
                />

                <div className="flex items-center justify-between gap-2">
                  <Button
                    disabled={!(allowClear && resolvedValue)}
                    onClick={clearDate}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {locale === "en-US" ? "Clear" : "Limpiar"}
                  </Button>
                  <Button
                    disabled={!clampDate(toIsoDate(new Date()), min, max)}
                    onClick={setToday}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {locale === "en-US" ? "Today" : "Hoy"}
                  </Button>
                </div>
              </div>
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>
    </>
  );
}
