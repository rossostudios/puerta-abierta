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
    const [tab, setTab] = useState<"overview" | "financials" | "operations">("overview");

    return (
        <div className="space-y-6">
            <div className="border-b border-border/60">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    <button
                        aria-current={tab === "overview" ? "page" : undefined}
                        className={cn(
                            "whitespace-nowrap border-b-2 px-1 py-4 font-medium text-sm transition-colors",
                            tab === "overview"
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:border-border/80 hover:text-foreground/80"
                        )}
                        onClick={() => setTab("overview")}
                        type="button"
                    >
                        {isEn ? "Overview" : "Resumen"}
                    </button>
                    <button
                        aria-current={tab === "financials" ? "page" : undefined}
                        className={cn(
                            "whitespace-nowrap border-b-2 px-1 py-4 font-medium text-sm transition-colors",
                            tab === "financials"
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:border-border/80 hover:text-foreground/80"
                        )}
                        onClick={() => setTab("financials")}
                        type="button"
                    >
                        {isEn ? "Financials" : "Finanzas"}
                    </button>
                    <button
                        aria-current={tab === "operations" ? "page" : undefined}
                        className={cn(
                            "whitespace-nowrap border-b-2 px-1 py-4 font-medium text-sm transition-colors",
                            tab === "operations"
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:border-border/80 hover:text-foreground/80"
                        )}
                        onClick={() => setTab("operations")}
                        type="button"
                    >
                        {isEn ? "Operations" : "Operaciones"}
                    </button>
                </nav>
            </div>

            <div className="min-h-[400px] outline-none">
                {tab === "overview" ? (
                    <div className="animate-in fade-in space-y-5 duration-500">
                        {overviewContent}
                    </div>
                ) : null}
                {tab === "financials" ? (
                    <div className="animate-in fade-in space-y-5 duration-500">
                        {financialsContent}
                    </div>
                ) : null}
                {tab === "operations" ? (
                    <div className="animate-in fade-in space-y-5 duration-500">
                        {operationsContent}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
