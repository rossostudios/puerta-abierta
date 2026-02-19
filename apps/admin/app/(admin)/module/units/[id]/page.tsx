import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrgAccessChanged } from "@/components/shell/org-access-changed";
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
import { Icon } from "@/components/ui/icon";
import { getActiveLocale } from "@/lib/i18n/server";
import {
    getModuleDescription,
    getModuleLabel,
    MODULE_BY_SLUG,
} from "@/lib/modules";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";
import { loadRecordDetailData } from "@/lib/features/module-record/fetch-detail";

import { UnitCapacityBento } from "./components/unit-capacity-bento";
import { UnitAboutSection } from "./components/unit-about-section";
import { UnitRelationsSection } from "./components/unit-relations-section";

type UnitRecordPageProps = {
    params: Promise<{ id: string }>;
};

export default async function UnitRecordPage({
    params,
}: UnitRecordPageProps) {
    const locale = await getActiveLocale();
    const isEn = locale === "en-US";
    const { id } = await params;

    // We reuse loadRecordDetailData but specify slug="units"
    const result = await loadRecordDetailData({ slug: "units", id, locale });

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
                            ? "This unit belongs to an organization you no longer have access to. Clear your current selection and switch to an organization where you are a member."
                            : "Esta unidad pertenece a una organización a la que no tienes acceso. Borra la selección actual y cámbiate a una organización de la que seas miembro."
                    }
                    orgId={activeOrgId}
                    title={
                        isEn ? "No access to this unit" : "Sin acceso a esta unidad"
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
                            ? "Could not load unit details from the backend."
                            : "No se pudieron cargar los detalles de la unidad desde el backend."}
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
                            <code className="rounded bg-muted px-1 py-0.5">/units</code>
                        </p>
                    ) : null}
                    <p className="break-words">{result.message}</p>
                </CardContent>
            </Card>
        );
    }

    const moduleDef = MODULE_BY_SLUG.get("units");
    const moduleLabel = moduleDef
        ? getModuleLabel(moduleDef, locale)
        : isEn
            ? "Units"
            : "Unidades";
    const moduleDescription = moduleDef
        ? getModuleDescription(moduleDef, locale)
        : isEn
            ? "Rentable spaces, rooms, or aparments."
            : "Espacios, habitaciones o apartamentos rentables.";

    const { data } = result;
    const href = `/module/units/${data.recordId}`;

    // Use the specific API data returned. Note: `title` is generated inside loadRecordDetailData
    const unitCode = String(data.record.code || data.record.id || "");
    const propertyName = String(data.record.property_name || "");

    return (
        <div>
            <div className="space-y-6">
                <RecordRecent href={href} label={data.title} meta={moduleLabel} />

                <div className="relative rounded-3xl pb-4 pt-2">
                    <div className="relative grid gap-8 px-2 md:px-4">
                        <div className="flex flex-col justify-between space-y-8">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Link
                                            className={cn(
                                                buttonVariants({ variant: "ghost", size: "sm" }),
                                                "h-7 rounded-full px-3 font-semibold text-[10px] uppercase tracking-widest text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground"
                                            )}
                                            href="/module/units"
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
                                            {unitCode}
                                        </Badge>
                                    </div>

                                    <div className="space-y-1">
                                        <h2 className="font-bold text-3xl text-foreground tracking-tight sm:text-4xl">
                                            {data.title}
                                        </h2>
                                        <p className="max-w-2xl font-medium text-muted-foreground text-sm leading-relaxed">
                                            {propertyName ? (
                                                <>
                                                    <Link
                                                        className="font-semibold text-primary/80 hover:text-primary transition-colors hover:underline underline-offset-4"
                                                        href={`/module/properties/${data.record.property_id}`}
                                                    >
                                                        {propertyName}
                                                    </Link>
                                                    {" · "}
                                                </>
                                            ) : null}
                                            {moduleDescription}
                                        </p>
                                    </div>
                                </div>


                            </div>
                        </div>
                    </div>
                </div>

                <UnitCapacityBento
                    record={data.record}
                    isEn={isEn}
                    locale={locale}
                />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-4">
                    <div className="lg:col-span-2">
                        <UnitAboutSection
                            record={data.record}
                            isEn={isEn}
                            locale={locale}
                        />
                    </div>
                    <div className="lg:col-span-1">
                        <UnitRelationsSection
                            links={data.relatedLinks}
                            isEn={isEn}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
