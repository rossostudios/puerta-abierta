import type {
  PropertyRelationSnapshot,
  QueryValue,
  StatementLineItem,
  StatementReconciliation,
} from "./types";
import { asString, toNumber, toRecordArray } from "./utils";

export function toStatementLineItems(value: unknown): StatementLineItem[] {
  if (!Array.isArray(value)) return [];

  const rows: StatementLineItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    const bucket = typeof record.bucket === "string" ? record.bucket : "";
    const source_table =
      typeof record.source_table === "string" ? record.source_table : "";
    const source_id =
      typeof record.source_id === "string" ? record.source_id : "";
    const kind = typeof record.kind === "string" ? record.kind : "";
    const amount_pyg = toNumber(record.amount_pyg);

    if (!(bucket && source_table && source_id && kind) || amount_pyg === null) {
      continue;
    }

    rows.push({
      bucket,
      source_table,
      source_id,
      kind,
      amount_pyg,
      date: typeof record.date === "string" ? record.date : undefined,
      from: typeof record.from === "string" ? record.from : undefined,
      to: typeof record.to === "string" ? record.to : undefined,
    });
  }

  return rows;
}

export function toStatementReconciliation(
  value: unknown
): StatementReconciliation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    gross_total: toNumber(record.gross_total) ?? undefined,
    computed_net_payout: toNumber(record.computed_net_payout) ?? undefined,
    stored_net_payout: toNumber(record.stored_net_payout) ?? undefined,
    stored_vs_computed_diff:
      toNumber(record.stored_vs_computed_diff) ?? undefined,
  };
}

export function reconciliationDiffClass(diff: number): string {
  if (Math.abs(diff) < 0.01) {
    return "status-tone-success";
  }
  if (diff > 0) {
    return "status-tone-warning";
  }
  return "status-tone-danger";
}

export async function fetchScopedRows(params: {
  accessToken: string | null;
  baseUrl: string;
  path: string;
  query: Record<string, QueryValue>;
}): Promise<Record<string, unknown>[] | null> {
  const url = new URL(`${params.baseUrl}${params.path}`);
  for (const [key, value] of Object.entries(params.query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(params.accessToken
          ? { Authorization: `Bearer ${params.accessToken}` }
          : {}),
      },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as unknown;
    return toRecordArray(payload);
  } catch {
    return null;
  }
}

export async function loadPropertyRelationSnapshot(params: {
  accessToken: string | null;
  baseUrl: string;
  orgId: string;
  propertyId: string;
}): Promise<PropertyRelationSnapshot> {
  const { accessToken, baseUrl, orgId, propertyId } = params;

  const [
    unitsRows,
    tasksRows,
    expensesRows,
    ownerStatementRows,
    leaseRows,
    reservationRows,
    listingRows,
    applicationRows,
    collectionRows,
  ] = await Promise.all([
    fetchScopedRows({
      accessToken,
      baseUrl,
      path: "/units",
      query: { org_id: orgId, property_id: propertyId, limit: 400 },
    }),
    fetchScopedRows({
      accessToken,
      baseUrl,
      path: "/tasks",
      query: { org_id: orgId, property_id: propertyId, limit: 400 },
    }),
    fetchScopedRows({
      accessToken,
      baseUrl,
      path: "/expenses",
      query: { org_id: orgId, property_id: propertyId, limit: 600 },
    }),
    fetchScopedRows({
      accessToken,
      baseUrl,
      path: "/owner-statements",
      query: { org_id: orgId, property_id: propertyId, limit: 240 },
    }),
    fetchScopedRows({
      accessToken,
      baseUrl,
      path: "/leases",
      query: { org_id: orgId, property_id: propertyId, limit: 400 },
    }),
    fetchScopedRows({
      accessToken,
      baseUrl,
      path: "/reservations",
      query: { org_id: orgId, limit: 800 },
    }),
    fetchScopedRows({
      accessToken,
      baseUrl,
      path: "/listings",
      query: { org_id: orgId, limit: 400 },
    }),
    fetchScopedRows({
      accessToken,
      baseUrl,
      path: "/applications",
      query: { org_id: orgId, limit: 600 },
    }),
    fetchScopedRows({
      accessToken,
      baseUrl,
      path: "/collections",
      query: { org_id: orgId, limit: 600 },
    }),
  ]);

  const units = unitsRows ?? [];
  const tasks = tasksRows ?? [];
  const expenses = expensesRows ?? [];
  const ownerStatements = ownerStatementRows ?? [];
  const leases = leaseRows ?? [];

  const reservations = (reservationRows ?? []).filter(
    (row) => asString(row.property_id) === propertyId
  );
  const listings = (listingRows ?? []).filter(
    (row) => asString(row.property_id) === propertyId
  );

  const listingIds = new Set(
    listings
      .map((row) => asString(row.id))
      .filter((rowId): rowId is string => Boolean(rowId))
  );
  const applications = (applicationRows ?? []).filter((row) =>
    listingIds.has(asString(row.listing_id))
  );

  const leaseIds = new Set(
    leases
      .map((row) => asString(row.id))
      .filter((rowId): rowId is string => Boolean(rowId))
  );
  const collections = (collectionRows ?? []).filter((row) =>
    leaseIds.has(asString(row.lease_id))
  );

  return {
    units,
    tasks,
    expenses,
    ownerStatements,
    leases,
    reservations,
    listings,
    applications,
    collections,
  };
}
