"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { humanizeKey } from "@/lib/format";
import { FOREIGN_KEY_HREF_BASE_BY_KEY } from "@/lib/links";
import { cn } from "@/lib/utils";

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

type PropertyDetailsCardProps = {
  record: Record<string, unknown>;
  keys: string[];
  locale: "en-US" | "es-PY";
  isEn: boolean;
};

export function PropertyDetailsCard({
  record,
  keys,
  locale,
  isEn,
}: PropertyDetailsCardProps) {
  return (
    <Card>
      <Collapsible defaultOpen={false}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{isEn ? "Details" : "Detalles"}</CardTitle>
            <CollapsibleTrigger className="inline-flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground">
              {keys.length} {isEn ? "fields" : "campos"}
              <Icon
                className="transition-transform [[data-panel-open]_&]:rotate-180"
                icon={ArrowDown01Icon}
                size={14}
              />
            </CollapsibleTrigger>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="divide-y rounded-md border">
              {keys.map((key) => {
                const value = record[key];
                const text = typeof value === "string" ? value : null;
                const dateLabel = text ? asDateLabel(text, locale) : null;
                const isStatus =
                  key === "status" &&
                  typeof value === "string" &&
                  value.trim().length > 0;

                const fkHref = (() => {
                  const directBase = FOREIGN_KEY_HREF_BASE_BY_KEY[key];
                  if (directBase && typeof value === "string" && isUuid(value)) {
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

                return (
                  <div className="grid gap-2 p-4 md:grid-cols-12" key={key}>
                    <div className="md:col-span-4">
                      <p className="font-medium text-muted-foreground text-xs">
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
                          className="text-foreground text-sm"
                          title={String(value)}
                        >
                          {dateLabel}
                        </p>
                      ) : fkHref ? (
                        <Link
                          className={cn(
                            "inline-flex items-center text-primary underline-offset-4 hover:underline",
                            key.endsWith("_name") ? "text-sm" : "font-mono text-xs",
                            showMonospace && !key.endsWith("_name")
                              ? "break-all"
                              : ""
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
                          <StatusBadge value={value ? "active" : "inactive"} />
                        ) : (
                          <p className="text-foreground text-sm">
                            {value ? (isEn ? "Yes" : "Si") : isEn ? "No" : "No"}
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
                            "text-foreground text-sm",
                            showMonospace
                              ? "break-all font-mono text-xs"
                              : "break-words"
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
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
