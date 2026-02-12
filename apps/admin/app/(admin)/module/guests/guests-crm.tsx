"use client";

import {
  Add01Icon,
  CalendarCheckIn01Icon,
  Delete02Icon,
  NoteEditIcon,
  PencilEdit01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Form } from "@/components/ui/form";
import { HoverLink } from "@/components/ui/hover-link";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

import {
  createGuestAction,
  deleteGuestAction,
  updateGuestAction,
} from "./actions";

export type GuestCrmRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone_e164: string | null;
  document_type: string | null;
  document_number: string | null;
  country_code: string | null;
  preferred_language: string | null;
  notes: string | null;
  reservation_count: number;
  last_stay_end: string | null;
  next_stay_start: string | null;
  lifetime_value: number;
};

type Segment = "all" | "upcoming" | "returning" | "no_contact" | "notes";
type SheetMode = "create" | "view" | "edit";

function asDateLabel(locale: string, value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function initials(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "?";
  const parts = trimmed
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts.at(-1)?.[0] : "";
  return `${first}${second}`.toUpperCase();
}

function SegmentButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-primary/30 bg-primary/10 text-foreground"
          : "bg-background/60 text-muted-foreground hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      <span className="font-medium">{label}</span>
      <span className="rounded-full bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
        {count}
      </span>
    </button>
  );
}

function hasContact(row: GuestCrmRow): boolean {
  return Boolean((row.email ?? "").trim() || (row.phone_e164 ?? "").trim());
}

export function GuestsCrm({
  orgId,
  rows,
}: {
  orgId: string;
  rows: GuestCrmRow[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const t = useCallback((en: string, es: string) => (isEn ? en : es), [isEn]);

  const [segment, setSegment] = useState<Segment>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>("view");
  const [record, setRecord] = useState<GuestCrmRow | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const counts = useMemo(() => {
    const next = {
      all: rows.length,
      upcoming: 0,
      returning: 0,
      no_contact: 0,
      notes: 0,
    };

    for (const row of rows) {
      if (row.next_stay_start) next.upcoming += 1;
      if (row.reservation_count > 1) next.returning += 1;
      if (!hasContact(row)) next.no_contact += 1;
      if ((row.notes ?? "").trim()) next.notes += 1;
    }

    return next;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (segment === "all") return rows;
    if (segment === "upcoming")
      return rows.filter((row) => row.next_stay_start);
    if (segment === "returning")
      return rows.filter((row) => row.reservation_count > 1);
    if (segment === "no_contact") return rows.filter((row) => !hasContact(row));
    if (segment === "notes")
      return rows.filter((row) => (row.notes ?? "").trim().length > 0);
    return rows;
  }, [rows, segment]);

  const openSheet = (mode: SheetMode, next: GuestCrmRow | null) => {
    setDeleteArmed(false);
    setSheetMode(mode);
    setRecord(next);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setDeleteArmed(false);
    setSheetOpen(false);
    window.setTimeout(() => {
      setRecord(null);
      setSheetMode("view");
    }, 200);
  };

  const columns = useMemo<ColumnDef<DataTableRow>[]>(() => {
    return [
      {
        id: "guest",
        header: t("Guest", "Huésped"),
        accessorFn: (row) => String((row as GuestCrmRow).full_name ?? ""),
        cell: ({ row }) => {
          const guest = row.original as GuestCrmRow;
          const href = `/module/guests/${guest.id}`;
          const contact =
            (guest.email ?? "").trim() ||
            (guest.phone_e164 ?? "").trim() ||
            t("No contact", "Sin contacto");

          return (
            <div className="min-w-0">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/20 font-semibold text-primary">
                  {initials(guest.full_name)}
                </div>
                <div className="min-w-0">
                  <HoverLink
                    className="block max-w-[22rem] truncate font-medium text-foreground underline-offset-4 hover:underline"
                    description={t(
                      "Open guest CRM profile.",
                      "Abrir el perfil CRM del huésped."
                    )}
                    href={href}
                    id={guest.id}
                    label={guest.full_name}
                    meta={t("Guest", "Huésped")}
                    prefetch={false}
                  >
                    {guest.full_name}
                  </HoverLink>
                  <p className="max-w-[22rem] truncate text-muted-foreground text-xs">
                    {contact}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {guest.next_stay_start ? (
                      <Badge className="gap-1" variant="secondary">
                        <Icon icon={CalendarCheckIn01Icon} size={14} />
                        {t("Upcoming", "Próxima")}
                      </Badge>
                    ) : null}
                    {guest.reservation_count > 1 ? (
                      <Badge variant="outline">
                        {t("Returning", "Recurrente")}
                      </Badge>
                    ) : null}
                    {(guest.notes ?? "").trim() ? (
                      <Badge className="gap-1" variant="outline">
                        <Icon icon={NoteEditIcon} size={14} />
                        {t("Notes", "Notas")}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "stays",
        header: t("Stays", "Estancias"),
        accessorFn: (row) => (row as GuestCrmRow).reservation_count,
        cell: ({ row }) => {
          const guest = row.original as GuestCrmRow;
          return (
            <span className="inline-flex items-center rounded-full border bg-background/60 px-2 py-1 font-mono text-[11px]">
              {guest.reservation_count}
            </span>
          );
        },
      },
      {
        id: "next",
        header: t("Next stay", "Próxima estancia"),
        accessorFn: (row) => (row as GuestCrmRow).next_stay_start ?? "",
        cell: ({ row }) => {
          const guest = row.original as GuestCrmRow;
          const label = asDateLabel(locale, guest.next_stay_start);
          return label ? (
            <span title={guest.next_stay_start ?? undefined}>{label}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
      },
      {
        id: "last",
        header: t("Last stay", "Última estancia"),
        accessorFn: (row) => (row as GuestCrmRow).last_stay_end ?? "",
        cell: ({ row }) => {
          const guest = row.original as GuestCrmRow;
          const label = asDateLabel(locale, guest.last_stay_end);
          return label ? (
            <span title={guest.last_stay_end ?? undefined}>{label}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
      },
      {
        id: "value",
        header: "LTV",
        accessorFn: (row) => (row as GuestCrmRow).lifetime_value,
        cell: ({ row }) => {
          const guest = row.original as GuestCrmRow;
          return (
            <span className="tabular-nums">
              {formatCurrency(guest.lifetime_value, "PYG", locale)}
            </span>
          );
        },
      },
    ];
  }, [locale, t]);

  const recordHref = record ? `/module/guests/${record.id}` : "/module/guests";
  const recordReservationsHref = record
    ? `/module/reservations?guest_id=${encodeURIComponent(record.id)}`
    : "/module/reservations";

  const sheetTitle = (() => {
    if (sheetMode === "create") return t("New guest", "Nuevo huésped");
    if (!record) return t("Guest details", "Detalles del huésped");
    return record.full_name;
  })();

  const sheetDescription = (() => {
    if (sheetMode === "create") {
      return t(
        "Add a contact for future reservations and messaging.",
        "Agrega un contacto para futuras reservas y mensajería."
      );
    }
    if (!record) return "";
    const contact =
      (record.email ?? "").trim() || (record.phone_e164 ?? "").trim() || "";
    return contact
      ? contact
      : t("No contact information yet.", "Aún no hay información de contacto.");
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentButton
            active={segment === "all"}
            count={counts.all}
            label={t("All", "Todos")}
            onClick={() => setSegment("all")}
          />
          <SegmentButton
            active={segment === "upcoming"}
            count={counts.upcoming}
            label={t("Upcoming", "Próximos")}
            onClick={() => setSegment("upcoming")}
          />
          <SegmentButton
            active={segment === "returning"}
            count={counts.returning}
            label={t("Returning", "Recurrentes")}
            onClick={() => setSegment("returning")}
          />
          <SegmentButton
            active={segment === "notes"}
            count={counts.notes}
            label={t("Notes", "Notas")}
            onClick={() => setSegment("notes")}
          />
          <SegmentButton
            active={segment === "no_contact"}
            count={counts.no_contact}
            label={t("No contact", "Sin contacto")}
            onClick={() => setSegment("no_contact")}
          />
        </div>

        <Button
          className="gap-2"
          onClick={() => openSheet("create", null)}
          type="button"
          variant="secondary"
        >
          <Icon icon={Add01Icon} size={16} />
          {t("New guest", "Nuevo huésped")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          action={
            <Button
              className="gap-2"
              onClick={() => openSheet("create", null)}
              type="button"
              variant="secondary"
            >
              <Icon icon={Add01Icon} size={16} />
              {t("Create guest", "Crear huésped")}
            </Button>
          }
          className="rounded-lg border border-dashed bg-muted/10 py-16"
          description={t(
            "Add your first guest to track stay history and lifetime value.",
            "Agrega tu primer huésped para comenzar a seguir historial de estancias y valor de por vida."
          )}
          icon={UserGroupIcon}
          title={t("No guests yet", "Aún no hay huéspedes")}
        />
      ) : (
        <div className="rounded-lg border bg-background/40 p-3">
          <DataTable
            columns={columns}
            data={filteredRows}
            defaultPageSize={20}
            onRowClick={(row) => openSheet("view", row as GuestCrmRow)}
            rowHrefBase="/module/guests"
            searchPlaceholder={t("Search guests...", "Buscar huéspedes...")}
          />
        </div>
      )}

      <Sheet
        contentClassName="max-w-full sm:max-w-xl"
        description={sheetDescription}
        footer={
          sheetMode === "view" && record ? (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                  href={recordHref}
                  prefetch={false}
                >
                  {t("Open profile", "Abrir perfil")}
                </Link>
                <Link
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" })
                  )}
                  href={recordReservationsHref}
                  prefetch={false}
                >
                  {t("Reservations", "Reservas")}
                </Link>
              </div>
              <CopyButton label={t("Copy ID", "Copiar ID")} value={record.id} />
            </div>
          ) : null
        }
        onOpenChange={(next) => (next ? setSheetOpen(true) : closeSheet())}
        open={sheetOpen}
        title={
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {sheetMode === "create"
                  ? t("Create", "Crear")
                  : t("Guest", "Huésped")}
              </Badge>
              <Badge className="text-[11px]" variant="secondary">
                CRM
              </Badge>
            </div>
            <p className="truncate font-semibold text-base">{sheetTitle}</p>
          </div>
        }
      >
        {sheetMode === "view" && record ? (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/10 p-3">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  {t("Reservations", "Reservas")}
                </p>
                <p className="mt-1 font-semibold text-xl tabular-nums">
                  {record.reservation_count}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/10 p-3">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  {t("Lifetime value", "Valor de por vida")}
                </p>
                <p className="mt-1 font-semibold text-xl tabular-nums">
                  {formatCurrency(record.lifetime_value, "PYG", locale)}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/10 p-3">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  {t("Next stay", "Próxima estancia")}
                </p>
                <p className="mt-1 font-medium text-sm">
                  {asDateLabel(locale, record.next_stay_start) ?? "-"}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/10 p-3">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  {t("Last stay", "Última estancia")}
                </p>
                <p className="mt-1 font-medium text-sm">
                  {asDateLabel(locale, record.last_stay_end) ?? "-"}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-medium text-foreground text-sm">
                {t("Contact", "Contacto")}
              </p>
              <div className="grid gap-2">
                <ContactLine
                  label={t("Email", "Correo")}
                  value={record.email}
                />
                <ContactLine
                  label={t("Phone", "Teléfono")}
                  value={record.phone_e164}
                />
                <ContactLine
                  label={t("Language", "Idioma")}
                  value={record.preferred_language}
                />
                <ContactLine
                  label={t("Document", "Documento")}
                  value={
                    [
                      (record.document_type ?? "").trim(),
                      (record.document_number ?? "").trim(),
                    ]
                      .filter(Boolean)
                      .join(" ") || null
                  }
                />
                <ContactLine
                  label={t("Country", "País")}
                  value={record.country_code}
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-medium text-foreground text-sm">
                {t("Notes", "Notas")}
              </p>
              {(record.notes ?? "").trim() ? (
                <div className="rounded-md border bg-muted/10 p-3 text-foreground text-sm">
                  <p className="whitespace-pre-wrap">{record.notes}</p>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t(
                    "No notes yet. Add preferences and details to personalize stays.",
                    "Aún no hay notas. Agrega preferencias y detalles para personalizar estancias."
                  )}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                className="gap-2"
                onClick={() => openSheet("edit", record)}
                type="button"
                variant="secondary"
              >
                <Icon icon={PencilEdit01Icon} size={16} />
                {t("Edit guest", "Editar huésped")}
              </Button>

              <Form action={deleteGuestAction}>
                <input name="id" type="hidden" value={record.id} />
                <input name="next" type="hidden" value="/module/guests" />
                {deleteArmed ? (
                  <Button className="gap-2" type="submit" variant="destructive">
                    <Icon icon={Delete02Icon} size={16} />
                    {t("Confirm deletion", "Confirmar eliminación")}
                  </Button>
                ) : (
                  <Button
                    className="gap-2"
                    onClick={() => setDeleteArmed(true)}
                    type="button"
                    variant="outline"
                  >
                    <Icon icon={Delete02Icon} size={16} />
                    {t("Delete", "Eliminar")}
                  </Button>
                )}
              </Form>
            </div>
          </div>
        ) : (
          <GuestForm
            mode={sheetMode}
            onCancel={closeSheet}
            orgId={orgId}
            record={record}
          />
        )}
      </Sheet>
    </div>
  );
}

function ContactLine({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  const text = (value ?? "").trim();
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-background/40 px-3 py-2">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="max-w-[70%] truncate text-right font-medium text-foreground text-sm">
        {text || "-"}
      </p>
    </div>
  );
}

function GuestForm({
  mode,
  orgId,
  record,
  onCancel,
}: {
  mode: SheetMode;
  orgId: string;
  record: GuestCrmRow | null;
  onCancel: () => void;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const t = useCallback((en: string, es: string) => (isEn ? en : es), [isEn]);

  const isCreate = mode === "create";
  const action = isCreate ? createGuestAction : updateGuestAction;

  return (
    <Form action={action} className="grid gap-4">
      <input name="next" type="hidden" value="/module/guests" />
      {isCreate ? (
        <input name="organization_id" type="hidden" value={orgId} />
      ) : (
        <input name="id" type="hidden" value={record?.id ?? ""} />
      )}

      <div className="grid gap-1">
        <label className="font-medium text-xs">
          {t("Full name", "Nombre completo")}
        </label>
        <Input
          defaultValue={record?.full_name ?? ""}
          name="full_name"
          placeholder="Ana Perez"
          required
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="font-medium text-xs">Email</label>
          <Input
            defaultValue={record?.email ?? ""}
            name="email"
            placeholder="ana@example.com"
            type="email"
          />
        </div>
        <div className="grid gap-1">
          <label className="font-medium text-xs">
            {t("Phone", "Teléfono")}
          </label>
          <Input
            defaultValue={record?.phone_e164 ?? ""}
            name="phone_e164"
            placeholder="+595981000000"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <label className="font-medium text-xs">
            {t("Document type", "Tipo de documento")}
          </label>
          <Input
            defaultValue={record?.document_type ?? ""}
            name="document_type"
            placeholder="passport"
          />
        </div>
        <div className="grid gap-1">
          <label className="font-medium text-xs">
            {t("Document number", "Número de documento")}
          </label>
          <Input
            defaultValue={record?.document_number ?? ""}
            name="document_number"
            placeholder="123456789"
          />
        </div>
        <div className="grid gap-1">
          <label className="font-medium text-xs">{t("Country", "País")}</label>
          <Input
            defaultValue={record?.country_code ?? ""}
            maxLength={2}
            name="country_code"
            placeholder="PY"
          />
        </div>
      </div>

      <div className="grid gap-1">
        <label className="font-medium text-xs">
          {t("Preferred language", "Idioma preferido")}
        </label>
        <Input
          defaultValue={record?.preferred_language ?? "es"}
          name="preferred_language"
          placeholder={isEn ? "en" : "es"}
        />
      </div>

      <div className="grid gap-1">
        <label className="font-medium text-xs">{t("Notes", "Notas")}</label>
        <Textarea
          defaultValue={record?.notes ?? ""}
          name="notes"
          placeholder={t(
            "Preferences, special requests, document details...",
            "Preferencias, pedidos especiales, datos de documentos..."
          )}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button onClick={onCancel} type="button" variant="ghost">
          {t("Cancel", "Cancelar")}
        </Button>
        <Button className="gap-2" type="submit" variant="secondary">
          <Icon icon={isCreate ? Add01Icon : PencilEdit01Icon} size={16} />
          {isCreate
            ? t("Create guest", "Crear huésped")
            : t("Save changes", "Guardar cambios")}
        </Button>
      </div>
    </Form>
  );
}
