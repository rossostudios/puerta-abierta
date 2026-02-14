import { ArrowLeft01Icon, Building03Icon } from "@hugeicons/core-free-icons";
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

        <Card className="overflow-hidden border-border/60 bg-card/50 shadow-sm backdrop-blur-md">
          <CardContent className="p-0">
            <section className="relative overflow-hidden bg-[#fdfcfb] dark:bg-neutral-900/40">
              <div className="absolute -top-16 -right-16 opacity-[0.03] dark:opacity-[0.08]">
                <Icon icon={Building03Icon} size={320} />
              </div>

              <div className="relative grid gap-8 p-6 md:p-8 xl:grid-cols-[1fr_320px]">
                <div className="flex flex-col justify-between space-y-8">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          className={cn(
                            buttonVariants({ variant: "secondary", size: "sm" }),
                            "h-7 rounded-lg border-border/10 bg-background/50 px-2.5 font-bold text-[10px] uppercase tracking-wider transition-all hover:bg-background/80"
                          )}
                          href="/module/properties"
                        >
                          <Icon icon={ArrowLeft01Icon} size={12} />
                          {isEn ? "Back" : "Volver"}
                        </Link>
                        <Badge
                          className="h-7 border-border/10 bg-background/50 font-bold text-[10px] text-muted-foreground uppercase tracking-wider backdrop-blur-sm"
                          variant="outline"
                        >
                          {moduleLabel}
                        </Badge>
                        <Badge className="h-7 border-primary/20 bg-primary/5 font-bold text-[10px] text-primary uppercase tracking-wider backdrop-blur-sm">
                          {data.propertyCodeLabel ?? data.recordId}
                        </Badge>
                        {data.overview ? (
                          <span
                            className={cn(
                              "h-2.5 w-2.5 rounded-full shadow-sm",
                              data.overview.health === "critical"
                                ? "bg-[var(--status-danger-fg)] animate-pulse"
                                : data.overview.health === "watch"
                                  ? "bg-[var(--status-warning-fg)]"
                                  : "bg-[var(--status-success-fg)]"
                            )}
                          />
                        ) : null}
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
                        className="h-9 rounded-xl border-border/40 bg-background/40 px-3 hover:bg-background/80"
                        value={data.recordId}
                      />
                      <PinButton
                        className="h-9 rounded-xl border-border/40 bg-background/40 px-3 hover:bg-background/80"
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
            </section>
          </CardContent>
        </Card>

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
