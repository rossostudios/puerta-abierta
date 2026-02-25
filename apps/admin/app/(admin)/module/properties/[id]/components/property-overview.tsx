import type { PropertyOverview as PropertyOverviewData } from "../types";
import { PropertyOverviewFinancial } from "./property-overview-financial";
import { PropertyOverviewKpiCards } from "./property-overview-kpi-cards";
import { PropertyOverviewOperations } from "./property-overview-operations";

type PropertyOverviewProps = {
  overview: PropertyOverviewData;
  recordId: string;
  locale: "en-US" | "es-PY";
  isEn: boolean;
};

export function PropertyOverview({
  overview,
  recordId,
  locale,
  isEn,
}: PropertyOverviewProps) {
  return (
    <div className="space-y-6">
      <PropertyOverviewKpiCards
        isEn={isEn}
        locale={locale}
        overview={overview}
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <PropertyOverviewOperations
          isEn={isEn}
          locale={locale}
          overview={overview}
          recordId={recordId}
        />
        <PropertyOverviewFinancial
          isEn={isEn}
          locale={locale}
          overview={overview}
          recordId={recordId}
        />
      </div>
    </div>
  );
}
