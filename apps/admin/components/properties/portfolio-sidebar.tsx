"use client";

import { AgenticSidebar } from "@/app/(admin)/module/properties/components/agentic-sidebar";
import type { AgentApproval } from "@/lib/api";
import type {
  PropertyActivityItem,
  PropertyPortfolioRow,
} from "@/lib/features/properties/types";

type PortfolioStatsProps = {
  totalValuePyg: number;
  occupancyRate: number;
  avgRentPyg: number;
  totalRevenueMtdPyg: number;
  totalOverdueCollections: number;
  totalVacantUnits: number;
  vacancyCostPyg: number;
  recentActivity: PropertyActivityItem[];
  isEn: boolean;
  formatLocale: "en-US" | "es-PY";
  orgId?: string;
  approvals?: AgentApproval[];
  propertyRows?: PropertyPortfolioRow[];
  agentOnline?: boolean;
};

export function PortfolioSidebar({
  totalValuePyg,
  occupancyRate,
  avgRentPyg,
  totalRevenueMtdPyg,
  totalOverdueCollections,
  totalVacantUnits,
  vacancyCostPyg,
  recentActivity,
  isEn,
  formatLocale,
  orgId,
  approvals = [],
  propertyRows = [],
  agentOnline = false,
}: PortfolioStatsProps) {
  return (
    <AgenticSidebar
      agentOnline={agentOnline}
      approvals={approvals}
      avgRentPyg={avgRentPyg}
      formatLocale={formatLocale}
      isEn={isEn}
      occupancyRate={occupancyRate}
      orgId={orgId}
      propertyRows={propertyRows}
      recentActivity={recentActivity}
      totalOverdueCollections={totalOverdueCollections}
      totalRevenueMtdPyg={totalRevenueMtdPyg}
      totalVacantUnits={totalVacantUnits}
      totalValuePyg={totalValuePyg}
      vacancyCostPyg={vacancyCostPyg}
    />
  );
}
