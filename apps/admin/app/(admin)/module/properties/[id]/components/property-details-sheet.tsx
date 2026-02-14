"use client";

import {
  ArrowDown01Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
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

function asDateLabel(
  value: string,
  locale: "en-US" | "es-PY"
): string | null {
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

/* ---------- context ---------- */

const DetailsCtx = createContext<{
  open: boolean;
  toggle: () => void;
}>({ open: false, toggle: () => {} });

export function DetailsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <DetailsCtx.Provider value={{ open, toggle: () => setOpen((o) => !o) }}>
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
        "h-9 rounded-xl border-border/40 bg-background/40 px-3 gap-2 hover:bg-background/80",
        open && "bg-background/80 ring-1 ring-primary/30"
      )}
      onClick={toggle}
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
  const { open } = useContext(DetailsCtx);

  if (!open) return null;

  return (
    <Card className="border-border/60 bg-card/50 shadow-sm backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
      <Collapsible defaultOpen>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{title}</CardTitle>
            <CollapsibleTrigger className="inline-flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground">
              {keys.length} {isEn ? "fields" : "campos"}
              <Icon
                className="transition-transform [[data-state=closed]_&]:rotate-180"
                icon={ArrowDown01Icon}
                size={14}
              />
            </CollapsibleTrigger>
          </div>
          <p className="text-muted-foreground text-sm">
            {isEn
              ? `${keys.length} fields · record details`
              : `${keys.length} campos · detalles del registro`}
          </p>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Related workflows */}
            {links.length > 0 ? (
              <>
                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {isEn ? "RELATED WORKFLOWS" : "FLUJOS RELACIONADOS"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {links.map((link) => (
                      <Link
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "max-w-full"
                        )}
                        href={link.href}
                        key={link.href}
                        prefetch={false}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </div>
                <Separator />
              </>
            ) : null}

            {/* Record fields */}
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
                            key.endsWith("_name")
                              ? "text-sm"
                              : "font-mono text-xs",
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

/* ---------- legacy re-export for backwards compat ---------- */

export { DetailsProvider as PropertyDetailsProvider };
export { DetailsTrigger as PropertyDetailsTrigger };
export { DetailsPanel as PropertyDetailsPanel };
