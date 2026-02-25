"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

type DashboardTabsProps = {
  isEn: boolean;
  overviewContent: React.ReactNode;
  financialsContent: React.ReactNode;
  operationsContent: React.ReactNode;
};

export function DashboardTabs({
  isEn,
  overviewContent,
  financialsContent,
  operationsContent,
}: DashboardTabsProps) {
  const [tab, setTab] = useState<"overview" | "financials" | "operations">(
    "overview"
  );

  return (
    <div className="space-y-5">
      <div className="border-border/60 border-b">
        <div className="flex items-center gap-5 overflow-x-auto">
          <button
            aria-current={tab === "overview" ? "page" : undefined}
            className={cn(
              "relative -mb-px whitespace-nowrap border-b-2 border-transparent px-0 py-3 font-medium text-sm transition-colors",
              tab === "overview"
                ? "border-[var(--sidebar-primary)] text-[var(--sidebar-primary)]"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("overview")}
            type="button"
          >
            {isEn ? "Overview" : "Resumen"}
          </button>
          <button
            aria-current={tab === "financials" ? "page" : undefined}
            className={cn(
              "relative -mb-px whitespace-nowrap border-b-2 border-transparent px-0 py-3 font-medium text-sm transition-colors",
              tab === "financials"
                ? "border-[var(--sidebar-primary)] text-[var(--sidebar-primary)]"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("financials")}
            type="button"
          >
            {isEn ? "Financials" : "Finanzas"}
          </button>
          <button
            aria-current={tab === "operations" ? "page" : undefined}
            className={cn(
              "relative -mb-px whitespace-nowrap border-b-2 border-transparent px-0 py-3 font-medium text-sm transition-colors",
              tab === "operations"
                ? "border-[var(--sidebar-primary)] text-[var(--sidebar-primary)]"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("operations")}
            type="button"
          >
            {isEn ? "Operations" : "Operaciones"}
          </button>
        </div>
      </div>

      <div className="min-h-[320px] outline-none">
        {tab === "overview" ? (
          <div className="fade-in animate-in space-y-5 duration-500">
            {overviewContent}
          </div>
        ) : null}
        {tab === "financials" ? (
          <div className="fade-in animate-in space-y-5 duration-500">
            {financialsContent}
          </div>
        ) : null}
        {tab === "operations" ? (
          <div className="fade-in animate-in space-y-5 duration-500">
            {operationsContent}
          </div>
        ) : null}
      </div>
    </div>
  );
}
