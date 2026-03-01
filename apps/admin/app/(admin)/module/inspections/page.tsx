import { Suspense } from "react";

import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchList } from "@/lib/api";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { InspectionReports } from "./inspection-reports";

export default async function InspectionsPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();

  if (!orgId) {
    return (
      <NoOrgCard isEn={isEn} resource={["inspections", "inspecciones"]} />
    );
  }

  let reports: Record<string, unknown>[] = [];
  let units: Record<string, unknown>[] = [];

  try {
    const [reportRows, unitRows] = await Promise.all([
      fetchList("/inspection-reports", orgId, 500),
      fetchList("/units", orgId, 500),
    ]);
    reports = reportRows as Record<string, unknown>[];
    units = unitRows as Record<string, unknown>[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message))
      return <OrgAccessChanged orgId={orgId} />;

    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{isEn ? "Vision AI" : "Vision AI"}</Badge>
            <Badge className="text-[11px]" variant="secondary">
              {isEn ? "Inspections" : "Inspecciones"}
            </Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Property Inspections" : "Inspecciones de Propiedades"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "AI-powered property condition assessment. Upload photos for automated defect detection, move-in/out comparison, and cleaning verification."
              : "Evaluación de condición con IA. Sube fotos para detección automática de defectos, comparación de entrada/salida y verificación de limpieza."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <InspectionReports reports={reports} units={units} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
