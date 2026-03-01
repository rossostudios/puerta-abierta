/**
 * Shared helpers used across module-manager components and page.tsx files.
 *
 * These were previously duplicated in every *-manager.tsx and page.tsx.
 */
import type { ReactNode } from "react";
import { formatCurrency } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Animation                                                          */
/* ------------------------------------------------------------------ */

/** Standard ease-out curve used by all module managers. */
export const EASING = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/* Text helpers                                                       */
/* ------------------------------------------------------------------ */

/** Parse **bold** markdown-style markers into <strong> elements. */
export function bold(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((s, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-foreground">
            {s}
          </strong>
        ) : (
          s
        ),
      )}
    </>
  );
}

/** Extract up to 2 initials from a name. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

/* ------------------------------------------------------------------ */
/* Currency                                                           */
/* ------------------------------------------------------------------ */

/** Format a PYG amount with the ₲ symbol. */
export function fmtPyg(amount: number, locale = "es-PY"): string {
  return formatCurrency(amount, "PYG", locale).replace(/PYG\s?/, "₲");
}

/* ------------------------------------------------------------------ */
/* Date                                                               */
/* ------------------------------------------------------------------ */

/** Today's date as YYYY-MM-DD. */
export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Calendar days remaining until a given ISO date. */
export function daysRemaining(endsOn: string | null): number | null {
  if (!endsOn) return null;
  const end = new Date(endsOn);
  const now = new Date();
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/* ------------------------------------------------------------------ */
/* Encoding                                                           */
/* ------------------------------------------------------------------ */

/** Safe URI decoding that returns the input on failure. */
export function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/* ------------------------------------------------------------------ */
/* Type coercion                                                      */
/* ------------------------------------------------------------------ */

/** Coerce unknown API value to string. Non-string truthy values are stringified. */
export function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

/** Coerce unknown API value to finite number, defaulting to 0. */
export function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Coerce to trimmed string, returning null when empty. */
export function asOptionalString(value: unknown): string | null {
  const text = asString(value).trim();
  return text || null;
}
