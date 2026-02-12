"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useOptimistic, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  assignApplicationAction,
  convertApplicationToLeaseAction,
  setApplicationStatusAction,
} from "@/app/(admin)/module/applications/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
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
  response_sla_alert_level: string;
  response_sla_due_at: string | null;
  response_sla_remaining_minutes: number;
  qualification_score: number;
  qualification_band: string;
  income_to_rent_ratio: number | null;
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

function formatDateTimeLabel(value: string, locale: "es-PY" | "en-US"): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "-";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function statusBadgeClass(status: string): StatusTone {
  const normalized = status.trim().toLowerCase();
  if (normalized === "contract_signed") return "success";
  if (normalized === "qualified" || normalized === "offer_sent") return "info";
  if (normalized === "visit_scheduled") return "info";
  if (normalized === "screening" || normalized === "new") return "warning";
  if (normalized === "rejected" || normalized === "lost") return "danger";
  return "neutral";
}

function slaBadgeClass(
  status: "pending" | "met" | "breached",
  alertLevel: string
): StatusTone {
  const normalizedLevel = alertLevel.trim().toLowerCase();
  if (status === "breached" || normalizedLevel === "critical") return "danger";
  if (normalizedLevel === "warning") return "warning";
  if (status === "met") return "success";
  return "neutral";
}

function qualificationBandLabel(band: string, isEn: boolean): string {
  const normalized = band.trim().toLowerCase();
  if (normalized === "strong") return isEn ? "Strong" : "Fuerte";
  if (normalized === "moderate") return isEn ? "Moderate" : "Moderado";
  if (normalized === "watch") return isEn ? "Watch" : "Revisar";
  return isEn ? "Unscored" : "Sin puntuar";
}

function qualificationBandClass(band: string): StatusTone {
  const normalized = band.trim().toLowerCase();
  if (normalized === "strong") return "success";
  if (normalized === "moderate") return "info";
  if (normalized === "watch") return "warning";
  return "neutral";
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

function ConvertToLeaseInlineForm({
  applicationId,
  nextPath,
  defaultStartDate,
  locale,
  isEn,
  onOptimisticConvert,
}: {
  applicationId: string;
  nextPath: string;
  defaultStartDate: string;
  locale: "es-PY" | "en-US";
  isEn: boolean;
  onOptimisticConvert?: () => void;
}) {
  const [startsOn, setStartsOn] = useState(defaultStartDate);
  const [platformFee, setPlatformFee] = useState("0");

  return (
    <form
      action={convertApplicationToLeaseAction}
      className="flex flex-wrap items-center gap-2"
      onSubmit={onOptimisticConvert}
    >
      <input name="application_id" type="hidden" value={applicationId} />
      <input name="next" type="hidden" value={nextPath} />

      <DatePicker
        className="h-8 min-w-[8.75rem] text-xs"
        locale={locale}
        name="starts_on"
        onValueChange={setStartsOn}
        value={startsOn}
      />

      <Input
        className="h-8 w-[4.75rem] text-xs"
        inputMode="decimal"
        min={0}
        name="platform_fee"
        onChange={(event) => setPlatformFee(event.target.value)}
        step="0.01"
        type="number"
        value={platformFee}
      />

      <Button disabled={!startsOn} size="sm" type="submit" variant="outline">
        {isEn ? "Convert to lease" : "Convertir a contrato"}
      </Button>
    </form>
  );
}

function AssignOwnerForm({
  applicationId,
  status,
  assignedUserId,
  assignedUserName,
  memberOptions,
  nextPath,
  isEn,
  onOptimisticAssign,
}: {
  applicationId: string;
  status: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  memberOptions: ComboboxOption[];
  nextPath: string;
  isEn: boolean;
  onOptimisticAssign?: (assignment: {
    assignedUserId: string | null;
    assignedUserName: string | null;
  }) => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState(
    assignedUserId ?? "__unassigned__"
  );

  const optionLabelByValue = useMemo(() => {
    const index = new Map(
      memberOptions.map((option) => [option.value, option.label] as const)
    );
    return index;
  }, [memberOptions]);

  return (
    <form
      action={assignApplicationAction}
      className="space-y-2"
      onSubmit={() => {
        const nextAssignedUserId =
          selectedUserId === "__unassigned__" ? null : selectedUserId;
        const nextAssignedUserName =
          selectedUserId === "__unassigned__"
            ? null
            : (optionLabelByValue.get(selectedUserId) ??
              assignedUserName ??
              null);
        onOptimisticAssign?.({
          assignedUserId: nextAssignedUserId,
          assignedUserName: nextAssignedUserName,
        });
      }}
    >
      <input name="application_id" type="hidden" value={applicationId} />
      <input name="status" type="hidden" value={status} />
      <input name="next" type="hidden" value={nextPath} />
      <input
        name="note"
        type="hidden"
        value={isEn ? "Assignment updated" : "Asignación actualizada"}
      />

      <Combobox
        className="h-8 text-xs"
        emptyLabel={isEn ? "No members found" : "Sin miembros"}
        name="assigned_user_id"
        onValueChange={setSelectedUserId}
        options={memberOptions}
        placeholder={isEn ? "Select owner" : "Seleccionar responsable"}
        searchPlaceholder={isEn ? "Search member..." : "Buscar miembro..."}
        value={selectedUserId}
      />

      <Button className="w-full" size="sm" type="submit" variant="outline">
        {isEn ? "Update owner" : "Actualizar responsable"}
      </Button>
    </form>
  );
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

  const memberOptions = useMemo<ComboboxOption[]>(() => {
    const index = new Map<string, ComboboxOption>();

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
      index.set(userId, { value: userId, label });
    }

    return [...index.values()].sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }, [members]);

  const assignmentOptions = useMemo<ComboboxOption[]>(() => {
    return [
      {
        value: "__unassigned__",
        label: isEn ? "Unassigned" : "Sin asignar",
      },
      ...memberOptions,
    ];
  }, [isEn, memberOptions]);

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
        response_sla_alert_level: asString(
          application.response_sla_alert_level
        ).trim(),
        response_sla_due_at:
          asString(application.response_sla_due_at).trim() || null,
        response_sla_remaining_minutes: asNumber(
          application.response_sla_remaining_minutes
        ),
        qualification_score: asNumber(application.qualification_score),
        qualification_band: asString(application.qualification_band).trim(),
        income_to_rent_ratio:
          asNumber(application.income_to_rent_ratio) > 0
            ? asNumber(application.income_to_rent_ratio)
            : null,
      } satisfies ApplicationRow;
    });
  }, [applications, isEn]);

  const [optimisticRows, queueOptimisticRowUpdate] = useOptimistic(
    rows,
    (
      currentRows,
      action:
        | {
            type: "set-status";
            applicationId: string;
            nextStatus: string;
          }
        | {
            type: "assign";
            applicationId: string;
            assignedUserId: string | null;
            assignedUserName: string | null;
          }
    ) => {
      return currentRows.map((row) => {
        if (row.id !== action.applicationId) return row;
        if (action.type === "assign") {
          return {
            ...row,
            assigned_user_id: action.assignedUserId,
            assigned_user_name: action.assignedUserName,
          };
        }
        return {
          ...row,
          status: action.nextStatus,
          status_label: statusLabel(action.nextStatus, isEn),
        };
      });
    }
  );

  const [statusFilter, setStatusFilter] = useState("__all__");
  const [assigneeFilter, setAssigneeFilter] = useState("__all__");
  const [slaFilter, setSlaFilter] = useState("__all__");
  const [qualificationFilter, setQualificationFilter] = useState("__all__");

  const statusFilterOptions = useMemo<ComboboxOption[]>(() => {
    const uniqueStatuses = [
      ...new Set(optimisticRows.map((row) => row.status.trim())),
    ]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));

    return [
      {
        value: "__all__",
        label: isEn ? "All statuses" : "Todos los estados",
      },
      ...uniqueStatuses.map((status) => ({
        value: status,
        label: statusLabel(status, isEn),
      })),
    ];
  }, [isEn, optimisticRows]);

  const assigneeFilterOptions = useMemo<ComboboxOption[]>(() => {
    return [
      {
        value: "__all__",
        label: isEn ? "All assignees" : "Todos los responsables",
      },
      ...assignmentOptions,
    ];
  }, [assignmentOptions, isEn]);

  const slaFilterOptions = useMemo<ComboboxOption[]>(() => {
    return [
      {
        value: "__all__",
        label: isEn ? "All SLA levels" : "Todos los niveles SLA",
      },
      {
        value: "normal",
        label: isEn ? "Normal" : "Normal",
      },
      {
        value: "warning",
        label: isEn ? "Warning" : "Advertencia",
      },
      {
        value: "critical",
        label: isEn ? "Critical" : "Crítico",
      },
      {
        value: "breached",
        label: isEn ? "Breached" : "Vencido",
      },
    ];
  }, [isEn]);

  const qualificationFilterOptions = useMemo<ComboboxOption[]>(() => {
    return [
      {
        value: "__all__",
        label: isEn ? "All qualification bands" : "Todas las bandas",
      },
      {
        value: "strong",
        label: qualificationBandLabel("strong", isEn),
      },
      {
        value: "moderate",
        label: qualificationBandLabel("moderate", isEn),
      },
      {
        value: "watch",
        label: qualificationBandLabel("watch", isEn),
      },
    ];
  }, [isEn]);

  const filteredRows = useMemo(() => {
    return optimisticRows.filter((row) => {
      const normalizedStatus = row.status.trim().toLowerCase();
      const normalizedBand = row.qualification_band.trim().toLowerCase();
      const normalizedSlaLevel = row.response_sla_alert_level
        .trim()
        .toLowerCase();
      const normalizedSlaStatus = normalizeSlaStatus(row);

      if (statusFilter !== "__all__" && normalizedStatus !== statusFilter) {
        return false;
      }

      if (assigneeFilter === "__unassigned__" && row.assigned_user_id) {
        return false;
      }
      if (
        assigneeFilter !== "__all__" &&
        assigneeFilter !== "__unassigned__" &&
        row.assigned_user_id !== assigneeFilter
      ) {
        return false;
      }

      if (slaFilter === "breached" && normalizedSlaStatus !== "breached") {
        return false;
      }
      if (
        slaFilter !== "__all__" &&
        slaFilter !== "breached" &&
        normalizedSlaLevel !== slaFilter
      ) {
        return false;
      }

      if (
        qualificationFilter !== "__all__" &&
        normalizedBand !== qualificationFilter
      ) {
        return false;
      }

      return true;
    });
  }, [
    assigneeFilter,
    optimisticRows,
    qualificationFilter,
    slaFilter,
    statusFilter,
  ]);

  const metrics = useMemo(() => {
    const total = filteredRows.length;
    const unassigned = filteredRows.filter(
      (row) => !row.assigned_user_id
    ).length;

    const slaBreached = filteredRows.filter(
      (row) => normalizeSlaStatus(row) === "breached"
    ).length;
    const slaAtRisk = filteredRows.filter((row) => {
      const level = row.response_sla_alert_level.trim().toLowerCase();
      return level === "warning" || level === "critical";
    }).length;

    const responseSamples = filteredRows
      .map((row) => row.first_response_minutes)
      .filter((value) => value > 0);

    const medianFirstResponse = median(responseSamples);

    return {
      total,
      unassigned,
      slaBreached,
      slaAtRisk,
      medianFirstResponse,
    };
  }, [filteredRows]);

  const funnelChartData = useMemo(() => {
    return BOARD_LANES.map((lane) => ({
      key: lane.key,
      label: lane.label[locale],
      count: filteredRows.filter((row) =>
        lane.statuses.includes(row.status.trim().toLowerCase())
      ).length,
    }));
  }, [filteredRows, locale]);

  const funnelChartConfig: ChartConfig = useMemo(
    () => ({
      incoming: {
        label: isEn ? "Incoming" : "Ingresos",
        color: "var(--chart-1)",
      },
      qualified: {
        label: isEn ? "Qualified" : "Calificación",
        color: "var(--chart-2)",
      },
      converted: {
        label: isEn ? "Converted" : "Convertidos",
        color: "var(--chart-3)",
      },
      closed: { label: isEn ? "Closed" : "Cerrados", color: "var(--chart-4)" },
    }),
    [isEn]
  );

  const responseTrendData = useMemo(() => {
    const days: string[] = [];
    const today = new Date();
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - index);
      days.push(date.toISOString().slice(0, 10));
    }

    const valuesByDay = new Map<string, number[]>(
      days.map((day) => [day, []] as const)
    );
    for (const row of filteredRows) {
      if (row.first_response_minutes <= 0) continue;
      const day = row.created_at.slice(0, 10);
      if (!valuesByDay.has(day)) continue;
      valuesByDay.get(day)?.push(row.first_response_minutes);
    }

    return days.map((day) => {
      const parsed = new Date(`${day}T00:00:00`);
      const samples = valuesByDay.get(day) ?? [];
      return {
        day: Number.isNaN(parsed.valueOf())
          ? day
          : new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
            }).format(parsed),
        median_minutes: samples.length ? median(samples) : 0,
      };
    });
  }, [filteredRows, locale]);

  const responseTrendConfig: ChartConfig = useMemo(
    () => ({
      median_minutes: {
        label: isEn
          ? "Median first response (min)"
          : "Mediana primera respuesta (min)",
        color: "var(--chart-5)",
      },
    }),
    [isEn]
  );

  const boardRowsByLane = useMemo(() => {
    return BOARD_LANES.map((lane) => {
      const laneRows = filteredRows
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
  }, [filteredRows]);

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

  const slaAlertRows = useMemo(() => {
    return filteredRows
      .filter((row) => {
        const level = row.response_sla_alert_level.trim().toLowerCase();
        return level === "warning" || level === "critical";
      })
      .sort((left, right) => {
        const leftLevel = left.response_sla_alert_level.trim().toLowerCase();
        const rightLevel = right.response_sla_alert_level.trim().toLowerCase();
        if (leftLevel === rightLevel) {
          return right.created_at.localeCompare(left.created_at);
        }
        if (leftLevel === "critical") return -1;
        if (rightLevel === "critical") return 1;
        return 0;
      });
  }, [filteredRows]);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
              {isEn ? "SLA at risk" : "SLA en riesgo"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold text-2xl">{metrics.slaAtRisk}</p>
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

      <section className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {isEn ? "Funnel stage distribution" : "Distribución del funnel"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer className="h-48 w-full" config={funnelChartConfig}>
              <BarChart data={funnelChartData} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                />
                <ChartTooltip
                  content={(props) => (
                    <ChartTooltipContent
                      {...props}
                      headerFormatter={() =>
                        isEn ? "Pipeline funnel" : "Funnel del pipeline"
                      }
                    />
                  )}
                />
                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                  {funnelChartData.map((entry) => (
                    <Cell fill={`var(--color-${entry.key})`} key={entry.key} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {isEn
                ? "First response median trend"
                : "Tendencia mediana de primera respuesta"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              className="h-48 w-full"
              config={responseTrendConfig}
            >
              <LineChart
                data={responseTrendData}
                margin={{ left: 0, right: 8 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="day"
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                />
                <ChartTooltip
                  content={(props) => (
                    <ChartTooltipContent
                      {...props}
                      headerFormatter={() =>
                        isEn
                          ? "Median first response"
                          : "Mediana primera respuesta"
                      }
                    />
                  )}
                />
                <Line
                  dataKey="median_minutes"
                  dot={{ r: 3 }}
                  stroke="var(--color-median_minutes)"
                  strokeWidth={2}
                  type="monotone"
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </section>

      <Collapsible defaultOpen>
        <div className="rounded-2xl border border-border/80 bg-card/80 p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">
              {isEn ? "Pipeline filters" : "Filtros del pipeline"}
            </h3>
            <CollapsibleTrigger
              className={(state) =>
                cn(
                  buttonVariants({ size: "sm", variant: "ghost" }),
                  "h-8 rounded-xl px-2",
                  state.open ? "text-foreground" : "text-muted-foreground"
                )
              }
              type="button"
            >
              <Icon icon={ArrowDown01Icon} size={14} />
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="mt-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1.5">
                <span className="text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "Status" : "Estado"}
                </span>
                <Combobox
                  onValueChange={(next) => setStatusFilter(next.toLowerCase())}
                  options={statusFilterOptions}
                  searchPlaceholder={
                    isEn ? "Filter status..." : "Filtrar estado..."
                  }
                  value={statusFilter}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "Assignee" : "Responsable"}
                </span>
                <Combobox
                  onValueChange={setAssigneeFilter}
                  options={assigneeFilterOptions}
                  searchPlaceholder={
                    isEn ? "Filter assignee..." : "Filtrar responsable..."
                  }
                  value={assigneeFilter}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "SLA level" : "Nivel SLA"}
                </span>
                <Combobox
                  onValueChange={setSlaFilter}
                  options={slaFilterOptions}
                  searchPlaceholder={isEn ? "Filter SLA..." : "Filtrar SLA..."}
                  value={slaFilter}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "Qualification" : "Calificación"}
                </span>
                <Combobox
                  onValueChange={setQualificationFilter}
                  options={qualificationFilterOptions}
                  searchPlaceholder={
                    isEn ? "Filter qualification..." : "Filtrar calificación..."
                  }
                  value={qualificationFilter}
                />
              </label>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <Collapsible defaultOpen={slaAlertRows.length > 0}>
        <div className="rounded-2xl border border-border/80 bg-card/80 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-sm">
              {isEn ? "SLA alert center" : "Centro de alertas SLA"}
            </h3>
            <CollapsibleTrigger
              className={(state) =>
                cn(
                  buttonVariants({ size: "sm", variant: "ghost" }),
                  "h-8 rounded-xl px-2",
                  state.open ? "text-foreground" : "text-muted-foreground"
                )
              }
              type="button"
            >
              <Icon icon={ArrowDown01Icon} size={14} />
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="mt-3">
            {slaAlertRows.length === 0 ? (
              <p className="rounded-xl border border-border/80 border-dashed px-3 py-2 text-muted-foreground text-xs">
                {isEn
                  ? "No warning/critical SLA alerts for the current filter set."
                  : "No hay alertas SLA en advertencia/crítico para el filtro actual."}
              </p>
            ) : (
              <div className="grid gap-2 xl:grid-cols-2">
                {slaAlertRows.slice(0, 8).map((row) => {
                  const slaStatus = normalizeSlaStatus(row);
                  const assignedLabel =
                    row.assigned_user_name ||
                    (isEn ? "Unassigned" : "Sin asignar");
                  return (
                    <article
                      className="rounded-xl border border-border/80 bg-background/70 p-3"
                      key={row.id}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm">{row.full_name}</p>
                          <p className="text-muted-foreground text-xs">
                            {row.marketplace_listing_title ||
                              (isEn ? "No listing" : "Sin anuncio")}
                          </p>
                        </div>
                        <StatusBadge
                          label={slaBadgeLabel(slaStatus, isEn)}
                          tone={slaBadgeClass(
                            slaStatus,
                            row.response_sla_alert_level
                          )}
                          value={slaStatus}
                        />
                      </div>
                      <p className="mt-2 text-muted-foreground text-xs">
                        {isEn ? "Assigned" : "Responsable"}: {assignedLabel}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {isEn ? "Due" : "Vence"}:{" "}
                        {row.response_sla_due_at
                          ? formatDateTimeLabel(row.response_sla_due_at, locale)
                          : "-"}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </CollapsibleContent>
        </div>
      </Collapsible>

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
                <StatusBadge
                  label={String(laneRows.length)}
                  tone="neutral"
                  value={lane.key}
                />
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
                          <StatusBadge
                            label={row.status_label}
                            tone={statusBadgeClass(row.status)}
                            value={row.status}
                          />
                          <StatusBadge
                            label={slaLabel}
                            tone={slaBadgeClass(
                              slaStatus,
                              row.response_sla_alert_level
                            )}
                            value={slaStatus}
                          />
                          <StatusBadge
                            label={`${qualificationBandLabel(
                              row.qualification_band,
                              isEn
                            )} ${
                              row.qualification_score > 0
                                ? `· ${row.qualification_score}`
                                : ""
                            }`}
                            tone={qualificationBandClass(
                              row.qualification_band
                            )}
                            value={row.qualification_band}
                          />
                        </div>

                        <p className="text-muted-foreground text-xs">
                          {isEn ? "Owner" : "Responsable"}: {assignedLabel}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {isEn ? "Created" : "Creado"}:{" "}
                          {formatDateTimeLabel(row.created_at, locale)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {isEn ? "SLA due" : "SLA vence"}:{" "}
                          {row.response_sla_due_at
                            ? formatDateTimeLabel(
                                row.response_sla_due_at,
                                locale
                              )
                            : "-"}
                        </p>

                        <AssignOwnerForm
                          applicationId={row.id}
                          assignedUserId={row.assigned_user_id}
                          assignedUserName={row.assigned_user_name}
                          isEn={isEn}
                          memberOptions={assignmentOptions}
                          nextPath={nextPath}
                          onOptimisticAssign={(assignment) =>
                            queueOptimisticRowUpdate({
                              type: "assign",
                              applicationId: row.id,
                              assignedUserId: assignment.assignedUserId,
                              assignedUserName: assignment.assignedUserName,
                            })
                          }
                          status={row.status}
                        />

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
        data={filteredRows}
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
                <form
                  action={setApplicationStatusAction}
                  onSubmit={() =>
                    queueOptimisticRowUpdate({
                      type: "set-status",
                      applicationId: id,
                      nextStatus: "screening",
                    })
                  }
                >
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
                <form
                  action={setApplicationStatusAction}
                  onSubmit={() =>
                    queueOptimisticRowUpdate({
                      type: "set-status",
                      applicationId: id,
                      nextStatus: "qualified",
                    })
                  }
                >
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
                <ConvertToLeaseInlineForm
                  applicationId={id}
                  defaultStartDate={today}
                  isEn={isEn}
                  locale={locale}
                  nextPath={nextPath}
                  onOptimisticConvert={() =>
                    queueOptimisticRowUpdate({
                      type: "set-status",
                      applicationId: id,
                      nextStatus: "contract_signed",
                    })
                  }
                />
              ) : null}

              {!canConvert(status) && status !== "contract_signed" ? (
                <form
                  action={setApplicationStatusAction}
                  onSubmit={() =>
                    queueOptimisticRowUpdate({
                      type: "set-status",
                      applicationId: id,
                      nextStatus: "lost",
                    })
                  }
                >
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
