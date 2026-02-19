import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { notFound } from "next/navigation";

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
import { getActiveLocale } from "@/lib/i18n/server";
import {
  getModuleDescription,
  getModuleLabel,
  MODULE_BY_SLUG,
} from "@/lib/modules";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";
import {
  PropertyDetailsPanel,
  PropertyDetailsProvider,
  PropertyDetailsTrigger,
} from "./components/property-details-sheet";
import { PropertyLocationMiniMap } from "./components/property-location-mini-map";
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

  const { data } = result;
  const href = `/module/properties/${data.recordId}`;
  const city = String(data.record.city ?? data.record.district ?? "asuncion");

  return (
    <PropertyDetailsProvider>
      <div className="space-y-6">
        <RecordRecent href={href} label={data.title} meta={moduleLabel} />

        <div className="relative rounded-3xl pb-4 pt-2">
          <div className="relative grid gap-8 px-2 md:px-4 xl:grid-cols-[1fr_320px]">
            <div className="flex flex-col justify-between space-y-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "sm" }),
                        "h-7 rounded-full px-3 font-semibold text-[10px] uppercase tracking-widest text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground"
                      )}
                      href="/module/properties"
                    >
                      <Icon icon={ArrowLeft01Icon} size={12} className="mr-1" />
                      {isEn ? "Back" : "Volver"}
                    </Link>
                    <Badge
                      className="h-7 rounded-full border-border/30 bg-muted/30 px-3 font-semibold text-[10px] text-muted-foreground uppercase tracking-widest backdrop-blur-sm"
                      variant="outline"
                    >
                      {moduleLabel}
                    </Badge>
                    <Badge className="h-7 rounded-full border-primary/20 bg-primary/10 px-3 font-semibold text-[10px] text-primary uppercase tracking-widest backdrop-blur-sm">
                      {data.propertyCodeLabel ?? data.recordId}
                    </Badge>
                  </div>

                  <div className="space-y-1">
                    <h2 className="font-bold text-3xl text-foreground tracking-tight sm:text-4xl">
                      {data.title}
                    </h2>
                    <p className="max-w-2xl font-medium text-muted-foreground text-sm leading-relaxed">
                      {data.propertyLocationLabel || moduleDescription}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <PropertyDetailsTrigger
                    fieldCount={data.keys.length}
                    isEn={isEn}
                  />
                  <CopyButton
                    className="h-9 rounded-full border-border/40 bg-muted/40 px-4 hover:bg-muted/80 text-muted-foreground"
                    value={data.recordId}
                  />
                  <PinButton
                    className="h-9 rounded-full border-border/40 bg-muted/40 px-4 hover:bg-muted/80 text-muted-foreground"
                    href={href}
                    label={data.title}
                    meta={moduleLabel}
                  />
                </div>
              </div>
            </div>

            <div className="hidden xl:flex xl:items-end">
              <PropertyLocationMiniMap city={city} isEn={isEn} />
            </div>
          </div>
        </div>

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
      </div>
    </PropertyDetailsProvider>
  );
}
