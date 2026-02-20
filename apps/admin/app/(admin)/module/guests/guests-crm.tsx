"use client";

import { Add01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Sheet } from "@/components/ui/sheet";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

import { GuestDetailView } from "@/components/guests/guest-detail-view";
import { GuestForm } from "@/components/guests/guest-form";
import { GuestNotionTable } from "@/components/guests/guest-notion-table";
import type { GuestCrmRow, Segment, SheetMode } from "@/components/guests/guests-crm-types";
import { hasContact } from "@/components/guests/guests-crm-types";
import { GuestsSegments } from "@/components/guests/guests-segments";

import {
  createGuestAction,
  deleteGuestAction,
  updateGuestAction,
} from "./actions";

export type { GuestCrmRow } from "@/components/guests/guests-crm-types";

export function GuestsCrm({
  orgId,
  rows,
  successMessage,
  errorMessage,
}: {
  orgId: string;
  rows: GuestCrmRow[];
  successMessage?: string;
  errorMessage?: string;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const t = useCallback((en: string, es: string) => (isEn ? en : es), [isEn]);
  const router = useRouter();

  useEffect(() => {
    if (successMessage) {
      toast.success(successMessage);
      router.replace("/module/guests");
    } else if (errorMessage) {
      toast.error(errorMessage);
      router.replace("/module/guests");
    }
  }, [successMessage, errorMessage, router]);

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
      const rowNotesVal = row.notes != null ? row.notes : "";
      if (rowNotesVal.trim()) next.notes += 1;
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
      return rows.filter((row) => {
        const nVal = row.notes != null ? row.notes : "";
        return nVal.trim().length > 0;
      });
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
    const emailStr = record.email != null ? record.email : "";
    const phoneStr = record.phone_e164 != null ? record.phone_e164 : "";
    let contact = "";
    if (emailStr.trim()) {
      contact = emailStr.trim();
    } else if (phoneStr.trim()) {
      contact = phoneStr.trim();
    }
    if (contact) {
      return contact;
    }
    return t("No contact information yet.", "Aún no hay información de contacto.");
  })();

  return (
    <div className="space-y-4">
      <GuestsSegments
        counts={counts}
        onCreateClick={() => openSheet("create", null)}
        onSegmentChange={setSegment}
        segment={segment}
        t={t}
      />

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
        <GuestNotionTable
          isEn={isEn}
          locale={locale}
          onDelete={(guest) => {
            openSheet("view", guest);
            setDeleteArmed(true);
          }}
          onEdit={(guest) => openSheet("edit", guest)}
          onRowClick={(guest) => openSheet("view", guest)}
          rows={filteredRows}
        />
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
          <GuestDetailView
            deleteAction={deleteGuestAction}
            deleteArmed={deleteArmed}
            locale={locale}
            onDeleteArm={() => setDeleteArmed(true)}
            onEditClick={() => openSheet("edit", record)}
            record={record}
            t={t}
          />
        ) : (
          <GuestForm
            createAction={createGuestAction}
            mode={sheetMode}
            onCancel={closeSheet}
            orgId={orgId}
            record={record}
            updateAction={updateGuestAction}
          />
        )}
      </Sheet>
    </div>
  );
}
