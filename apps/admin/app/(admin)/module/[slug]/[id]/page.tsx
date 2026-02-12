import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrgInvitesCard } from "@/components/organizations/org-invites-card";
import { OrgMembersCard } from "@/components/organizations/org-members-card";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { PinButton } from "@/components/shell/pin-button";
import { RecordRecent } from "@/components/shell/record-recent";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { formatCurrency, humanizeKey } from "@/lib/format";
import { FOREIGN_KEY_HREF_BASE_BY_KEY } from "@/lib/links";
import { MODULE_BY_SLUG } from "@/lib/modules";
import { getActiveOrgId } from "@/lib/org";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type RecordPageProps = {
  params: Promise<{
    slug: string;
    id: string;
  }>;
};

type OrganizationMemberRow = {
  organization_id: string;
  user_id: string;
  role: string;
  is_primary?: boolean | null;
  joined_at?: string | null;
  app_users?: { id: string; email: string; full_name: string } | null;
};

type OrganizationInviteRow = {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expires_at?: string | null;
  created_at?: string | null;
  accepted_at?: string | null;
  revoked_at?: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function isOrganizationMemberRow(
  value: unknown
): value is OrganizationMemberRow {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.organization_id === "string" &&
    typeof record.user_id === "string" &&
    typeof record.role === "string"
  );
}

function isOrganizationInviteRow(
  value: unknown
): value is OrganizationInviteRow {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.organization_id === "string" &&
    typeof record.email === "string" &&
    typeof record.token === "string"
  );
}

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function asDateLabel(value: string): string | null {
  if (!(ISO_DATE_TIME_RE.test(value) || ISO_DATE_RE.test(value))) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;

  if (ISO_DATE_RE.test(value)) {
    return new Intl.DateTimeFormat("es-PY", { dateStyle: "medium" }).format(
      date
    );
  }

  return new Intl.DateTimeFormat("es-PY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sortKeys(keys: string[]): string[] {
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
    "listing_id",
    "guest_id",
    "reservation_id",
    "template_id",
    "created_at",
    "updated_at",
  ];

  const score = new Map(priority.map((key, index) => [key, index * 10]));
  const scoreFor = (key: string): number => {
    const direct = score.get(key);
    if (direct !== undefined) return direct;

    if (key.endsWith("_name")) {
      const idKey = `${key.slice(0, -5)}_id`;
      const idScore = score.get(idKey);
      if (idScore !== undefined) return idScore + 1;
    }

    return Number.POSITIVE_INFINITY;
  };

  return [...keys].sort((a, b) => {
    const aScore = scoreFor(a);
    const bScore = scoreFor(b);
    if (aScore !== bScore) return aScore - bScore;
    return a.localeCompare(b);
  });
}

function toLabel(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type StatementLineItem = {
  bucket: string;
  source_table: string;
  source_id: string;
  kind: string;
  amount_pyg: number;
  date?: string;
  from?: string;
  to?: string;
};

type StatementReconciliation = {
  gross_total?: number;
  computed_net_payout?: number;
  stored_net_payout?: number;
  stored_vs_computed_diff?: number;
};

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStatementLineItems(value: unknown): StatementLineItem[] {
  if (!Array.isArray(value)) return [];

  const rows: StatementLineItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    const bucket = typeof record.bucket === "string" ? record.bucket : "";
    const source_table =
      typeof record.source_table === "string" ? record.source_table : "";
    const source_id =
      typeof record.source_id === "string" ? record.source_id : "";
    const kind = typeof record.kind === "string" ? record.kind : "";
    const amount_pyg = toNumber(record.amount_pyg);

    if (!(bucket && source_table && source_id && kind) || amount_pyg === null) {
      continue;
    }

    rows.push({
      bucket,
      source_table,
      source_id,
      kind,
      amount_pyg,
      date: typeof record.date === "string" ? record.date : undefined,
      from: typeof record.from === "string" ? record.from : undefined,
      to: typeof record.to === "string" ? record.to : undefined,
    });
  }

  return rows;
}

function toStatementReconciliation(
  value: unknown
): StatementReconciliation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    gross_total: toNumber(record.gross_total) ?? undefined,
    computed_net_payout: toNumber(record.computed_net_payout) ?? undefined,
    stored_net_payout: toNumber(record.stored_net_payout) ?? undefined,
    stored_vs_computed_diff:
      toNumber(record.stored_vs_computed_diff) ?? undefined,
  };
}

function reconciliationDiffClass(diff: number): string {
  if (Math.abs(diff) < 0.01) {
    return "status-tone-success";
  }
  if (diff > 0) {
    return "status-tone-warning";
  }
  return "status-tone-danger";
}

function recordTitle(record: Record<string, unknown>): string {
  const candidate = (record.name ??
    record.title ??
    record.public_name ??
    record.code ??
    record.id) as unknown;
  const text =
    typeof candidate === "string" && candidate.trim() ? candidate.trim() : "";
  if (text) return text;
  return "Detalles del registro";
}

export default async function ModuleRecordPage({ params }: RecordPageProps) {
  const { slug, id } = await params;
  const moduleDef = MODULE_BY_SLUG.get(slug);
  if (!moduleDef || moduleDef.kind === "report") {
    notFound();
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${moduleDef.endpoint}/${encodeURIComponent(id)}`;

  let record: Record<string, unknown> | null = null;
  let apiError: { kind: "connection" | "request"; message: string } | null =
    null;
  let requestStatus: number | null = null;
  let accessToken: string | null = null;
  let sessionUserId: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getSession();
    accessToken = data.session?.access_token ?? null;
    sessionUserId = data.session?.user?.id ?? null;
    const token = accessToken;

    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (response.status === 404) {
      notFound();
    }

    if (response.ok) {
      record = (await response.json()) as Record<string, unknown>;
    } else {
      const details = await response.text().catch(() => "");
      const suffix = details ? `: ${details.slice(0, 240)}` : "";
      requestStatus = response.status;
      apiError = {
        kind: "request",
        message: `HTTP ${response.status} for ${moduleDef.endpoint}${suffix}`,
      };
    }
  } catch (err) {
    apiError = { kind: "connection", message: errorMessage(err) };
  }

  if (apiError || !record) {
    if (
      requestStatus === 403 &&
      apiError?.kind === "request" &&
      isOrgMembershipError(apiError.message)
    ) {
      const activeOrgId = await getActiveOrgId();
      return (
        <OrgAccessChanged
          description="Este registro pertenece a una organización a la que no tienes acceso. Borra la selección actual y cámbiate a una organización de la que seas miembro."
          orgId={activeOrgId}
          title="Sin acceso a este registro"
        />
      );
    }

    const title =
      apiError?.kind === "request"
        ? "Falló la solicitud a la API"
        : "Fallo de conexión a la API";
    const detail =
      apiError?.kind === "request"
        ? "No se pudieron cargar los detalles del registro desde el backend."
        : "No se pudo conectar al backend para cargar los detalles del registro.";

    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{detail}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground text-sm">
          <p>
            URL base del backend:{" "}
            <code className="rounded bg-muted px-1 py-0.5">{baseUrl}</code>
          </p>
          {requestStatus ? (
            <p className="break-words">
              HTTP {requestStatus} for{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {moduleDef.endpoint}
              </code>
            </p>
          ) : null}
          <p className="break-words">
            {apiError?.message ?? "Error desconocido"}
          </p>
          <p>
            Asegúrate de que FastAPI esté ejecutándose (desde{" "}
            <code className="rounded bg-muted px-1 py-0.5">apps/backend</code>)
            en el puerto 8000.
          </p>
        </CardContent>
      </Card>
    );
  }

  const title = recordTitle(record);
  const recordId = typeof record.id === "string" ? record.id : id;
  const href = `/module/${moduleDef.slug}/${recordId}`;
  const ownerUserId =
    moduleDef.slug === "organizations" &&
    typeof record.owner_user_id === "string"
      ? record.owner_user_id
      : null;

  let organizationMembers: OrganizationMemberRow[] = [];
  let organizationMembersError: string | null = null;
  let canManageMembers = false;
  let organizationInvites: OrganizationInviteRow[] = [];
  let organizationInvitesError: string | null = null;

  if (moduleDef.slug === "organizations") {
    try {
      const membersUrl = `${baseUrl}/organizations/${encodeURIComponent(recordId)}/members`;
      const response = await fetch(membersUrl, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

      if (response.ok) {
        const data = (await response.json()) as { data?: unknown[] };
        organizationMembers = Array.isArray(data.data)
          ? data.data.filter(isOrganizationMemberRow)
          : [];
      } else {
        const details = await response.text().catch(() => "");
        const suffix = details ? `: ${details.slice(0, 240)}` : "";
        organizationMembersError = `HTTP ${response.status} for /organizations/${recordId}/members${suffix}`;
      }
    } catch (err) {
      organizationMembersError = errorMessage(err);
    }

    const me = sessionUserId
      ? organizationMembers.find((member) => member.user_id === sessionUserId)
      : null;
    canManageMembers = me?.role === "owner_admin";

    if (canManageMembers) {
      try {
        const invitesUrl = `${baseUrl}/organizations/${encodeURIComponent(recordId)}/invites`;
        const response = await fetch(invitesUrl, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        });

        if (response.ok) {
          const data = (await response.json()) as { data?: unknown[] };
          organizationInvites = Array.isArray(data.data)
            ? data.data.filter(isOrganizationInviteRow)
            : [];
        } else {
          const details = await response.text().catch(() => "");
          const suffix = details ? `: ${details.slice(0, 240)}` : "";
          organizationInvitesError = `HTTP ${response.status} for /organizations/${recordId}/invites${suffix}`;
        }
      } catch (err) {
        organizationInvitesError = errorMessage(err);
      }
    }
  }

  const relatedLinks = (() => {
    const links: Array<{ href: string; label: string }> = [];
    const q = (key: string, value: string) =>
      `${key}=${encodeURIComponent(value)}`;

    if (moduleDef.slug === "organizations") {
      links.push({ href: "/setup", label: "Abrir configuración" });
      links.push({ href: "/module/properties", label: "Propiedades" });
      links.push({ href: "/module/units", label: "Unidades" });
      links.push({ href: "/module/channels", label: "Canales" });
      links.push({ href: "/module/listings", label: "Anuncios" });
      links.push({ href: "/module/reservations", label: "Reservas" });
      links.push({ href: "/module/tasks", label: "Tareas" });
      links.push({ href: "/module/expenses", label: "Gastos" });
      links.push({
        href: "/module/owner-statements",
        label: "Estados del propietario",
      });
      return links;
    }

    if (moduleDef.slug === "properties") {
      links.push({
        href: `/module/units?${q("property_id", recordId)}`,
        label: "Unidades en esta propiedad",
      });
      links.push({
        href: `/module/tasks?${q("property_id", recordId)}`,
        label: "Tareas de esta propiedad",
      });
      links.push({
        href: `/module/expenses?${q("property_id", recordId)}`,
        label: "Gastos de esta propiedad",
      });
      links.push({
        href: `/module/owner-statements?${q("property_id", recordId)}`,
        label: "Estados del propietario de esta propiedad",
      });
      return links;
    }

    if (moduleDef.slug === "units") {
      links.push({
        href: `/module/listings?${q("unit_id", recordId)}`,
        label: "Anuncios de esta unidad",
      });
      links.push({
        href: `/module/reservations?${q("unit_id", recordId)}`,
        label: "Reservas de esta unidad",
      });
      links.push({
        href: `/module/calendar?${q("unit_id", recordId)}`,
        label: "Bloqueos de calendario de esta unidad",
      });
      links.push({
        href: `/module/tasks?${q("unit_id", recordId)}`,
        label: "Tareas de esta unidad",
      });
      links.push({
        href: `/module/expenses?${q("unit_id", recordId)}`,
        label: "Gastos de esta unidad",
      });
      links.push({
        href: `/module/owner-statements?${q("unit_id", recordId)}`,
        label: "Estados del propietario de esta unidad",
      });
      return links;
    }

    if (moduleDef.slug === "channels") {
      links.push({
        href: `/module/listings?${q("channel_id", recordId)}`,
        label: "Anuncios en este canal",
      });
      links.push({
        href: `/module/reservations?${q("channel_id", recordId)}`,
        label: "Reservas de este canal",
      });
      return links;
    }

    if (moduleDef.slug === "listings") {
      links.push({
        href: `/module/reservations?${q("listing_id", recordId)}`,
        label: "Reservas de este anuncio",
      });
      return links;
    }

    if (moduleDef.slug === "guests") {
      links.push({
        href: `/module/reservations?${q("guest_id", recordId)}`,
        label: "Reservas de este huésped",
      });
      return links;
    }

    if (moduleDef.slug === "reservations") {
      links.push({
        href: `/module/tasks?${q("reservation_id", recordId)}`,
        label: "Tareas de esta reserva",
      });
      links.push({
        href: `/module/expenses?${q("reservation_id", recordId)}`,
        label: "Gastos de esta reserva",
      });
      return links;
    }

    return links;
  })();

  const ownerStatementLineItems =
    moduleDef.slug === "owner-statements"
      ? toStatementLineItems(record.line_items)
      : [];
  const ownerStatementReconciliation =
    moduleDef.slug === "owner-statements"
      ? toStatementReconciliation(record.reconciliation)
      : null;
  const ownerStatementCurrency =
    moduleDef.slug === "owner-statements" && typeof record.currency === "string"
      ? record.currency
      : "PYG";

  const sourceHrefBaseByTable: Record<string, string> = {
    reservations: "/module/reservations",
    collection_records: "/module/collections",
    leases: "/module/leases",
    expenses: "/module/expenses",
  };

  const keys = sortKeys(Object.keys(record)).filter((key) => {
    if (moduleDef.slug !== "owner-statements") return true;
    return key !== "line_items" && key !== "reconciliation";
  });

  return (
    <div className="space-y-6">
      <RecordRecent href={href} label={title} meta={moduleDef.label} />
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Registro</Badge>
                <Badge className="text-[11px]" variant="secondary">
                  {moduleDef.label}
                </Badge>
              </div>
              <CardTitle className="text-2xl">{title}</CardTitle>
              <CardDescription>{moduleDef.description}</CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
                href={`/module/${moduleDef.slug}`}
              >
                <Icon icon={ArrowLeft01Icon} size={16} />
                Volver al módulo
              </Link>
              <CopyButton label="Copiar ID" value={recordId} />
              <PinButton href={href} label={title} meta={moduleDef.label} />
            </div>
          </div>
        </CardHeader>
      </Card>

      {moduleDef.slug === "owner-statements" ? (
        <Card>
          <CardHeader>
            <CardTitle>Panel de conciliación</CardTitle>
            <CardDescription>
              Verifica línea por línea el cálculo de este estado del
              propietario.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {ownerStatementReconciliation ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border bg-card p-3">
                  <p className="text-muted-foreground text-xs">
                    Total bruto (reserva + cobros)
                  </p>
                  <p className="font-semibold text-base">
                    {formatCurrency(
                      ownerStatementReconciliation.gross_total ?? 0,
                      ownerStatementCurrency,
                      "es-PY"
                    )}
                  </p>
                </div>
                <div className="rounded-xl border bg-card p-3">
                  <p className="text-muted-foreground text-xs">
                    Neto calculado
                  </p>
                  <p className="font-semibold text-base">
                    {formatCurrency(
                      ownerStatementReconciliation.computed_net_payout ?? 0,
                      ownerStatementCurrency,
                      "es-PY"
                    )}
                  </p>
                </div>
                <div className="rounded-xl border bg-card p-3">
                  <p className="text-muted-foreground text-xs">Neto guardado</p>
                  <p className="font-semibold text-base">
                    {formatCurrency(
                      ownerStatementReconciliation.stored_net_payout ?? 0,
                      ownerStatementCurrency,
                      "es-PY"
                    )}
                  </p>
                </div>
                <div
                  className={cn(
                    "rounded-xl border p-3",
                    reconciliationDiffClass(
                      ownerStatementReconciliation.stored_vs_computed_diff ?? 0
                    )
                  )}
                >
                  <p className="text-xs">Diferencia guardado vs calculado</p>
                  <p className="font-semibold text-base">
                    {formatCurrency(
                      ownerStatementReconciliation.stored_vs_computed_diff ?? 0,
                      ownerStatementCurrency,
                      "es-PY"
                    )}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="rounded-md border">
              <div className="grid grid-cols-[1.2fr_1.1fr_1fr_0.9fr] gap-3 border-b bg-muted/35 px-3 py-2">
                <p className="font-medium text-muted-foreground text-xs">
                  Concepto
                </p>
                <p className="font-medium text-muted-foreground text-xs">
                  Origen
                </p>
                <p className="font-medium text-muted-foreground text-xs">
                  Fecha
                </p>
                <p className="text-right font-medium text-muted-foreground text-xs">
                  Monto (PYG)
                </p>
              </div>
              <div className="max-h-[28rem] divide-y overflow-auto">
                {ownerStatementLineItems.length ? (
                  ownerStatementLineItems.map((line, index) => {
                    const sourceBase = sourceHrefBaseByTable[line.source_table];
                    const sourceHref =
                      sourceBase && isUuid(line.source_id)
                        ? `${sourceBase}/${line.source_id}`
                        : null;

                    const dateLabel =
                      line.date ??
                      (line.from && line.to
                        ? `${line.from} → ${line.to}`
                        : "-");

                    return (
                      <div
                        className="grid grid-cols-[1.2fr_1.1fr_1fr_0.9fr] gap-3 px-3 py-2.5"
                        key={`${line.source_table}:${line.source_id}:${index}`}
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="truncate font-medium text-sm">
                            {humanizeKey(line.bucket)}
                          </p>
                          <p className="truncate text-muted-foreground text-xs">
                            {humanizeKey(line.kind)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          {sourceHref ? (
                            <Link
                              className="font-mono text-primary text-xs underline-offset-4 hover:underline"
                              href={sourceHref}
                              prefetch={false}
                            >
                              {line.source_table}:{shortId(line.source_id)}
                            </Link>
                          ) : (
                            <p className="font-mono text-muted-foreground text-xs">
                              {line.source_table}:{shortId(line.source_id)}
                            </p>
                          )}
                        </div>
                        <p className="text-foreground text-xs">{dateLabel}</p>
                        <p className="text-right text-sm tabular-nums">
                          {formatCurrency(
                            line.amount_pyg,
                            ownerStatementCurrency,
                            "es-PY"
                          )}
                        </p>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-3 py-4 text-muted-foreground text-sm">
                    Este estado aún no expone líneas de conciliación.
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Detalles</CardTitle>
          <CardDescription>
            Haz clic en IDs relacionadas para navegar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="divide-y rounded-md border">
            {keys.map((key) => {
              const value = record[key];

              const text = typeof value === "string" ? value : null;
              const dateLabel = text ? asDateLabel(text) : null;
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
                          key.endsWith("_name")
                            ? "text-sm"
                            : "font-mono text-xs",
                          showMonospace && !key.endsWith("_name")
                            ? "break-all"
                            : ""
                        )}
                        href={fkHref}
                        prefetch={false}
                        title={`Abrir ${key}`}
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
                          {value ? "Sí" : "No"}
                        </p>
                      )
                    ) : typeof value === "number" ? (
                      <p className="text-foreground text-sm tabular-nums">
                        {new Intl.NumberFormat("es-PY", {
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
      </Card>

      {moduleDef.slug === "organizations" ? (
        organizationMembersError ? (
          <Card>
            <CardHeader>
              <CardTitle>Miembros</CardTitle>
              <CardDescription>
                No se pudieron cargar los miembros de esta organización.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-muted-foreground text-sm">
              <p className="break-words">{organizationMembersError}</p>
            </CardContent>
          </Card>
        ) : (
          <OrgMembersCard
            canManage={canManageMembers}
            currentUserId={sessionUserId}
            members={organizationMembers}
            organizationId={recordId}
            ownerUserId={ownerUserId}
          />
        )
      ) : null}

      {moduleDef.slug === "organizations" && canManageMembers ? (
        organizationInvitesError ? (
          <Card>
            <CardHeader>
              <CardTitle>Invitaciones</CardTitle>
              <CardDescription>
                No se pudieron cargar las invitaciones de esta organización.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-muted-foreground text-sm">
              <p className="break-words">{organizationInvitesError}</p>
            </CardContent>
          </Card>
        ) : (
          <OrgInvitesCard
            canManage={canManageMembers}
            invites={organizationInvites}
            organizationId={recordId}
          />
        )
      ) : null}

      {relatedLinks.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Relacionado</CardTitle>
            <CardDescription>
              Salta directamente a flujos vinculados.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {relatedLinks.map((link) => (
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
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
