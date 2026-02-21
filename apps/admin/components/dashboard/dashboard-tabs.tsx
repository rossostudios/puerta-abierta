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
    <div className="space-y-6">
      <div className="inline-flex items-center gap-0.5 rounded-xl bg-muted/40 p-1 ring-1 ring-border/20 ring-inset">
        <button
          aria-current={tab === "overview" ? "page" : undefined}
          className={cn(
            "whitespace-nowrap rounded-lg px-3 py-2 font-medium text-sm transition-all duration-200",
            tab === "overview"
              ? "bg-white/60 text-foreground shadow-sm ring-1 ring-white/50 ring-inset dark:bg-white/10 dark:ring-white/[0.08]"
              : "text-muted-foreground hover:bg-white/30 hover:text-foreground/80 dark:hover:bg-white/[0.06]"
          )}
          onClick={() => setTab("overview")}
          type="button"
        >
          {isEn ? "Overview" : "Resumen"}
        </button>
        <button
          aria-current={tab === "financials" ? "page" : undefined}
          className={cn(
            "whitespace-nowrap rounded-lg px-3 py-2 font-medium text-sm transition-all duration-200",
            tab === "financials"
              ? "bg-white/60 text-foreground shadow-sm ring-1 ring-white/50 ring-inset dark:bg-white/10 dark:ring-white/[0.08]"
              : "text-muted-foreground hover:bg-white/30 hover:text-foreground/80 dark:hover:bg-white/[0.06]"
          )}
          onClick={() => setTab("financials")}
          type="button"
        >
          {isEn ? "Financials" : "Finanzas"}
        </button>
        <button
          aria-current={tab === "operations" ? "page" : undefined}
          className={cn(
            "whitespace-nowrap rounded-lg px-3 py-2 font-medium text-sm transition-all duration-200",
            tab === "operations"
              ? "bg-white/60 text-foreground shadow-sm ring-1 ring-white/50 ring-inset dark:bg-white/10 dark:ring-white/[0.08]"
              : "text-muted-foreground hover:bg-white/30 hover:text-foreground/80 dark:hover:bg-white/[0.06]"
          )}
          onClick={() => setTab("operations")}
          type="button"
        >
          {isEn ? "Operations" : "Operaciones"}
        </button>
      </div>

      <div className="min-h-[400px] outline-none">
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
