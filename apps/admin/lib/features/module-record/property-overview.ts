import { formatCurrency } from "@/lib/format";
import {
  ACTIVE_RESERVATION_STATUSES,
  APPLICATION_CLOSED_STATUSES,
  COLLECTION_OPEN_STATUSES,
  COLLECTION_PAID_STATUSES,
  LEASE_ACTIVE_STATUSES,
  TASK_CLOSED_STATUSES,
  URGENT_TASK_PRIORITIES,
} from "./constants";
import type { PropertyRelationSnapshot } from "./types";
import {
  asBoolean,
  asDateLabel,
  asString,
  convertAmountToPyg,
  daysUntilDate,
  getAmountInPyg,
  getFirstValue,
  normalizedStatus,
  toDate,
  toNumber,
} from "./utils";

export type UnitCard = {
  id: string;
  unitId: string;
  label: string;
  subtitle: string;
  statusTone: "occupied" | "maintenance" | "vacant";
  statusLabel: string;
  tenantName: string;
  monthlyRentPyg: number;
  nextCollectionDue: string | null;
  openTaskCount: number;
};

export type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: "danger" | "warning" | "info";
  ctaLabel: string;
};

export type PropertyOverviewData = {
  unitCount: number;
  activeLeaseCount: number;
  activeReservationCount: number;
  openTaskCount: number;
  publishedListingCount: number;
  pipelineApplicationCount: number;
  openCollectionCount: number;
  ownerStatementCount: number;
  occupancyRate: number | null;
  monthLabel: string;
  monthIncomePyg: number;
  monthExpensePyg: number;
  monthNetIncomePyg: number;
  projectedRentPyg: number;
  latestStatement: Record<string, unknown> | null;
  attentionItems: AttentionItem[];
  unitCards: UnitCard[];
  expenseCategoryBreakdown: Array<{ category: string; amount: number }>;
};

export function buildPropertyOverview(
  snapshot: PropertyRelationSnapshot,
  recordId: string,
  isEn: boolean,
  formatLocale: "en-US" | "es-PY"
): PropertyOverviewData {
  const {
    units,
    tasks,
    expenses,
    ownerStatements,
    leases,
    reservations,
    listings,
    applications,
    collections,
  } = snapshot;

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
  const monthLabel = new Intl.DateTimeFormat(formatLocale, {
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
      const leftDate = toDate(left.due_date) ?? new Date(8_640_000_000_000_000);
      const rightDate =
        toDate(right.due_date) ?? new Date(8_640_000_000_000_000);
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
    const statusTone = urgentTask
      ? ("maintenance" as const)
      : lease
        ? ("occupied" as const)
        : ("vacant" as const);
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
          ? asDateLabel(asString(nextCollection.due_date), formatLocale)
          : null,
      openTaskCount: taskCount,
    };
  });

  const urgentTasks = [...openTasks]
    .filter((task) => {
      const dueDate = toDate(task.due_at);
      const isPastDue = dueDate !== null && dueDate.getTime() < now.getTime();
      const highPriority = URGENT_TASK_PRIORITIES.has(
        normalizedStatus(task.priority)
      );
      return isPastDue || highPriority;
    })
    .sort((left, right) => {
      const leftDue = toDate(left.due_at) ?? new Date(8_640_000_000_000_000);
      const rightDue = toDate(right.due_at) ?? new Date(8_640_000_000_000_000);
      return leftDue.getTime() - rightDue.getTime();
    });
  const overdueCollections = [...openCollections]
    .filter((row) => {
      const dueDate = toDate(row.due_date);
      return dueDate !== null && dueDate.getTime() < now.getTime();
    })
    .sort((left, right) => {
      const leftDue = toDate(left.due_date) ?? new Date(8_640_000_000_000_000);
      const rightDue =
        toDate(right.due_date) ?? new Date(8_640_000_000_000_000);
      return leftDue.getTime() - rightDue.getTime();
    });
  const leasesExpiringSoon = [...activeLeases]
    .filter((lease) => {
      const endsOn = toDate(lease.ends_on);
      if (!endsOn) return false;
      const daysUntil = daysUntilDate(endsOn, now);
      return daysUntil >= 0 && daysUntil <= 60;
    })
    .sort((left, right) => {
      const leftDate = toDate(left.ends_on) ?? new Date(8_640_000_000_000_000);
      const rightDate =
        toDate(right.ends_on) ?? new Date(8_640_000_000_000_000);
      return leftDate.getTime() - rightDate.getTime();
    });

  const attentionItems: AttentionItem[] = [];
  for (const row of overdueCollections.slice(0, 2)) {
    const collectionId = asString(row.id);
    const leaseId = asString(row.lease_id);
    const dueDate = asDateLabel(asString(row.due_date), formatLocale);
    const amount = convertAmountToPyg(
      toNumber(row.amount) ?? 0,
      asString(row.currency) || "PYG",
      toNumber(row.fx_rate_to_pyg)
    );
    attentionItems.push({
      id: `collection:${collectionId || leaseId || attentionItems.length}`,
      title: isEn ? "Overdue collection" : "Cobro vencido",
      detail: `${formatCurrency(amount, "PYG", formatLocale)} · ${dueDate ?? (isEn ? "No due date" : "Sin vencimiento")}`,
      href: `/module/collections${
        collectionId
          ? `/${collectionId}`
          : `?property_id=${encodeURIComponent(recordId)}`
      }`,
      tone: "danger",
      ctaLabel: isEn ? "Review" : "Revisar",
    });
  }
  for (const row of urgentTasks.slice(0, 2)) {
    const taskId = asString(row.id);
    const dueDate = asDateLabel(asString(row.due_at), formatLocale);
    attentionItems.push({
      id: `task:${taskId || attentionItems.length}`,
      title: getFirstValue(row, ["title", "type", "id"]) ?? "-",
      detail: dueDate
        ? isEn
          ? `Due ${dueDate}`
          : `Vence ${dueDate}`
        : isEn
          ? "Task needs attention"
          : "La tarea requiere atención",
      href: taskId
        ? `/module/tasks/${taskId}`
        : `/module/tasks?property_id=${encodeURIComponent(recordId)}`,
      tone: "warning",
      ctaLabel: isEn ? "Open task" : "Abrir tarea",
    });
  }
  for (const row of leasesExpiringSoon.slice(0, 2)) {
    const leaseId = asString(row.id);
    const endsOn = toDate(row.ends_on);
    const daysLeft = endsOn ? daysUntilDate(endsOn, now) : null;
    const tenantName =
      getFirstValue(row, ["tenant_full_name", "tenant_name"]) ?? "-";
    attentionItems.push({
      id: `lease:${leaseId || attentionItems.length}`,
      title: isEn ? "Lease ending soon" : "Contrato por vencer",
      detail:
        daysLeft === null
          ? tenantName
          : isEn
            ? `${tenantName} · ${daysLeft} days left`
            : `${tenantName} · faltan ${daysLeft} días`,
      href: leaseId
        ? `/module/leases/${leaseId}`
        : `/module/leases?property_id=${encodeURIComponent(recordId)}`,
      tone: "info",
      ctaLabel: isEn ? "Open lease" : "Ver contrato",
    });
  }

  const expenseByCategory = [...monthExpenses].reduce<Record<string, number>>(
    (acc, row) => {
      const key = getFirstValue(row, ["category", "vendor_name"]) || "other";
      acc[key] = (acc[key] ?? 0) + getAmountInPyg(row);
      return acc;
    },
    {}
  );
  const expenseCategoryBreakdown = Object.entries(expenseByCategory)
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 3);

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
    latestStatement: latestStatement ?? null,
    attentionItems: attentionItems.slice(0, 6),
    unitCards,
    expenseCategoryBreakdown,
  };
}
