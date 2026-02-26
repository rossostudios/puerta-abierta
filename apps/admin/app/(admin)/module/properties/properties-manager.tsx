"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DataImportSheet } from "@/components/import/data-import-sheet";
import { PortfolioSidebar } from "@/components/properties/portfolio-sidebar";
import { filterPropertyPortfolioRows } from "@/lib/features/properties/analytics";
import type { AgentDefinition } from "@/lib/api";
import { normalizeAgents } from "@/components/agent/chat-thread-types";
import type {
  PropertyHealthFilter,
  PropertyRecord,
  PropertyRelationRow,
  PropertyStatusFilter,
  PropertyViewMode,
} from "@/lib/features/properties/types";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useActiveLocale, useDictionary } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { AiInsightsBanner } from "./components/ai-insights-banner";
import { CreatePropertySheet } from "./components/create-property-sheet";
import { PropertiesFeedback } from "./components/properties-feedback";
import { PropertiesFilterBar } from "./components/properties-filter-bar";
import { PropertiesList } from "./components/properties-list";
import { PropertiesPageHeader } from "./components/properties-page-header";
import { usePropertyPortfolio } from "./hooks/use-property-portfolio";

type PropertiesPageDictionary = {
  title: string;
  description: string;
};

type PropertiesManagerProps = {
  orgId: string;
  properties: PropertyRecord[];
  units: PropertyRelationRow[];
  leases: PropertyRelationRow[];
  tasks: PropertyRelationRow[];
  collections: PropertyRelationRow[];
  dictionary?: PropertiesPageDictionary;
  error?: string;
  success?: string;
};

export function PropertiesManager({
  orgId,
  properties,
  units,
  leases,
  tasks,
  collections,
  dictionary: pageDict,
  error: errorLabel,
  success: successMessage,
}: PropertiesManagerProps) {
  const { properties: dict, common } = useDictionary();
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const formatLocale = isEn ? "en-US" : "es-PY";

  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [viewMode, setViewMode] = useState<PropertyViewMode>("grid");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<PropertyStatusFilter>("all");
  const [healthFilter, setHealthFilter] = useState<PropertyHealthFilter>("all");
  const isWide = useMediaQuery("(min-width: 1440px)");
  const isMedium = useMediaQuery("(min-width: 1280px)");
  const [userSidebarPref, setUserSidebarPref] = useState<boolean>(false);
  const isSidebarOpen = userSidebarPref;

  const previousSidebarRef = useRef(isSidebarOpen);

  const handleViewModeChange = useCallback(
    (next: PropertyViewMode) => {
      if (next === "map") {
        previousSidebarRef.current = isSidebarOpen;
        setUserSidebarPref(false);
      } else if (viewMode === "map") {
        setUserSidebarPref(previousSidebarRef.current);
      }
      setViewMode(next);
    },
    [isSidebarOpen, viewMode]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const { rows, summary, recentActivity, notifications } = usePropertyPortfolio(
    {
      locale,
      properties,
      units,
      leases,
      tasks,
      collections,
    }
  );

  // Agent status for AI column
  const agentsQuery = useQuery<AgentDefinition[], Error>({
    queryKey: ["agents-property-status", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/agents?org_id=${encodeURIComponent(orgId)}`,
        { method: "GET", cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok) return [];
      const payload = (await res.json()) as unknown;
      return normalizeAgents(payload);
    },
    staleTime: 60_000,
    enabled: !!orgId,
    retry: false,
  });

  const agentStatus: "active" | "offline" | "loading" = agentsQuery.isPending
    ? "loading"
    : (agentsQuery.data ?? []).some((a) => a.is_active !== false)
      ? "active"
      : "offline";

  const filteredRows = useMemo(
    () =>
      filterPropertyPortfolioRows({
        rows,
        query,
        statusFilter,
        healthFilter,
      }),
    [healthFilter, query, rows, statusFilter]
  );

  const title = pageDict?.title || dict.title;
  const description = pageDict?.description || dict.description;

  return (
    <div className="flex w-full bg-background">
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-7xl space-y-6">
            <PropertiesPageHeader
              description={description}
              importLabel={isEn ? "Import" : "Importar"}
              newPropertyLabel={dict.newProperty}
              onOpenCreate={() => setOpen(true)}
              onOpenImport={() => setImportOpen(true)}
              recordCount={filteredRows.length}
              recordsLabel={common.records}
              title={title}
            />

            <AiInsightsBanner
              isEn={isEn}
              orgId={orgId}
              propertyCount={filteredRows.length}
            />

            <PropertiesFeedback
              error={errorLabel ?? ""}
              errorLabel={common.error}
              success={successMessage ?? ""}
              successLabel={common.success}
            />

            <PropertiesFilterBar
              healthFilter={healthFilter}
              isEn={isEn}
              isSidebarOpen={isSidebarOpen}
              onHealthFilterChange={setHealthFilter}
              onQueryChange={setQuery}
              onStatusFilterChange={setStatusFilter}
              onToggleSidebar={() =>
                setUserSidebarPref((prev) => !prev)
              }
              onViewModeChange={handleViewModeChange}
              query={query}
              statusFilter={statusFilter}
              viewMode={viewMode}
            />

            <PropertiesList
              agentStatus={agentStatus}
              isSidebarOpen={isSidebarOpen}
              locale={locale}
              rows={filteredRows}
              summary={summary}
              viewMode={viewMode}
            />
        </div>
      </div>

      <aside
        className={cn(
          "shrink-0 border-border/30 border-l transition-all duration-300 ease-in-out",
          isSidebarOpen
            ? isWide
              ? "w-[360px]"
              : "w-[320px]"
            : "w-0 overflow-hidden border-l-0"
        )}
      >
        <div
          className={cn(
            "sticky top-0 max-h-[calc(100dvh-8rem)] overflow-y-auto py-6",
            isWide ? "px-5" : "px-4"
          )}
        >
          <PortfolioSidebar
            avgRentPyg={summary.averageRentPyg}
            formatLocale={formatLocale}
            isEn={isEn}
            notifications={notifications}
            occupancyRate={summary.averageOccupancy}
            orgId={orgId}
            recentActivity={recentActivity}
            totalOverdueCollections={summary.totalOverdueCollections}
            totalRevenueMtdPyg={summary.totalRevenueMtdPyg}
            totalVacantUnits={summary.totalVacantUnits}
            totalValuePyg={summary.totalAssetValuePyg}
            vacancyCostPyg={summary.vacancyCostPyg}
          />
        </div>
      </aside>

      <CreatePropertySheet
        cancelLabel={common.cancel}
        codeLabel={dict.code}
        createLabel={common.create}
        description={dict.description}
        isEn={isEn}
        nameLabel={dict.name}
        onOpenChange={setOpen}
        open={open}
        orgId={orgId}
        title={dict.newProperty}
      />

      <DataImportSheet
        isEn={isEn}
        mode="properties"
        onOpenChange={setImportOpen}
        open={importOpen}
        orgId={orgId}
      />
    </div>
  );
}
