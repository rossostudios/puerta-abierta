import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { notFound, redirect, unstable_rethrow } from "next/navigation";

import { PropertyDashboard } from "@/components/module-record/property-dashboard";
import { RecordDetailsCard } from "@/components/module-record/record-details-card";
import { StatementPanel } from "@/components/module-record/statement-panel";
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
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { loadRecordDetailData } from "@/lib/features/module-record/fetch-detail";
import {
  loadPropertyRelationSnapshot,
  toStatementLineItems,
  toStatementReconciliation,
} from "@/lib/features/module-record/data";
import { buildPropertyOverview } from "@/lib/features/module-record/property-overview";
import { buildRelatedLinks } from "@/lib/features/module-record/related-links";
import type {
  OrganizationInviteRow,
  OrganizationMemberRow,
  RecordPageProps,
} from "@/lib/features/module-record/types";
import {
  isOrganizationInviteRow,
  isOrganizationMemberRow,
} from "@/lib/features/module-record/types";
import {
  asString,
  getFirstValue,
  recordTitle,
  sortKeys,
} from "@/lib/features/module-record/utils";
import { getActiveLocale } from "@/lib/i18n/server";
import {
  getModuleDescription,
  getModuleLabel,
  MODULE_BY_SLUG,
} from "@/lib/modules";
import { getActiveOrgId } from "@/lib/org";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export default async function ModuleRecordPage({ params }: RecordPageProps) {
  const { slug, id } = await params;
  const activeLocale = await getActiveLocale();
  const isEn = activeLocale === "en-US";
  const formatLocale = isEn ? "en-US" : "es-PY";
  const moduleDef = MODULE_BY_SLUG.get(slug);
  if (!moduleDef || moduleDef.kind === "report") {
    notFound();
  }
  if (moduleDef.slug === "properties") {
    redirect(`/module/properties/${encodeURIComponent(id)}`);
  }
  if (moduleDef.slug === "units") {
    redirect(`/module/units/${encodeURIComponent(id)}`);
  }
  const moduleLabel = getModuleLabel(moduleDef, activeLocale);
  const moduleDescription = getModuleDescription(moduleDef, activeLocale);

  const result = await loadRecordDetailData({ slug, id, locale: activeLocale });

  if (result.kind === "not_found") {
    notFound();
  }

  if (result.kind === "error") {
    if (result.membershipError) {
      const activeOrgId = await getActiveOrgId();
      return (
        <OrgAccessChanged
          description={
            isEn
              ? "This record belongs to an organization you no longer have access to. Clear your current selection and switch to an organization where you are a member."
              : "Este registro pertenece a una organización a la que no tienes acceso. Borra la selección actual y cámbiate a una organización de la que seas miembro."
          }
          orgId={activeOrgId}
          title={
            isEn ? "No access to this record" : "Sin acceso a este registro"
          }
        />
      );
    }

    const title = result.requestStatus
      ? isEn
        ? "API request failed"
        : "Falló la solicitud a la API"
      : isEn
        ? "API connection failed"
        : "Fallo de conexión a la API";
    const detail = result.requestStatus
      ? isEn
        ? "Could not load record details from the backend."
        : "No se pudieron cargar los detalles del registro desde el backend."
      : isEn
        ? "Could not connect to the backend to load record details."
        : "No se pudo conectar al backend para cargar los detalles del registro.";

    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{detail}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground text-sm">
          <p>
            {isEn ? "Backend base URL" : "URL base del backend"}:{" "}
            <code className="rounded bg-muted px-1 py-0.5">{result.baseUrl}</code>
          </p>
          {result.requestStatus ? (
            <p className="break-words">
              HTTP {result.requestStatus} for{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {moduleDef.endpoint}
              </code>
            </p>
          ) : null}
          <p className="break-words">
            {result.message}
          </p>
          <p>
            {isEn
              ? "Make sure the backend is running (`cd apps/backend-rs && cargo run`)"
              : "Asegúrate de que el backend esté ejecutándose (`cd apps/backend-rs && cargo run`)"}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { record, title, recordId } = result.data;
  const baseUrl = result.baseUrl;

  let accessToken: string | null = null;
  let sessionUserId: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getSession();
    accessToken = data.session?.access_token ?? null;
    sessionUserId = data.session?.user?.id ?? null;
  } catch (err) {
    // Session is optional
  }

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

  let propertyOverview:
    | import("@/lib/features/module-record/property-overview").PropertyOverviewData
    | null = null;
  if (moduleDef.slug === "properties") {
    const organizationId = asString(record.organization_id);
    if (organizationId) {
      const snapshot = await loadPropertyRelationSnapshot({
        accessToken,
        baseUrl,
        orgId: organizationId,
        propertyId: recordId,
      });
      propertyOverview = buildPropertyOverview(
        snapshot,
        recordId,
        isEn,
        formatLocale
      );
    }
  }

  const relatedLinks = buildRelatedLinks(moduleDef.slug, recordId, isEn);

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

  const keys = sortKeys(Object.keys(record)).filter((key) => {
    if (moduleDef.slug !== "owner-statements") return true;
    return key !== "line_items" && key !== "reconciliation";
  });
  const propertyLocationLabel =
    moduleDef.slug === "properties"
      ? [
        getFirstValue(record, ["district", "neighborhood", "city"]),
        getFirstValue(record, ["address", "street_address", "location"]),
      ]
        .filter((value): value is string => Boolean(value))
        .join(" · ")
      : "";
  const propertyCodeLabel =
    moduleDef.slug === "properties"
      ? getFirstValue(record, ["code", "public_name", "id"])
      : null;

  return (
    <div className="space-y-6">
      <RecordRecent href={href} label={title} meta={moduleLabel} />
      {moduleDef.slug !== "properties" && (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {isEn ? "Record" : "Registro"}
                  </Badge>
                  <Badge className="text-[11px]" variant="secondary">
                    {moduleLabel}
                  </Badge>
                </div>
                <CardTitle className="text-2xl">{title}</CardTitle>
                <CardDescription>{moduleDescription}</CardDescription>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                  href={`/module/${moduleDef.slug}`}
                >
                  <Icon icon={ArrowLeft01Icon} size={16} />
                  {isEn ? "Back to module" : "Volver al módulo"}
                </Link>
                <CopyButton
                  label={isEn ? "Copy ID" : "Copiar ID"}
                  value={recordId}
                />
                <PinButton href={href} label={title} meta={moduleLabel} />
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      {moduleDef.slug === "owner-statements" ? (
        <StatementPanel
          currency={ownerStatementCurrency}
          isEn={isEn}
          lineItems={ownerStatementLineItems}
          locale={formatLocale}
          reconciliation={ownerStatementReconciliation}
        />
      ) : null}

      {propertyOverview ? (
        <PropertyDashboard
          href={href}
          isEn={isEn}
          locale={formatLocale}
          moduleDef={moduleDef}
          moduleDescription={moduleDescription}
          moduleLabel={moduleLabel}
          propertyCodeLabel={propertyCodeLabel}
          propertyLocationLabel={propertyLocationLabel}
          propertyOverview={propertyOverview}
          recordId={recordId}
          title={title}
        />
      ) : null}

      <RecordDetailsCard
        isEn={isEn}
        keys={keys}
        locale={formatLocale}
        record={record}
      />

      {moduleDef.slug === "organizations" ? (
        organizationMembersError ? (
          <Card>
            <CardHeader>
              <CardTitle>{isEn ? "Members" : "Miembros"}</CardTitle>
              <CardDescription>
                {isEn
                  ? "Could not load members for this organization."
                  : "No se pudieron cargar los miembros de esta organización."}
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
              <CardTitle>{isEn ? "Invites" : "Invitaciones"}</CardTitle>
              <CardDescription>
                {isEn
                  ? "Could not load invites for this organization."
                  : "No se pudieron cargar las invitaciones de esta organización."}
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
            <CardTitle>{isEn ? "Related" : "Relacionado"}</CardTitle>
            <CardDescription>
              {isEn
                ? "Jump directly to linked workflows."
                : "Salta directamente a flujos vinculados."}
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
