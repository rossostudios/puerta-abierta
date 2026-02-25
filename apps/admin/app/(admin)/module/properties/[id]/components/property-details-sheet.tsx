"use client";

import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { createContext, type ReactNode, useContext, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { humanizeKey } from "@/lib/format";
import { FOREIGN_KEY_HREF_BASE_BY_KEY } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { PropertyRelatedLink } from "../types";

/* ---------- helpers ---------- */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function asDateLabel(value: string, locale: "en-US" | "es-PY"): string | null {
  if (!(ISO_DATE_TIME_RE.test(value) || ISO_DATE_RE.test(value))) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;

  if (ISO_DATE_RE.test(value)) {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      date
    );
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toLabel(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/* ---------- field grouping ---------- */

type FieldGroup = "identity" | "location" | "system" | "other";

function classifyKey(key: string): FieldGroup {
  if (["id", "name", "title", "code", "status", "kind", "type"].includes(key))
    return "identity";
  if (
    /^address|^city$|^district$|^country$|^state$|^zip$|^postal$|^location$|^latitude$|^longitude$/.test(
      key
    )
  )
    return "location";
  if (
    key === "organization_id" ||
    key.endsWith("_at") ||
    key.endsWith("_on") ||
    (key.endsWith("_id") && key !== "id")
  )
    return "system";
  return "other";
}

const GROUP_ORDER: FieldGroup[] = ["identity", "other", "location", "system"];

const GROUP_HEADINGS: Record<FieldGroup, { en: string; es: string }> = {
  identity: { en: "Key details", es: "Datos clave" },
  other: { en: "Details", es: "Detalles" },
  location: { en: "Location", es: "Ubicación" },
  system: { en: "System", es: "Sistema" },
};

function groupKeys(keys: string[]) {
  const buckets: Record<FieldGroup, string[]> = {
    identity: [],
    other: [],
    location: [],
    system: [],
  };
  for (const key of keys) {
    buckets[classifyKey(key)].push(key);
  }
  return GROUP_ORDER.map((groupKey) => ({
    groupKey,
    fields: buckets[groupKey],
  }));
}

/* ---------- context ---------- */

const DetailsCtx = createContext<{
  open: boolean;
  toggle: (next?: boolean) => void;
}>({ open: false, toggle: () => undefined });

export function DetailsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <DetailsCtx.Provider
      value={{
        open,
        toggle: (next) =>
          setOpen((o) => (typeof next === "boolean" ? next : !o)),
      }}
    >
      {children}
    </DetailsCtx.Provider>
  );
}

/* ---------- trigger button (place in header) ---------- */

type DetailsTriggerProps = {
  isEn: boolean;
  fieldCount: number;
};

export function DetailsTrigger({ isEn, fieldCount }: DetailsTriggerProps) {
  const { open, toggle } = useContext(DetailsCtx);

  return (
    <Button
      className={cn(
        "h-9 gap-2 rounded-xl border-border/40 bg-background/40 px-3 hover:bg-background/80",
        open && "bg-background/80 ring-1 ring-primary/30"
      )}
      onClick={() => toggle()}
      size="sm"
      variant="outline"
    >
      <Icon icon={InformationCircleIcon} size={16} />
      <span className="hidden sm:inline">
        {isEn ? "View details" : "Ver detalles"}
      </span>
      <Badge
        className="h-5 min-w-5 px-1 font-mono text-[10px]"
        variant="secondary"
      >
        {fieldCount}
      </Badge>
    </Button>
  );
}

/* ---------- inline panel (place in page flow) ---------- */

type DetailsPanelProps = {
  record: Record<string, unknown>;
  keys: string[];
  locale: "en-US" | "es-PY";
  isEn: boolean;
  links: PropertyRelatedLink[];
  title: string;
};

export function DetailsPanel({
  record,
  keys,
  locale,
  isEn,
  links,
  title,
}: DetailsPanelProps) {
  const { open, toggle } = useContext(DetailsCtx);

  return (
    <Sheet
      description={
        isEn
          ? `${keys.length} fields · record details`
          : `${keys.length} campos · detalles del registro`
      }
      onOpenChange={toggle}
      open={open}
      side="right"
      title={title}
    >
      <div className="space-y-6">
        {/* Related workflows */}
        {links.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {isEn ? "Related workflows" : "Flujos relacionados"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {links.map((link) => (
                <Link
                  className="rounded-full border border-border/30 bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                  href={link.href}
                  key={link.href}
                  prefetch={false}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {/* Record fields — grouped */}
        {groupKeys(keys).map(({ groupKey, fields }) => {
          if (fields.length === 0) return null;
          const isSystem = groupKey === "system";
          const isIdentity = groupKey === "identity";
          const heading = isEn
            ? GROUP_HEADINGS[groupKey].en
            : GROUP_HEADINGS[groupKey].es;

          return (
            <div key={groupKey}>
              <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {heading}
              </p>
              <div>
                {fields.map((key, idx) => {
                  const value = record[key];
                  const text = typeof value === "string" ? value : null;
                  const dateLabel = text ? asDateLabel(text, locale) : null;
                  const isStatus =
                    key === "status" &&
                    typeof value === "string" &&
                    value.trim().length > 0;

                  const fkHref = (() => {
                    const directBase = FOREIGN_KEY_HREF_BASE_BY_KEY[key];
                    if (
                      directBase &&
                      typeof value === "string" &&
                      isUuid(value)
                    ) {
                      return `${directBase}/${value}`;
                    }

                    if (key.endsWith("_name")) {
                      const idKey = `${key.slice(0, -5)}_id`;
                      const rawId = record[idKey];
                      const base = FOREIGN_KEY_HREF_BASE_BY_KEY[idKey];
                      if (base && typeof rawId === "string" && isUuid(rawId)) {
                        return `${base}/${rawId}`;
                      }
                    }

                    return null;
                  })();

                  const showMonospace =
                    typeof value === "string" &&
                    (isUuid(value) || key === "id" || key.endsWith("_id"));

                  const isNameOrTitle =
                    isIdentity && (key === "name" || key === "title");
                  const isLast = idx === fields.length - 1;

                  return (
                    <div
                      className={cn(
                        "grid gap-1 md:grid-cols-12",
                        isSystem ? "px-0 py-2" : "px-0 py-3",
                        !isLast && "border-b border-border/30"
                      )}
                      key={key}
                    >
                      <div className="md:col-span-4">
                        <p className="text-[11px] text-muted-foreground">
                          {humanizeKey(key)}
                        </p>
                      </div>
                      <div className="md:col-span-8">
                        {value === null || value === undefined ? (
                          <p className="text-muted-foreground text-sm">-</p>
                        ) : isStatus ? (
                          <StatusBadge value={String(value)} />
                        ) : dateLabel ? (
                          <p
                            className={cn(
                              "text-foreground",
                              isSystem
                                ? "text-xs text-muted-foreground"
                                : "text-sm"
                            )}
                            title={String(value)}
                          >
                            {dateLabel}
                          </p>
                        ) : fkHref ? (
                          <Link
                            className={cn(
                              "inline-flex items-center text-primary underline-offset-4 hover:underline",
                              key.endsWith("_name")
                                ? "text-sm"
                                : "font-mono text-xs",
                              showMonospace && !key.endsWith("_name")
                                ? "break-all"
                                : "",
                              isSystem && "text-muted-foreground"
                            )}
                            href={fkHref}
                            prefetch={false}
                            title={isEn ? `Open ${key}` : `Abrir ${key}`}
                          >
                            {key.endsWith("_name")
                              ? String(value)
                              : shortId(String(value))}
                          </Link>
                        ) : typeof value === "boolean" ? (
                          key === "is_active" ? (
                            <StatusBadge
                              value={value ? "active" : "inactive"}
                            />
                          ) : (
                            <p className="text-foreground text-sm">
                              {value
                                ? isEn
                                  ? "Yes"
                                  : "Si"
                                : isEn
                                  ? "No"
                                  : "No"}
                            </p>
                          )
                        ) : typeof value === "number" ? (
                          <p className="text-foreground text-sm tabular-nums">
                            {new Intl.NumberFormat(locale, {
                              maximumFractionDigits: 2,
                            }).format(value)}
                          </p>
                        ) : typeof value === "object" ? (
                          <pre className="max-h-60 overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
                            {JSON.stringify(value, null, 2)}
                          </pre>
                        ) : (
                          <p
                            className={cn(
                              isNameOrTitle
                                ? "text-base font-semibold text-foreground"
                                : isSystem && showMonospace
                                  ? "break-all font-mono text-xs text-muted-foreground"
                                  : showMonospace
                                    ? "break-all font-mono text-xs text-foreground"
                                    : "break-words text-sm text-foreground"
                            )}
                          >
                            {toLabel(value)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/* ---------- legacy re-export for backwards compat ---------- */

export { DetailsProvider as PropertyDetailsProvider };
export { DetailsTrigger as PropertyDetailsTrigger };
export { DetailsPanel as PropertyDetailsPanel };
