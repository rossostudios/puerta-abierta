import type { components } from "@/lib/api/types";

export type PropertyRecord = components["schemas"]["Property"] &
  Record<string, unknown>;
export type PropertyRelationRow = Record<string, unknown>;

export type PropertyViewMode = "grid" | "table" | "map";
export type PropertyHealthState = "stable" | "watch" | "critical";

export type PropertyStatusFilter = "all" | "active" | "inactive";
export type PropertyHealthFilter = "all" | PropertyHealthState;

export type PropertyPortfolioRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  address: string;
  city: string;
  unitCount: number;
  activeLeaseCount: number;
  occupancyRate: number;
  revenueMtdPyg: number;
  avgRentPyg: number;
  openTaskCount: number;
  urgentTaskCount: number;
  overdueCollectionCount: number;
  health: PropertyHealthState;
  assetValuePyg: number;
};

export type PropertyPortfolioSummary = {
  totalAssetValuePyg: number;
  averageOccupancy: number;
  averageRentPyg: number;
  totalRevenueMtdPyg: number;
  totalOverdueCollections: number;
  totalOpenTasks: number;
  totalUrgentTasks: number;
  totalUnits: number;
  totalActiveLeases: number;
  totalVacantUnits: number;
  vacancyCostPyg: number;
};

export type PropertyActivityItem = {
  id: string;
  title: string;
  detail: string;
  timestamp: Date;
  tone: "info" | "warning" | "danger" | "success";
};

export type PropertyNotificationItem = {
  id: string;
  title: string;
  detail: string;
  tone: "warning" | "danger" | "info";
};

export type PropertyRelationIndex = {
  propertyIdByUnit: Map<string, string>;
  propertyIdByLease: Map<string, string>;
};
