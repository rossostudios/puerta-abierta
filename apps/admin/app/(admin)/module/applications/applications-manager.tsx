"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import {
  assignApplicationAction,
  convertApplicationToLeaseAction,
  setApplicationStatusAction,
} from "@/app/(admin)/module/applications/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { Select } from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const RESPONSE_SLA_TARGET_MINUTES = 120;

type ApplicationRow = DataTableRow & {
  id: string;
  full_name: string;
  email: string;
  phone_e164: string | null;
  status: string;
  status_label: string;
  marketplace_listing_title: string;
  monthly_income: number;
  first_response_minutes: number;
  created_at: string;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  response_sla_status: string;
  response_sla_due_at: string | null;
};

type MemberOption = {
  user_id: string;
  label: string;
};

type MessageTemplateOption = {
  id: string;
  channel: string;
  template_key: string;
  name: string;
  subject: string;
  body: string;
  is_active: boolean;
};

type BoardLane = {
  key: string;
  label: {
    "es-PY": string;
    "en-US": string;
  };
  statuses: string[];
};

const BOARD_LANES: BoardLane[] = [
  {
    key: "incoming",
    label: {
      "es-PY": "Ingresos",
      "en-US": "Incoming",
    },
    statuses: ["new", "screening"],
  },
  {
    key: "qualified",
    label: {
      "es-PY": "Calificación",
      "en-US": "Qualified",
    },
    statuses: ["qualified", "visit_scheduled", "offer_sent"],
  },
  {
    key: "converted",
    label: {
      "es-PY": "Convertidos",
      "en-US": "Converted",
    },
    statuses: ["contract_signed"],
  },
  {
    key: "closed",
    label: {
      "es-PY": "Cerrados",
      "en-US": "Closed",
    },
    statuses: ["rejected", "lost"],
  },
];

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function statusLabel(value: string, isEn: boolean): string {
  const normalized = value.trim().toLowerCase();
  if (isEn) return normalized || "unknown";

  if (normalized === "new") return "Nuevo";
  if (normalized === "screening") return "Evaluación";
  if (normalized === "qualified") return "Calificado";
  if (normalized === "visit_scheduled") return "Visita agendada";
  if (normalized === "offer_sent") return "Oferta enviada";
  if (normalized === "contract_signed") return "Contrato firmado";
  if (normalized === "rejected") return "Rechazado";
  if (normalized === "lost") return "Perdido";
  return normalized || "desconocido";
}

function canConvert(status: string): boolean {
  return ["qualified", "visit_scheduled", "offer_sent"].includes(
    status.trim().toLowerCase()
  );
}

function canMoveToScreening(status: string): boolean {
  return status.trim().toLowerCase() === "new";
}

function canMoveToQualified(status: string): boolean {
  return ["screening", "visit_scheduled"].includes(status.trim().toLowerCase());
}

function normalizeSlaStatus(
  row: ApplicationRow
): "pending" | "met" | "breached" {
  const normalized = asString(row.response_sla_status).trim().toLowerCase();
  if (normalized === "pending") return "pending";
  if (normalized === "met") return "met";
  if (normalized === "breached") return "breached";

  if (row.first_response_minutes > 0) {
    return row.first_response_minutes <= RESPONSE_SLA_TARGET_MINUTES
      ? "met"
      : "breached";
  }

  const created = new Date(row.created_at);
  if (Number.isNaN(created.valueOf())) return "pending";

  const dueAtMs = created.valueOf() + RESPONSE_SLA_TARGET_MINUTES * 60_000;
  return Date.now() > dueAtMs ? "breached" : "pending";
}

function slaBadgeLabel(
  status: "pending" | "met" | "breached",
  isEn: boolean
): string {
  if (status === "met") {
    return isEn ? "SLA met" : "SLA cumplido";
  }
  if (status === "breached") {
    return isEn ? "SLA breached" : "SLA vencido";
  }
  return isEn ? "Pending response" : "Pendiente de respuesta";
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function normalizePhoneForWhatsApp(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D+/g, "");
  return digits || null;
}

function interpolateTemplate(
  templateText: string,
  context: Record<string, string>
): string {
  if (!templateText) return "";
  return templateText.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_full, key) => {
      const normalizedKey = String(key).trim().toLowerCase();
      return context[normalizedKey] ?? "";
    }
  );
}

function selectTemplate(
  templates: MessageTemplateOption[],
  channel: "whatsapp" | "email",
  status: string
): MessageTemplateOption | null {
  const filtered = templates.filter(
    (template) =>
      template.is_active && template.channel.trim().toLowerCase() === channel
  );
  if (!filtered.length) return null;

  const normalizedStatus = status.trim().toLowerCase();

  const byExactKey = filtered.find((template) => {
    const templateKey = template.template_key.trim().toLowerCase();
    return (
      templateKey.includes("application") &&
      templateKey.includes(normalizedStatus)
    );
  });
  if (byExactKey) return byExactKey;

  const byGeneric = filtered.find((template) =>
    template.template_key.trim().toLowerCase().includes("application")
  );
  if (byGeneric) return byGeneric;

  return filtered[0];
}

function buildMessageLinks(
  row: ApplicationRow,
  templates: MessageTemplateOption[],
  isEn: boolean,
  locale: "es-PY" | "en-US"
): {
  emailHref: string | null;
  whatsappHref: string | null;
} {
  const whatsappTemplate = selectTemplate(templates, "whatsapp", row.status);
  const emailTemplate = selectTemplate(templates, "email", row.status);

  const monthlyIncomeLabel =
    row.monthly_income > 0
      ? formatCurrency(row.monthly_income, "PYG", locale)
      : isEn
        ? "not provided"
        : "no declarado";

  const context = {
    full_name: row.full_name,
    listing_title:
      row.marketplace_listing_title || (isEn ? "Property" : "Propiedad"),
    status: row.status_label,
    email: row.email,
    phone_e164: row.phone_e164 ?? "",
    monthly_income: monthlyIncomeLabel,
  };

  const whatsappBody = interpolateTemplate(
    whatsappTemplate?.body ||
      (isEn
        ? "Hi {{full_name}}, this is the leasing team for {{listing_title}}. We are reviewing your application and will contact you shortly."
        : "Hola {{full_name}}, te escribe el equipo de leasing de {{listing_title}}. Estamos revisando tu aplicación y te contactaremos pronto."),
    context
  );

  const phone = normalizePhoneForWhatsApp(row.phone_e164);
  const whatsappHref = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(whatsappBody)}`
    : null;

  const emailSubject = interpolateTemplate(
    emailTemplate?.subject ||
      (isEn
        ? "Application update - {{listing_title}}"
        : "Actualización de aplicación - {{listing_title}}"),
    context
  );

  const emailBody = interpolateTemplate(
    emailTemplate?.body ||
      (isEn
        ? "Hi {{full_name}},\n\nWe received your application for {{listing_title}}. Current status: {{status}}.\n\nBest regards,\nPuerta Abierta"
        : "Hola {{full_name}},\n\nRecibimos tu aplicación para {{listing_title}}. Estado actual: {{status}}.\n\nSaludos,\nPuerta Abierta"),
    context
  );

  const email = row.email.trim();
  const emailHref = email
    ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
    : null;

  return { emailHref, whatsappHref };
}

export function ApplicationsManager({
  applications,
  members,
  messageTemplates,
}: {
  applications: Record<string, unknown>[];
  members: Record<string, unknown>[];
  messageTemplates: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => {
    const suffix = searchParams.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  }, [pathname, searchParams]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const memberOptions = useMemo<MemberOption[]>(() => {
    const index = new Map<string, MemberOption>();

    for (const member of members) {
      const userId = asString(member.user_id).trim();
      if (!userId) continue;

      const role = asString(member.role).trim();
      const appUserValue = member.app_users;
      const appUser = Array.isArray(appUserValue)
        ? ((appUserValue[0] as Record<string, unknown> | undefined) ?? null)
        : appUserValue && typeof appUserValue === "object"
          ? (appUserValue as Record<string, unknown>)
          : null;

      const fullName = appUser ? asString(appUser.full_name).trim() : "";
      const email = appUser ? asString(appUser.email).trim() : "";
      const baseLabel = fullName || email || userId;

      const label = role ? `${baseLabel} · ${role}` : baseLabel;
      index.set(userId, { user_id: userId, label });
    }

    return [...index.values()].sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }, [members]);

  const templateOptions = useMemo<MessageTemplateOption[]>(() => {
    return messageTemplates
      .map((template) => ({
        id: asString(template.id).trim(),
        channel: asString(template.channel).trim().toLowerCase(),
        template_key: asString(template.template_key).trim(),
        name: asString(template.name).trim(),
        subject: asString(template.subject),
        body: asString(template.body),
        is_active:
          template.is_active === undefined
            ? true
            : asBoolean(template.is_active),
      }))
      .filter((template) => template.id && template.channel && template.body);
  }, [messageTemplates]);

  const rows = useMemo<ApplicationRow[]>(() => {
    return applications.map((application) => {
      const status = asString(application.status).trim();
      return {
        id: asString(application.id).trim(),
        full_name: asString(application.full_name).trim(),
        email: asString(application.email).trim(),
        phone_e164: asString(application.phone_e164).trim() || null,
        status,
        status_label: statusLabel(status, isEn),
        marketplace_listing_title: asString(
          application.marketplace_listing_title
        ).trim(),
        monthly_income: asNumber(application.monthly_income),
        first_response_minutes: asNumber(application.first_response_minutes),
        created_at: asString(application.created_at).trim(),
        assigned_user_id: asString(application.assigned_user_id).trim() || null,
        assigned_user_name:
          asString(application.assigned_user_name).trim() || null,
        response_sla_status: asString(application.response_sla_status).trim(),
        response_sla_due_at:
          asString(application.response_sla_due_at).trim() || null,
      } satisfies ApplicationRow;
    });
  }, [applications, isEn]);

  const metrics = useMemo(() => {
    const total = rows.length;
    const unassigned = rows.filter((row) => !row.assigned_user_id).length;

    const slaBreached = rows.filter(
      (row) => normalizeSlaStatus(row) === "breached"
    ).length;

    const responseSamples = rows
      .map((row) => row.first_response_minutes)
      .filter((value) => value > 0);

    const medianFirstResponse = median(responseSamples);

    return {
      total,
      unassigned,
      slaBreached,
      medianFirstResponse,
    };
  }, [rows]);

  const boardRowsByLane = useMemo(() => {
    return BOARD_LANES.map((lane) => {
      const laneRows = rows
        .filter((row) =>
          lane.statuses.includes(row.status.trim().toLowerCase())
        )
        .sort((left, right) =>
          asString(right.created_at).localeCompare(asString(left.created_at))
        );
      return {
        lane,
        rows: laneRows,
      };
    });
  }, [rows]);

  const columns = useMemo<ColumnDef<DataTableRow>[]>(() => {
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
          const status = normalizeSlaStatus(row.original as ApplicationRow);
          return (
            <div className="space-y-1">
              <Badge variant="outline">{asString(getValue())}</Badge>
              <Badge variant={status === "breached" ? "outline" : "secondary"}>
                {slaBadgeLabel(status, isEn)}
              </Badge>
            </div>
          );
        },
      },
      {
        accessorKey: "assigned_user_name",
        header: isEn ? "Assigned" : "Asignado",
        cell: ({ row }) => {
          const assignedName = asString(row.original.assigned_user_name).trim();
          return assignedName || (isEn ? "Unassigned" : "Sin asignar");
        },
      },
      {
        accessorKey: "marketplace_listing_title",
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
        accessorKey: "first_response_minutes",
        header: isEn ? "First response (min)" : "Primera respuesta (min)",
        cell: ({ getValue }) => {
          const value = asNumber(getValue());
          return value > 0 ? value.toFixed(1) : "-";
        },
      },
      {
        accessorKey: "created_at",
        header: isEn ? "Created" : "Creado",
      },
    ];
  }, [isEn, locale]);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] text-muted-foreground">
              {isEn ? "Applications" : "Aplicaciones"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold text-2xl">{metrics.total}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] text-muted-foreground">
              {isEn ? "Unassigned" : "Sin asignar"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold text-2xl">{metrics.unassigned}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] text-muted-foreground">
              {isEn ? "SLA breached" : "SLA vencido"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold text-2xl">{metrics.slaBreached}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] text-muted-foreground">
              {isEn ? "Median first response" : "Mediana primera respuesta"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold text-2xl">
              {metrics.medianFirstResponse > 0
                ? `${metrics.medianFirstResponse.toFixed(1)}m`
                : "-"}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base">
            {isEn ? "Assignment + SLA board" : "Tablero de asignación + SLA"}
          </h3>
          <p className="text-muted-foreground text-xs">
            {isEn
              ? "Target first response: under 2h"
              : "Objetivo primera respuesta: menos de 2h"}
          </p>
        </div>

        <div className="grid gap-3 xl:grid-cols-4">
          {boardRowsByLane.map(({ lane, rows: laneRows }) => (
            <article
              className="space-y-2 rounded-2xl border border-border/80 bg-card/80 p-3"
              key={lane.key}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-sm">{lane.label[locale]}</p>
                <Badge variant="outline">{laneRows.length}</Badge>
              </div>

              <div className="max-h-[25rem] space-y-2 overflow-y-auto pr-1">
                {laneRows.length === 0 ? (
                  <p className="rounded-xl border border-border/80 border-dashed px-3 py-2 text-muted-foreground text-xs">
                    {isEn ? "No applications" : "Sin aplicaciones"}
                  </p>
                ) : (
                  laneRows.map((row) => {
                    const slaStatus = normalizeSlaStatus(row);
                    const slaLabel = slaBadgeLabel(slaStatus, isEn);
                    const assignedLabel =
                      row.assigned_user_name ||
                      (isEn ? "Unassigned" : "Sin asignar");
                    const { emailHref, whatsappHref } = buildMessageLinks(
                      row,
                      templateOptions,
                      isEn,
                      locale
                    );

                    return (
                      <div
                        className="space-y-2 rounded-xl border border-border/80 bg-background/70 p-3"
                        key={row.id}
                      >
                        <div className="space-y-0.5">
                          <p className="font-medium text-sm">{row.full_name}</p>
                          <p className="truncate text-muted-foreground text-xs">
                            {row.marketplace_listing_title ||
                              (isEn ? "No listing" : "Sin anuncio")}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{row.status_label}</Badge>
                          <Badge
                            className={cn(
                              slaStatus === "breached"
                                ? "border-rose-500/40 bg-rose-500/10 text-rose-700"
                                : ""
                            )}
                            variant={
                              slaStatus === "breached" ? "outline" : "secondary"
                            }
                          >
                            {slaLabel}
                          </Badge>
                        </div>

                        <p className="text-muted-foreground text-xs">
                          {isEn ? "Owner" : "Responsable"}: {assignedLabel}
                        </p>

                        <form
                          action={assignApplicationAction}
                          className="space-y-2"
                        >
                          <input
                            name="application_id"
                            type="hidden"
                            value={row.id}
                          />
                          <input
                            name="status"
                            type="hidden"
                            value={row.status}
                          />
                          <input name="next" type="hidden" value={nextPath} />
                          <input
                            name="note"
                            type="hidden"
                            value={
                              isEn
                                ? "Assignment updated"
                                : "Asignación actualizada"
                            }
                          />

                          <Select
                            className="h-8 text-xs"
                            defaultValue={
                              row.assigned_user_id ?? "__unassigned__"
                            }
                            name="assigned_user_id"
                          >
                            <option value="__unassigned__">
                              {isEn ? "Unassigned" : "Sin asignar"}
                            </option>
                            {memberOptions.map((member) => (
                              <option
                                key={member.user_id}
                                value={member.user_id}
                              >
                                {member.label}
                              </option>
                            ))}
                          </Select>

                          <Button
                            className="w-full"
                            size="sm"
                            type="submit"
                            variant="outline"
                          >
                            {isEn ? "Update owner" : "Actualizar responsable"}
                          </Button>
                        </form>

                        <div className="flex flex-wrap gap-2">
                          {whatsappHref ? (
                            <Link
                              className={cn(
                                buttonVariants({
                                  size: "sm",
                                  variant: "secondary",
                                })
                              )}
                              href={whatsappHref}
                              prefetch={false}
                              target="_blank"
                            >
                              WhatsApp
                            </Link>
                          ) : null}

                          {emailHref ? (
                            <Link
                              className={cn(
                                buttonVariants({
                                  size: "sm",
                                  variant: "outline",
                                })
                              )}
                              href={emailHref}
                              prefetch={false}
                            >
                              Email
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <DataTable
        columns={columns}
        data={rows}
        renderRowActions={(rowData) => {
          const row = rowData as ApplicationRow;
          const id = row.id;
          const status = row.status;
          const { emailHref, whatsappHref } = buildMessageLinks(
            row,
            templateOptions,
            isEn,
            locale
          );

          return (
            <div className="flex flex-wrap justify-end gap-2">
              {whatsappHref ? (
                <Link
                  className={cn(
                    buttonVariants({ size: "sm", variant: "secondary" })
                  )}
                  href={whatsappHref}
                  prefetch={false}
                  target="_blank"
                >
                  WhatsApp
                </Link>
              ) : null}

              {emailHref ? (
                <Link
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" })
                  )}
                  href={emailHref}
                  prefetch={false}
                >
                  Email
                </Link>
              ) : null}

              {canMoveToScreening(status) ? (
                <form action={setApplicationStatusAction}>
                  <input name="application_id" type="hidden" value={id} />
                  <input name="status" type="hidden" value="screening" />
                  <input name="note" type="hidden" value="Manual screening" />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="outline">
                    {isEn ? "To screening" : "A evaluación"}
                  </Button>
                </form>
              ) : null}

              {canMoveToQualified(status) ? (
                <form action={setApplicationStatusAction}>
                  <input name="application_id" type="hidden" value={id} />
                  <input name="status" type="hidden" value="qualified" />
                  <input name="note" type="hidden" value="Qualified" />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="secondary">
                    {isEn ? "Qualify" : "Calificar"}
                  </Button>
                </form>
              ) : null}

              {canConvert(status) ? (
                <form action={convertApplicationToLeaseAction}>
                  <input name="application_id" type="hidden" value={id} />
                  <input name="starts_on" type="hidden" value={today} />
                  <input name="platform_fee" type="hidden" value="0" />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="outline">
                    {isEn ? "Convert to lease" : "Convertir a contrato"}
                  </Button>
                </form>
              ) : null}

              {!canConvert(status) && status !== "contract_signed" ? (
                <form action={setApplicationStatusAction}>
                  <input name="application_id" type="hidden" value={id} />
                  <input name="status" type="hidden" value="lost" />
                  <input name="note" type="hidden" value="Marked as lost" />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="ghost">
                    {isEn ? "Mark lost" : "Marcar perdido"}
                  </Button>
                </form>
              ) : null}
            </div>
          );
        }}
      />
    </div>
  );
}
