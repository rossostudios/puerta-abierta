"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

import type { DataTableRow } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ApplicationRow } from "@/lib/features/applications/types";
import {
  asNumber,
  asString,
  formatDateTimeLabel,
  normalizeSlaStatus,
  qualificationBandClass,
  qualificationBandLabel,
  slaBadgeClass,
  slaBadgeLabel,
  statusBadgeClass,
} from "@/lib/features/applications/utils";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export function useApplicationColumns(
  isEn: boolean,
  locale: "es-PY" | "en-US"
): ColumnDef<DataTableRow>[] {
  return useMemo<ColumnDef<DataTableRow>[]>(() => {
    return [
      {
        accessorKey: "full_name",
        header: isEn ? "Applicant" : "Solicitante",
        cell: ({ row, getValue }) => {
          const name = asString(getValue()).trim();
          const email = asString(row.original.email).trim();
          const phone = asString(row.original.phone_e164).trim();
          return (
            <div className="space-y-1">
              <p className="font-medium">{name}</p>
              <p className="text-muted-foreground text-xs">{email}</p>
              {phone ? (
                <p className="text-muted-foreground text-xs">{phone}</p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "status_label",
        header: isEn ? "Status" : "Estado",
        cell: ({ row, getValue }) => {
          const applicationRow = row.original as ApplicationRow;
          const status = normalizeSlaStatus(applicationRow);
          return (
            <div className="space-y-1">
              <StatusBadge
                label={asString(getValue())}
                tone={statusBadgeClass(applicationRow.status)}
                value={applicationRow.status}
              />
              <StatusBadge
                label={slaBadgeLabel(status, isEn)}
                tone={slaBadgeClass(
                  status,
                  applicationRow.response_sla_alert_level
                )}
                value={status}
              />
            </div>
          );
        },
      },
      {
        accessorKey: "assigned_user_name",
        header: isEn ? "Assigned" : "Asignado",
        cell: ({ row }) => {
          const assignedName = asString(row.original.assigned_user_name).trim();
          const label = assignedName || (isEn ? "Unassigned" : "Sin asignar");
          return (
            <span className={cn(assignedName ? "" : "text-muted-foreground")}>
              {label}
            </span>
          );
        },
      },
      {
        accessorKey: "listing_title",
        header: isEn ? "Listing" : "Anuncio",
      },
      {
        accessorKey: "monthly_income",
        header: isEn ? "Income" : "Ingreso",
        cell: ({ getValue }) => {
          const amount = asNumber(getValue());
          if (amount <= 0) return "-";
          return formatCurrency(amount, "PYG", locale);
        },
      },
      {
        accessorKey: "qualification_score",
        header: isEn ? "Qualification" : "Calificación",
        cell: ({ row }) => {
          const score = asNumber(row.original.qualification_score);
          const band = asString(row.original.qualification_band);
          const ratio = asNumber(row.original.income_to_rent_ratio);
          return (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <StatusBadge
                  label={qualificationBandLabel(band, isEn)}
                  tone={qualificationBandClass(band)}
                  value={band}
                />
                <span className="font-medium text-xs">
                  {score > 0 ? `${score}/100` : "-"}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                {ratio > 0
                  ? `${isEn ? "Income/rent" : "Ingreso/renta"}: ${ratio.toFixed(2)}x`
                  : isEn
                    ? "Income/rent: n/a"
                    : "Ingreso/renta: n/d"}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: "first_response_minutes",
        header: isEn ? "First response (min)" : "Primera respuesta (min)",
        cell: ({ getValue }) => {
          const value = asNumber(getValue());
          return value > 0 ? `${value.toFixed(1)}m` : "-";
        },
      },
      {
        accessorKey: "created_at",
        header: isEn ? "Created" : "Creado",
        cell: ({ getValue }) =>
          formatDateTimeLabel(asString(getValue()), locale),
      },
      {
        accessorKey: "response_sla_due_at",
        header: isEn ? "SLA due" : "SLA vence",
        cell: ({ row }) => {
          const dueAt = asString(row.original.response_sla_due_at).trim();
          if (!dueAt) return "-";
          return formatDateTimeLabel(dueAt, locale);
        },
      },
    ];
  }, [isEn, locale]);
}
