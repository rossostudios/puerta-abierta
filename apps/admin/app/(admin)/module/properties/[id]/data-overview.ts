import type { Locale } from "@/lib/i18n";
import type { PropertyRelationSnapshot } from "./data-helpers";
import {
  ACTIVE_RESERVATION_STATUSES,
  APPLICATION_CLOSED_STATUSES,
  asBoolean,
  asDateLabel,
  asString,
  COLLECTION_OPEN_STATUSES,
  COLLECTION_PAID_STATUSES,
  convertAmountToPyg,
  getAmountInPyg,
  getFirstValue,
  LEASE_ACTIVE_STATUSES,
  normalizedStatus,
  TASK_CLOSED_STATUSES,
  toDate,
  toNumber,
  URGENT_TASK_PRIORITIES,
} from "./data-helpers";
import { buildAttentionItems } from "./data-overview-attention";
import type { LeaseExpiringSoon, PropertyOverview } from "./types";

const MAX_DATE = new Date(8_640_000_000_000_000);

export function buildPropertyOverview(params: {
  snapshot: PropertyRelationSnapshot;
  locale: Locale;
  recordId: string;
}): PropertyOverview {
  const { snapshot, locale, recordId } = params;
  const isEn = locale === "en-US";

  const units = snapshot.units;
  const tasks = snapshot.tasks;
  const expenses = snapshot.expenses;
  const ownerStatements = snapshot.ownerStatements;
  const leases = snapshot.leases;
  const reservations = snapshot.reservations;
  const listings = snapshot.listings;
  const applications = snapshot.applications;
  const collections = snapshot.collections;

  const openTasks = tasks.filter(
    (row) => !TASK_CLOSED_STATUSES.has(normalizedStatus(row.status))
  );
  const activeLeases = leases.filter((row) =>
    LEASE_ACTIVE_STATUSES.has(normalizedStatus(row.lease_status))
  );
  const activeReservations = reservations.filter((row) =>
    ACTIVE_RESERVATION_STATUSES.has(normalizedStatus(row.status))
  );
  const publishedListings = listings.filter(
    (row) => asBoolean(row.is_published) === true
  );
  const pipelineApplications = applications.filter(
    (row) => !APPLICATION_CLOSED_STATUSES.has(normalizedStatus(row.status))
  );
  const openCollections = collections.filter((row) =>
    COLLECTION_OPEN_STATUSES.has(normalizedStatus(row.status))
  );

  const occupiedUnitIds = new Set(
    activeLeases
      .map((row) => asString(row.unit_id))
      .filter((unitId): unitId is string => Boolean(unitId))
  );
  const occupancyRate = units.length
    ? Math.round((occupiedUnitIds.size / units.length) * 100)
    : null;

  const now = new Date();
  const monthPrefix = now.toISOString().slice(0, 7);
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
  }).format(now);
  const monthExpenses = expenses.filter((row) =>
    asString(row.expense_date).startsWith(monthPrefix)
  );
  const monthExpensePyg = monthExpenses.reduce(
    (total, row) => total + getAmountInPyg(row),
    0
  );

  const paidCollectionsThisMonth = collections.filter((row) => {
    const status = normalizedStatus(row.status);
    if (!COLLECTION_PAID_STATUSES.has(status)) return false;
    return (
      asString(row.paid_at).startsWith(monthPrefix) ||
      asString(row.due_date).startsWith(monthPrefix)
    );
  });

  const openCollectionsThisMonth = openCollections.filter((row) =>
    asString(row.due_date).startsWith(monthPrefix)
  );

  const collectedPyg = [
    ...paidCollectionsThisMonth,
    ...openCollectionsThisMonth,
  ].reduce((total, row) => {
    const amount = toNumber(row.amount) ?? 0;
    const currency = asString(row.currency) || "PYG";
    const fxRate = toNumber(row.fx_rate_to_pyg);
    return total + convertAmountToPyg(amount, currency, fxRate);
  }, 0);

  const projectedRentPyg = activeLeases.reduce((total, row) => {
    const amount = toNumber(row.monthly_rent) ?? 0;
    const currency = asString(row.currency) || "PYG";
    return total + convertAmountToPyg(amount, currency, null);
  }, 0);
  const monthIncomePyg = collectedPyg > 0 ? collectedPyg : projectedRentPyg;
  const monthNetIncomePyg = monthIncomePyg - monthExpensePyg;

  const activeLeaseByUnitId = new Map<string, Record<string, unknown>>();
  for (const lease of activeLeases) {
    const unitId = asString(lease.unit_id);
    if (!unitId || activeLeaseByUnitId.has(unitId)) continue;
    activeLeaseByUnitId.set(unitId, lease);
  }

  const openTasksByUnitId = new Map<string, Record<string, unknown>[]>();
  for (const task of openTasks) {
    const unitId = asString(task.unit_id);
    if (!unitId) continue;
    const bucket = openTasksByUnitId.get(unitId);
    if (bucket) bucket.push(task);
    else openTasksByUnitId.set(unitId, [task]);
  }

  const openCollectionsByLeaseId = new Map<string, Record<string, unknown>[]>();
  for (const collection of openCollections) {
    const leaseId = asString(collection.lease_id);
    if (!leaseId) continue;
    const bucket = openCollectionsByLeaseId.get(leaseId);
    if (bucket) bucket.push(collection);
    else openCollectionsByLeaseId.set(leaseId, [collection]);
  }

  for (const rows of openCollectionsByLeaseId.values()) {
    rows.sort((left, right) => {
      const leftDate = toDate(left.due_date) ?? MAX_DATE;
      const rightDate = toDate(right.due_date) ?? MAX_DATE;
      return leftDate.getTime() - rightDate.getTime();
    });
  }

  const latestStatement = [...ownerStatements].sort((left, right) => {
    const leftDate =
      toDate(getFirstValue(left, ["period_end", "generated_at"])) ??
      new Date(0);
    const rightDate =
      toDate(getFirstValue(right, ["period_end", "generated_at"])) ??
      new Date(0);
    return rightDate.getTime() - leftDate.getTime();
  })[0];

  const unitsPreview = [...units].sort((left, right) => {
    const leftLabel = getFirstValue(left, ["code", "name", "id"]) ?? "";
    const rightLabel = getFirstValue(right, ["code", "name", "id"]) ?? "";
    return leftLabel.localeCompare(rightLabel);
  });

  const unitCards = unitsPreview.slice(0, 6).map((unit) => {
    const unitId = asString(unit.id);
    const lease = activeLeaseByUnitId.get(unitId);
    const tenantName = lease
      ? getFirstValue(lease, ["tenant_full_name", "tenant_name"])
      : null;
    const leaseId = lease ? asString(lease.id) : "";
    const nextCollection =
      leaseId && openCollectionsByLeaseId.has(leaseId)
        ? (openCollectionsByLeaseId.get(leaseId)?.[0] ?? null)
        : null;
    const unitTasks = unitId ? (openTasksByUnitId.get(unitId) ?? []) : [];
    const urgentTask = unitTasks.find((task) => {
      const dueDate = toDate(task.due_at);
      const isPastDue = dueDate !== null && dueDate.getTime() < now.getTime();
      const highPriority = URGENT_TASK_PRIORITIES.has(
        normalizedStatus(task.priority)
      );
      return isPastDue || highPriority;
    });
    const taskCount = unitTasks.length;
    const statusTone: "occupied" | "maintenance" | "vacant" = urgentTask
      ? "maintenance"
      : lease
        ? "occupied"
        : "vacant";
    const statusLabel = isEn
      ? statusTone === "occupied"
        ? "Occupied"
        : statusTone === "maintenance"
          ? "Attention"
          : "Vacant"
      : statusTone === "occupied"
        ? "Ocupada"
        : statusTone === "maintenance"
          ? "Atención"
          : "Vacante";
    const monthlyRentPyg = lease
      ? convertAmountToPyg(
          toNumber(lease.monthly_rent) ?? 0,
          asString(lease.currency) || "PYG",
          null
        )
      : 0;

    return {
      id: unitId || getFirstValue(unit, ["id", "code", "name"]) || "unit",
      unitId,
      label: getFirstValue(unit, ["code", "name", "id"]) ?? "-",
      subtitle: getFirstValue(unit, ["name", "code"]) ?? "-",
      statusTone,
      statusLabel,
      tenantName:
        tenantName ?? (isEn ? "No active tenant" : "Sin inquilino activo"),
      monthlyRentPyg,
      nextCollectionDue:
        nextCollection && asString(nextCollection.due_date)
          ? asDateLabel(asString(nextCollection.due_date), locale)
          : null,
      openTaskCount: taskCount,
    };
  });

  const attentionItems = buildAttentionItems({
    openTasks,
    openCollections,
    activeLeases,
    locale,
    recordId,
    isEn,
    now,
  });

  const overdueCollections = openCollections.filter((row) => {
    const dueDate = toDate(row.due_date);
    return dueDate !== null && dueDate.getTime() < now.getTime();
  });
  const overdueCollectionCount = overdueCollections.length;
  const overdueCollectionAmountPyg = overdueCollections.reduce((total, row) => {
    const amount = toNumber(row.amount) ?? 0;
    const currency = asString(row.currency) || "PYG";
    const fxRate = toNumber(row.fx_rate_to_pyg);
    return total + convertAmountToPyg(amount, currency, fxRate);
  }, 0);

  const collectedThisMonthPyg = paidCollectionsThisMonth.reduce(
    (total, row) => {
      const amount = toNumber(row.amount) ?? 0;
      const currency = asString(row.currency) || "PYG";
      const fxRate = toNumber(row.fx_rate_to_pyg);
      return total + convertAmountToPyg(amount, currency, fxRate);
    },
    0
  );

  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const leasesExpiringSoon: LeaseExpiringSoon[] = activeLeases
    .map((lease) => {
      const endsOn = toDate(lease.ends_on) ?? toDate(lease.end_date);
      if (!endsOn) return null;
      const daysLeft = Math.ceil(
        (endsOn.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
      );
      if (daysLeft < 0 || daysLeft > 90) return null;
      const tenantName =
        getFirstValue(lease, ["tenant_full_name", "tenant_name"]) ||
        (isEn ? "Unknown tenant" : "Inquilino desconocido");
      const unitId = asString(lease.unit_id);
      const unit = units.find((u) => asString(u.id) === unitId);
      const unitLabel = unit
        ? getFirstValue(unit, ["code", "name"]) || unitId
        : unitId || "-";
      return {
        tenantName,
        unitLabel,
        daysLeft,
        leaseId: asString(lease.id),
      };
    })
    .filter((item): item is LeaseExpiringSoon => item !== null)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const expenseByCategory = [...monthExpenses].reduce<Record<string, number>>(
    (acc, row) => {
      const key = getFirstValue(row, ["category", "vendor_name"]) || "other";
      acc[key] = (acc[key] ?? 0) + getAmountInPyg(row);
      return acc;
    },
    {}
  );
  const expenseCategorySorted = Object.entries(expenseByCategory)
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount);
  const totalExpenseCategoryCount = expenseCategorySorted.length;
  const expenseCategoryBreakdown = expenseCategorySorted.slice(0, 3);

  const urgentTaskCount = openTasks.filter((task) => {
    const dueDate = toDate(task.due_at);
    const isPastDue = dueDate !== null && dueDate.getTime() < now.getTime();
    const highPriority = URGENT_TASK_PRIORITIES.has(
      normalizedStatus(task.priority)
    );
    return isPastDue || highPriority;
  }).length;

  const vacantUnitCount = units.length - occupiedUnitIds.size;
  const avgRentPerUnit =
    activeLeases.length > 0 ? projectedRentPyg / activeLeases.length : 0;
  const vacancyCostPyg =
    vacantUnitCount > 0 ? vacantUnitCount * avgRentPerUnit : 0;
  const collectionRate =
    projectedRentPyg > 0
      ? Math.round((collectedThisMonthPyg / projectedRentPyg) * 100)
      : null;

  const health =
    units.length > 0 && occupancyRate === 0
      ? "critical"
      : urgentTaskCount > 0 ||
          overdueCollectionCount > 0 ||
          (occupancyRate !== null && occupancyRate < 70)
        ? "watch"
        : "stable";

  return {
    unitCount: units.length,
    activeLeaseCount: activeLeases.length,
    activeReservationCount: activeReservations.length,
    openTaskCount: openTasks.length,
    publishedListingCount: publishedListings.length,
    pipelineApplicationCount: pipelineApplications.length,
    openCollectionCount: openCollections.length,
    ownerStatementCount: ownerStatements.length,
    occupancyRate,
    monthLabel,
    monthIncomePyg,
    monthExpensePyg,
    monthNetIncomePyg,
    projectedRentPyg,
    overdueCollectionCount,
    overdueCollectionAmountPyg,
    collectedThisMonthPyg,
    leasesExpiringSoon,
    latestStatement: latestStatement ?? null,
    attentionItems,
    unitCards,
    expenseCategoryBreakdown,
    health,
    urgentTaskCount,
    vacantUnitCount,
    vacancyCostPyg,
    collectionRate,
    totalExpenseCategoryCount,
  };
}
