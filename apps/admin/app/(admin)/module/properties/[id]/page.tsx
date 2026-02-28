import { Location01Icon } from "@hugeicons/core-free-icons";
import { notFound } from "next/navigation";

import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { PinButton } from "@/components/shell/pin-button";
import { RecordRecent } from "@/components/shell/record-recent";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Icon } from "@/components/ui/icon";
import { getActiveLocale } from "@/lib/i18n/server";
import {
  getModuleDescription,
  getModuleLabel,
  MODULE_BY_SLUG,
} from "@/lib/modules";
import { getActiveOrgId } from "@/lib/org";
import { PropertyAiBanner } from "./components/property-ai-banner";
import { PropertyAiFab } from "./components/property-ai-fab";
import {
  PropertyDetailsPanel,
  PropertyDetailsProvider,
  PropertyDetailsTrigger,
} from "./components/property-details-sheet";
import { PropertyOverview } from "./components/property-overview";
import { loadPropertyDetailData } from "./data";

type PropertyRecordPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PropertyRecordPage({
  params,
}: PropertyRecordPageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const { id } = await params;

  const result = await loadPropertyDetailData({ id, locale });

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

    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API request failed" : "Falló la solicitud a la API"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Could not load property details from the backend."
              : "No se pudieron cargar los detalles de la propiedad desde el backend."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground text-sm">
          <p>
            {isEn ? "Backend base URL" : "URL base del backend"}:{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              {result.baseUrl}
            </code>
          </p>
          {result.requestStatus ? (
            <p className="break-words">
              HTTP {result.requestStatus} for{" "}
              <code className="rounded bg-muted px-1 py-0.5">/properties</code>
            </p>
          ) : null}
          <p className="break-words">{result.message}</p>
        </CardContent>
      </Card>
    );
  }

  const moduleDef = MODULE_BY_SLUG.get("properties");
  const moduleLabel = moduleDef
    ? getModuleLabel(moduleDef, locale)
    : isEn
      ? "Properties"
      : "Propiedades";
  const moduleDescription = moduleDef
    ? getModuleDescription(moduleDef, locale)
    : isEn
      ? "Track occupancy, leases, and collections."
      : "Controla ocupación, contratos y cobros.";

  const activeOrgId = await getActiveOrgId();
  const { data } = result;
  const href = `/module/properties/${data.recordId}`;
  const propertyAddress = String(
    data.record.address ?? data.record.location ?? ""
  );
  const occupancyRate = data.overview?.occupancyRate ?? null;
  const unitCount = data.overview?.unitCount ?? 0;
  const propertyStatus = String(data.record.status ?? "active").toLowerCase();
  const isActive = propertyStatus !== "inactive";

  return (
    <PropertyDetailsProvider>
      <div className="space-y-6">
        <RecordRecent href={href} label={data.title} meta={moduleLabel} />

        <header className="flex flex-wrap items-start justify-between gap-4 px-2 md:px-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-bold text-2xl text-foreground tracking-tight">
                {data.title}
              </h2>
              <Badge className="h-6 rounded-md border-border/40 bg-muted/40 px-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                {data.propertyCodeLabel ?? data.recordId}
              </Badge>
              <Badge
                className={
                  isActive
                    ? "h-6 rounded-md border-emerald-500/20 bg-emerald-500/10 px-2.5 font-semibold text-[11px] text-emerald-600"
                    : "h-6 rounded-md border-red-500/20 bg-red-500/10 px-2.5 font-semibold text-[11px] text-red-600"
                }
              >
                {isActive
                  ? isEn
                    ? "Active"
                    : "Activo"
                  : isEn
                    ? "Inactive"
                    : "Inactivo"}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <Icon
                className="text-muted-foreground/60"
                icon={Location01Icon}
                size={14}
              />
              <p className="text-muted-foreground text-sm">
                {data.propertyLocationLabel || moduleDescription}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <PropertyDetailsTrigger fieldCount={data.keys.length} isEn={isEn} />
            <CopyButton
              className="h-9 rounded-xl border-border/60 text-muted-foreground"
              value={data.recordId}
            />
            <PinButton
              className="h-9 rounded-xl bg-foreground px-4 font-semibold text-background hover:bg-foreground/90"
              href={href}
              label={data.title}
              meta={moduleLabel}
            />
          </div>
        </header>

        {activeOrgId && (
          <PropertyAiBanner
            isEn={isEn}
            orgId={activeOrgId}
            propertyId={data.recordId}
            propertyName={data.title}
          />
        )}

        <PropertyDetailsPanel
          isEn={isEn}
          keys={data.keys}
          links={data.relatedLinks}
          locale={locale}
          record={data.record}
          title={data.title}
        />

        {data.overview ? (
          <PropertyOverview
            isEn={isEn}
            locale={locale}
            overview={data.overview}
            recordId={data.recordId}
          />
        ) : null}

        {activeOrgId && (
          <PropertyAiFab
            isEn={isEn}
            occupancyRate={occupancyRate}
            orgId={activeOrgId}
            propertyAddress={propertyAddress}
            propertyCode={data.propertyCodeLabel ?? undefined}
            propertyId={data.recordId}
            propertyName={data.title}
            unitCount={unitCount}
          />
        )}
      </div>
    </PropertyDetailsProvider>
  );
}
