import type { PropertyRelationSnapshot, QueryValue } from "./data-helpers";
import { asString, toRecordArray } from "./data-helpers";

async function fetchScopedRows(params: {
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
      query: { org_id: orgId, property_id: propertyId, limit: 200 },
    }),
    fetchScopedRows({
      accessToken,
      baseUrl,
      path: "/listings",
      query: { org_id: orgId, property_id: propertyId, limit: 200 },
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

  const reservations = reservationRows ?? [];
  const listings = listingRows ?? [];

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
