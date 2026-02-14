import {
  asNumber,
  asString,
  COLLECTION_OPEN_STATUSES,
  COLLECTION_REVENUE_STATUSES,
  convertAmountToPyg,
  LEASE_ACTIVE_STATUSES,
  normalizedStatus,
  TASK_CLOSED_STATUSES,
  toDate,
  URGENT_TASK_PRIORITIES,
} from "./analytics-shared";
import type {
  PropertyHealthFilter,
  PropertyPortfolioRow,
  PropertyPortfolioSummary,
  PropertyRecord,
  PropertyRelationIndex,
  PropertyRelationRow,
  PropertyStatusFilter,
} from "./types";

export function buildPropertyRelationIndex(
  units: PropertyRelationRow[],
  leases: PropertyRelationRow[]
): PropertyRelationIndex {
  const propertyIdByUnit = new Map<string, string>();
  for (const unit of units) {
    const unitId = asString(unit.id);
    const propertyId = asString(unit.property_id);
    if (unitId && propertyId) {
      propertyIdByUnit.set(unitId, propertyId);
    }
  }

  const propertyIdByLease = new Map<string, string>();
  for (const lease of leases) {
    const leaseId = asString(lease.id);
    const propertyId =
      asString(lease.property_id) ||
      propertyIdByUnit.get(asString(lease.unit_id)) ||
      "";
    if (leaseId && propertyId) {
      propertyIdByLease.set(leaseId, propertyId);
    }
  }

  return { propertyIdByUnit, propertyIdByLease };
}

export function buildPropertyPortfolioRows(params: {
  properties: PropertyRecord[];
  units: PropertyRelationRow[];
  leases: PropertyRelationRow[];
  tasks: PropertyRelationRow[];
  collections: PropertyRelationRow[];
  relationIndex: PropertyRelationIndex;
}): PropertyPortfolioRow[] {
  const { properties, units, leases, tasks, collections, relationIndex } =
    params;
  const { propertyIdByLease, propertyIdByUnit } = relationIndex;

  const now = new Date();
  const monthPrefix = now.toISOString().slice(0, 7);

  const unitsByProperty = new Map<string, PropertyRelationRow[]>();
  for (const unit of units) {
    const propertyId = asString(unit.property_id);
    if (!propertyId) continue;
    const bucket = unitsByProperty.get(propertyId);
    if (bucket) bucket.push(unit);
    else unitsByProperty.set(propertyId, [unit]);
  }

  const activeLeaseCountByProperty = new Map<string, number>();
  const occupiedUnitIdsByProperty = new Map<string, Set<string>>();
  const projectedRentByProperty = new Map<string, number>();

  for (const lease of leases) {
    const leaseStatus = normalizedStatus(lease.lease_status || lease.status);
    if (!LEASE_ACTIVE_STATUSES.has(leaseStatus)) continue;

    const propertyId =
      asString(lease.property_id) ||
      propertyIdByUnit.get(asString(lease.unit_id)) ||
      "";
    if (!propertyId) continue;

    activeLeaseCountByProperty.set(
      propertyId,
      (activeLeaseCountByProperty.get(propertyId) ?? 0) + 1
    );

    const unitId = asString(lease.unit_id);
    if (unitId) {
      if (!occupiedUnitIdsByProperty.has(propertyId)) {
        occupiedUnitIdsByProperty.set(propertyId, new Set<string>());
      }
      occupiedUnitIdsByProperty.get(propertyId)?.add(unitId);
    }

    const amount = asNumber(lease.monthly_rent) ?? 0;
    const currency = asString(lease.currency) || "PYG";
    const fxRate = asNumber(lease.fx_rate_to_pyg);
    const amountPyg = convertAmountToPyg(amount, currency, fxRate);
    projectedRentByProperty.set(
      propertyId,
      (projectedRentByProperty.get(propertyId) ?? 0) + amountPyg
    );
  }

  const openTaskCountByProperty = new Map<string, number>();
  const urgentTaskCountByProperty = new Map<string, number>();

  for (const task of tasks) {
    const status = normalizedStatus(task.status);
    if (TASK_CLOSED_STATUSES.has(status)) continue;

    const propertyId =
      asString(task.property_id) ||
      propertyIdByUnit.get(asString(task.unit_id)) ||
      "";
    if (!propertyId) continue;

    openTaskCountByProperty.set(
      propertyId,
      (openTaskCountByProperty.get(propertyId) ?? 0) + 1
    );

    const dueAt = toDate(task.due_at);
    const isOverdue = dueAt !== null && dueAt.getTime() < now.getTime();
    const highPriority = URGENT_TASK_PRIORITIES.has(
      normalizedStatus(task.priority)
    );
    if (isOverdue || highPriority) {
      urgentTaskCountByProperty.set(
        propertyId,
        (urgentTaskCountByProperty.get(propertyId) ?? 0) + 1
      );
    }
  }

  const revenueMtdPygByProperty = new Map<string, number>();
  const overdueCollectionCountByProperty = new Map<string, number>();

  for (const collection of collections) {
    const propertyId =
      propertyIdByLease.get(asString(collection.lease_id)) ||
      asString(collection.property_id);
    if (!propertyId) continue;

    const status = normalizedStatus(collection.status);
    const dueDateText = asString(collection.due_date);
    const paidAtText = asString(collection.paid_at);
    const dueDate = toDate(collection.due_date);

    const amount = asNumber(collection.amount) ?? 0;
    const currency = asString(collection.currency) || "PYG";
    const fxRate = asNumber(collection.fx_rate_to_pyg);
    const amountPyg = convertAmountToPyg(amount, currency, fxRate);

    const isCurrentMonth =
      dueDateText.startsWith(monthPrefix) || paidAtText.startsWith(monthPrefix);
    if (isCurrentMonth && COLLECTION_REVENUE_STATUSES.has(status)) {
      revenueMtdPygByProperty.set(
        propertyId,
        (revenueMtdPygByProperty.get(propertyId) ?? 0) + amountPyg
      );
    }

    if (
      COLLECTION_OPEN_STATUSES.has(status) &&
      dueDate !== null &&
      dueDate.getTime() < now.getTime()
    ) {
      overdueCollectionCountByProperty.set(
        propertyId,
        (overdueCollectionCountByProperty.get(propertyId) ?? 0) + 1
      );
    }
  }

  const rows: PropertyPortfolioRow[] = [];
  for (const property of properties) {
    const id = asString(property.id);
    if (!id) continue;

    const name = asString(property.name) || id;
    const code = asString(property.code) || name.slice(0, 6).toUpperCase();
    const status = normalizedStatus(property.status) || "active";
    const city = asString(property.city);
    const address =
      asString(property.address_line1) || asString(property.address);

    const unitCount = unitsByProperty.get(id)?.length ?? 0;
    const occupiedUnitCount = occupiedUnitIdsByProperty.get(id)?.size ?? 0;
    const activeLeaseCount = activeLeaseCountByProperty.get(id) ?? 0;
    const occupancyRate = unitCount
      ? Math.round((occupiedUnitCount / unitCount) * 100)
      : 0;

    const projectedRentPyg = projectedRentByProperty.get(id) ?? 0;
    const revenueMtdPyg = revenueMtdPygByProperty.get(id) ?? 0;
    const revenueDisplayPyg =
      revenueMtdPyg > 0 ? revenueMtdPyg : projectedRentPyg;
    const avgRentPyg = activeLeaseCount
      ? projectedRentPyg / activeLeaseCount
      : unitCount
        ? projectedRentPyg / unitCount
        : 0;

    const openTaskCount = openTaskCountByProperty.get(id) ?? 0;
    const urgentTaskCount = urgentTaskCountByProperty.get(id) ?? 0;
    const overdueCollectionCount =
      overdueCollectionCountByProperty.get(id) ?? 0;

    const health =
      status === "inactive" || (unitCount > 0 && occupancyRate === 0)
        ? "critical"
        : urgentTaskCount > 0 ||
            overdueCollectionCount > 0 ||
            occupancyRate < 70
          ? "watch"
          : "stable";

    const assetValueSource =
      asNumber(property.asset_value) ??
      asNumber(property.market_value) ??
      asNumber(property.purchase_price) ??
      asNumber(property.valuation) ??
      0;
    const assetValuePyg =
      assetValueSource > 0
        ? assetValueSource
        : Math.max(revenueDisplayPyg * 96, 0);

    rows.push({
      id,
      code,
      name,
      status,
      address,
      city,
      unitCount,
      activeLeaseCount,
      occupancyRate,
      revenueMtdPyg: revenueDisplayPyg,
      avgRentPyg,
      openTaskCount,
      urgentTaskCount,
      overdueCollectionCount,
      health,
      assetValuePyg,
    });
  }

  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

export function filterPropertyPortfolioRows(params: {
  rows: PropertyPortfolioRow[];
  query: string;
  statusFilter: PropertyStatusFilter;
  healthFilter: PropertyHealthFilter;
}): PropertyPortfolioRow[] {
  const { rows, query, statusFilter, healthFilter } = params;
  const normalizedQuery = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (healthFilter !== "all" && row.health !== healthFilter) return false;
    if (!normalizedQuery) return true;
    const haystack =
      `${row.name} ${row.code} ${row.address} ${row.city}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function buildPropertyPortfolioSummary(
  rows: PropertyPortfolioRow[]
): PropertyPortfolioSummary {
  const rowCount = rows.length;
  const totalAssetValuePyg = rows.reduce(
    (total, row) => total + row.assetValuePyg,
    0
  );
  const averageOccupancy = rowCount
    ? rows.reduce((total, row) => total + row.occupancyRate, 0) / rowCount
    : 0;
  const rowsWithRent = rows.filter((row) => row.avgRentPyg > 0);
  const averageRentPyg = rowsWithRent.length
    ? rowsWithRent.reduce((total, row) => total + row.avgRentPyg, 0) /
      rowsWithRent.length
    : 0;

  const totalRevenueMtdPyg = rows.reduce(
    (total, row) => total + row.revenueMtdPyg,
    0
  );
  const totalOverdueCollections = rows.reduce(
    (total, row) => total + row.overdueCollectionCount,
    0
  );
  const totalOpenTasks = rows.reduce(
    (total, row) => total + row.openTaskCount,
    0
  );
  const totalUrgentTasks = rows.reduce(
    (total, row) => total + row.urgentTaskCount,
    0
  );
  const totalUnits = rows.reduce((total, row) => total + row.unitCount, 0);
  const totalActiveLeases = rows.reduce(
    (total, row) => total + row.activeLeaseCount,
    0
  );
  const totalVacantUnits = totalUnits - totalActiveLeases;
  const vacancyCostPyg = totalVacantUnits > 0 ? totalVacantUnits * averageRentPyg : 0;

  return {
    totalAssetValuePyg,
    averageOccupancy,
    averageRentPyg,
    totalRevenueMtdPyg,
    totalOverdueCollections,
    totalOpenTasks,
    totalUrgentTasks,
    totalUnits,
    totalActiveLeases,
    totalVacantUnits,
    vacancyCostPyg,
  };
}
