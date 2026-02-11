"use client";

import { ExternalLink, InboxIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { HoverLink } from "@/components/ui/hover-link";
import { Icon } from "@/components/ui/icon";
import { Sheet } from "@/components/ui/sheet";
import { humanizeKey } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { useActiveLocale } from "@/lib/i18n/client";
import { FOREIGN_KEY_HREF_BASE_BY_KEY } from "@/lib/links";
import { addRecent, togglePin } from "@/lib/shortcuts";
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

function asDateLabel(value: string, locale: Locale): string | null {
  if (!(ISO_DATE_TIME_RE.test(value) || ISO_DATE_RE.test(value))) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    ...(ISO_DATE_TIME_RE.test(value) ? { timeStyle: "short" } : {}),
  }).format(date);
}

function recordTitle(record: DataTableRow, locale: Locale): string {
  const candidate = (record.name ??
    record.title ??
    record.public_name ??
    record.code ??
    record.id) as unknown;
  const text =
    typeof candidate === "string" && candidate.trim() ? candidate.trim() : "";
  return text || (locale === "en-US" ? "Record" : "Registro");
}

function renderPrimitive(
  record: DataTableRow,
  key: string,
  value: unknown,
  locale: Locale
): ReactNode {
  const isEn = locale === "en-US";

  if (value === null || value === undefined)
    return <span className="text-muted-foreground">-</span>;

  if (typeof value === "string") {
    if (key === "status") {
      return (
        <Badge className="whitespace-nowrap" variant="secondary">
          {humanizeKey(value)}
        </Badge>
      );
    }

    const dateLabel = asDateLabel(value, locale);
    if (dateLabel) {
      return <span title={value}>{dateLabel}</span>;
    }

    if (key.endsWith("_name")) {
      const idKey = `${key.slice(0, -5)}_id`;
      const idValue = record[idKey];
      const base = FOREIGN_KEY_HREF_BASE_BY_KEY[idKey];
      if (base && typeof idValue === "string" && isUuid(idValue)) {
        return (
          <HoverLink
            className="text-primary underline-offset-4 hover:underline"
            description={isEn ? "Open details." : "Abrir detalles."}
            href={`${base}/${idValue}`}
            id={idValue}
            label={String(value)}
            meta={humanizeKey(idKey.slice(0, -3))}
          >
            {value}
          </HoverLink>
        );
      }
    }

    if ((key === "id" || key.endsWith("_id")) && isUuid(value)) {
      const base = key === "id" ? null : FOREIGN_KEY_HREF_BASE_BY_KEY[key];
      const href = base ? `${base}/${value}` : null;
      return (
        <span className="inline-flex items-center gap-2">
          {href ? (
            <HoverLink
              className="font-mono text-primary text-xs underline-offset-4 hover:underline"
              description={isEn ? "Open details." : "Abrir detalles."}
              href={href}
              id={value}
              label={humanizeKey(key)}
              meta={
                base
                  ? humanizeKey(
                      base
                        .split("/")
                        .filter(Boolean)
                        .pop()
                        ?.replaceAll("-", "_") ?? ""
                    )
                  : undefined
              }
            >
              {shortId(value)}
            </HoverLink>
          ) : (
            <span className="font-mono text-xs">{shortId(value)}</span>
          )}
          <CopyButton className="h-7 px-2 py-0 text-xs" value={value} />
        </span>
      );
    }

    return <span className="break-words">{value}</span>;
  }

  if (typeof value === "number") {
    return (
      <span className="tabular-nums">
        {new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
          value
        )}
      </span>
    );
  }

  if (typeof value === "boolean") {
    if (key === "is_active") {
      return (
        <Badge
          className="whitespace-nowrap"
          variant={value ? "secondary" : "outline"}
        >
          {value
            ? isEn
              ? "Active"
              : "Activo"
            : isEn
              ? "Inactive"
              : "Inactivo"}
        </Badge>
      );
    }
    return <span>{value ? (isEn ? "Yes" : "Sí") : "No"}</span>;
  }

  if (Array.isArray(value)) {
    return (
      <span className="text-muted-foreground">
        {isEn ? `List(${value.length})` : `Lista(${value.length})`}
      </span>
    );
  }

  return (
    <pre className="max-h-40 overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function RelationshipRail({
  record,
  locale,
}: {
  record: DataTableRow;
  locale: Locale;
}) {
  const isEn = locale === "en-US";

  const keys = [
    "organization_id",
    "property_id",
    "unit_id",
    "channel_id",
    "listing_id",
    "guest_id",
    "reservation_id",
    "task_id",
    "template_id",
  ];

  const items = keys
    .map((key) => {
      const raw = record[key];
      if (typeof raw !== "string" || !isUuid(raw)) return null;
      const base = FOREIGN_KEY_HREF_BASE_BY_KEY[key];
      if (!base) return null;
      const nameKey = `${key.slice(0, -3)}_name`;
      const rawName = record[nameKey];
      const name =
        typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;
      return { key, id: raw, href: `${base}/${raw}`, name };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!items.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <HoverLink
          className="inline-flex items-center gap-1 rounded-full border bg-background/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          description={
            isEn ? "Follow this relationship." : "Seguir esta relación."
          }
          href={item.href}
          id={item.id}
          key={item.key}
          label={item.name ?? humanizeKey(item.key.slice(0, -3))}
          meta={humanizeKey(item.key.slice(0, -3))}
        >
          <span className="font-medium">
            {humanizeKey(item.key.slice(0, -3))}
          </span>
          <span
            className={cn(
              "max-w-[14rem] truncate",
              item.name ? "" : "font-mono"
            )}
          >
            {item.name ?? shortId(item.id)}
          </span>
        </HoverLink>
      ))}
    </div>
  );
}

export function ModuleTableCard({
  moduleSlug,
  moduleLabel,
  moduleDescription,
  rows,
}: {
  moduleSlug: string;
  moduleLabel: string;
  moduleDescription: string;
  rows: DataTableRow[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<DataTableRow | null>(null);

  const rowHrefBase = `/module/${moduleSlug}`;

  const onRowClick = (next: DataTableRow) => {
    setRecord(next);
    setOpen(true);
    const id = typeof next.id === "string" ? next.id : null;
    if (id) {
      addRecent({
        href: `${rowHrefBase}/${id}`,
        label: recordTitle(next, locale),
        meta: moduleLabel,
      });
    }
  };

  const recordId = record && typeof record.id === "string" ? record.id : null;
  const recordHref = recordId ? `${rowHrefBase}/${recordId}` : rowHrefBase;
  const title = record ? recordTitle(record, locale) : moduleLabel;

  const onPin = () => {
    if (!recordId) return;
    const result = togglePin({
      href: recordHref,
      label: title,
      meta: moduleLabel,
    });
    toast.success(
      result.pinned
        ? isEn
          ? "Pinned"
          : "Fijado"
        : isEn
          ? "Unpinned"
          : "Desfijado",
      {
        description: title,
      }
    );
  };

  const orderedKeys = useMemo(() => {
    if (!record) return [];
    const keys = Object.keys(record);
    const priority = [
      "id",
      "name",
      "title",
      "code",
      "status",
      "kind",
      "organization_id",
      "property_id",
      "unit_id",
      "channel_id",
      "guest_id",
      "check_in_date",
      "check_out_date",
      "starts_on",
      "ends_on",
      "created_at",
      "updated_at",
    ];
    const score = new Map(priority.map((key, index) => [key, index]));
    return [...keys].sort((a, b) => {
      const aScore = score.has(a)
        ? (score.get(a) as number)
        : Number.POSITIVE_INFINITY;
      const bScore = score.has(b)
        ? (score.get(b) as number)
        : Number.POSITIVE_INFINITY;
      if (aScore !== bScore) return aScore - bScore;
      return a.localeCompare(b);
    });
  }, [record]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardDescription>{moduleDescription}</CardDescription>
            <CardTitle>{moduleLabel}</CardTitle>
          </div>
          <CardDescription>
            {rows.length} {isEn ? "records" : "registros"}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          {rows.length > 0 ? (
            <DataTable
              data={rows as unknown as Record<string, unknown>[]}
              locale={locale}
              onRowClick={onRowClick}
              rowHrefBase={rowHrefBase}
            />
          ) : (
            <div className="flex min-h-[400px] flex-col items-center justify-center p-8">
              <EmptyState
                action={
                  <Link
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                    href="/setup"
                  >
                    {isEn ? "Open setup" : "Abrir configuración"}
                  </Link>
                }
                description={
                  isEn
                    ? "Manage base records stored in Supabase. Use the setup manager to add, edit, or seed data."
                    : "Administra registros base guardados en Supabase. Usa el administrador para agregar, editar o cargar datos demo."
                }
                icon={InboxIcon}
                title={
                  isEn ? "No records found" : "No se encontraron registros"
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet
        contentClassName="max-w-full sm:max-w-xl"
        description={
          isEn
            ? "Open the full record, copy IDs, and follow relationships."
            : "Abrir el registro completo, copiar IDs y seguir relaciones."
        }
        footer={
          recordId ? (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                  href={recordHref}
                  prefetch={false}
                >
                  <Icon icon={ExternalLink} size={16} />
                  {isEn ? "Open page" : "Abrir página"}
                </Link>
                <Button
                  onClick={onPin}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isEn ? "Pin / unpin" : "Fijar / desfijar"}
                </Button>
              </div>
              <CopyButton
                label={isEn ? "Copy ID" : "Copiar ID"}
                value={recordId}
              />
            </div>
          ) : null
        }
        onOpenChange={(next) => (next ? setOpen(true) : setOpen(false))}
        open={open}
        title={
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{isEn ? "Details" : "Detalles"}</Badge>
              <Badge className="text-[11px]" variant="secondary">
                {moduleLabel}
              </Badge>
            </div>
            <p className="truncate font-semibold text-base">{title}</p>
          </div>
        }
      >
        {record ? (
          <div className="space-y-5">
            <RelationshipRail locale={locale} record={record} />

            <div className="divide-y rounded-md border">
              {orderedKeys.map((key) => (
                <div className="grid gap-2 p-4 md:grid-cols-12" key={key}>
                  <div className="md:col-span-4">
                    <p className="font-medium text-muted-foreground text-xs">
                      {humanizeKey(key)}
                    </p>
                  </div>
                  <div className="md:col-span-8">
                    <div
                      className={cn(
                        typeof record[key] === "string"
                          ? "text-foreground text-sm"
                          : ""
                      )}
                    >
                      {renderPrimitive(record, key, record[key], locale)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {isEn
              ? "Select a row to view details."
              : "Selecciona una fila para ver detalles."}
          </p>
        )}
      </Sheet>
    </>
  );
}
