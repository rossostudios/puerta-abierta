"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
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

import { setApplicationStatusAction } from "@/app/(admin)/module/applications/actions";
import { useApplicationColumns } from "@/app/(admin)/module/applications/columns";
import { AssignOwnerForm } from "@/components/applications/assign-owner-form";
import { ConvertToLeaseInlineForm } from "@/components/applications/convert-to-lease-form";
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
import { DataTable } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { BOARD_LANES } from "@/lib/features/applications/constants";
import { buildMessageLinks } from "@/lib/features/applications/messaging";
import type {
  ApplicationRow,
  MessageTemplateOption,
} from "@/lib/features/applications/types";
import {
  asBoolean,
  asNumber,
  asString,
  canConvert,
  canMoveToQualified,
  canMoveToScreening,
  formatDateTimeLabel,
  median,
  normalizeSlaStatus,
  qualificationBandClass,
  qualificationBandLabel,
  slaBadgeClass,
  slaBadgeLabel,
  statusBadgeClass,
  statusLabel,
} from "@/lib/features/applications/utils";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

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
        listing_title: asString(application.listing_title).trim(),
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
      { value: "normal", label: isEn ? "Normal" : "Normal" },
      { value: "warning", label: isEn ? "Warning" : "Advertencia" },
      { value: "critical", label: isEn ? "Critical" : "Crítico" },
      { value: "breached", label: isEn ? "Breached" : "Vencido" },
    ];
  }, [isEn]);

  const qualificationFilterOptions = useMemo<ComboboxOption[]>(() => {
    return [
      {
        value: "__all__",
        label: isEn ? "All qualification bands" : "Todas las bandas",
      },
      { value: "strong", label: qualificationBandLabel("strong", isEn) },
      { value: "moderate", label: qualificationBandLabel("moderate", isEn) },
      { value: "watch", label: qualificationBandLabel("watch", isEn) },
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

      if (statusFilter !== "__all__" && normalizedStatus !== statusFilter)
        return false;
      if (assigneeFilter === "__unassigned__" && row.assigned_user_id)
        return false;
      if (
        assigneeFilter !== "__all__" &&
        assigneeFilter !== "__unassigned__" &&
        row.assigned_user_id !== assigneeFilter
      )
        return false;
      if (slaFilter === "breached" && normalizedSlaStatus !== "breached")
        return false;
      if (
        slaFilter !== "__all__" &&
        slaFilter !== "breached" &&
        normalizedSlaLevel !== slaFilter
      )
        return false;
      if (
        qualificationFilter !== "__all__" &&
        normalizedBand !== qualificationFilter
      )
        return false;

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
    return { total, unassigned, slaBreached, slaAtRisk, medianFirstResponse };
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
    const todayDate = new Date();
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date(todayDate);
      date.setDate(todayDate.getDate() - index);
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
      return { lane, rows: laneRows };
    });
  }, [filteredRows]);

  const columns = useApplicationColumns(isEn, locale);

  const slaAlertRows = useMemo(() => {
    return filteredRows
      .filter((row) => {
        const level = row.response_sla_alert_level.trim().toLowerCase();
        return level === "warning" || level === "critical";
      })
      .sort((left, right) => {
        const leftLevel = left.response_sla_alert_level.trim().toLowerCase();
        const rightLevel = right.response_sla_alert_level.trim().toLowerCase();
        if (leftLevel === rightLevel)
          return right.created_at.localeCompare(left.created_at);
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
                            {row.listing_title ||
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
                            {row.listing_title ||
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
                            label={`${qualificationBandLabel(row.qualification_band, isEn)} ${row.qualification_score > 0 ? `· ${row.qualification_score}` : ""}`}
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
