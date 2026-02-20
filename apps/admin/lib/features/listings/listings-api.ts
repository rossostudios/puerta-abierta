import { authedFetch as baseAuthedFetch } from "@/lib/api-client";

export type PaginatedListingsResponse = {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  per_page: number;
};

export type ListingsPaginatedParams = {
  org_id: string;
  page?: number;
  per_page?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  q?: string;
  status?: string;
};

export function fetchListingsPaginated(
  params: ListingsPaginatedParams
): Promise<PaginatedListingsResponse> {
  const sp = new URLSearchParams();
  sp.set("org_id", params.org_id);
  if (params.page) sp.set("page", String(params.page));
  if (params.per_page) sp.set("per_page", String(params.per_page));
  if (params.sort_by) sp.set("sort_by", params.sort_by);
  if (params.sort_order) sp.set("sort_order", params.sort_order);
  if (params.q) sp.set("q", params.q);
  if (params.status) sp.set("status", params.status);

  return authedFetch<PaginatedListingsResponse>(`/listings?${sp.toString()}`);
}

export type SlugAvailableResponse = {
  available: boolean;
  slug: string;
};

export function fetchSlugAvailable(
  slug: string,
  orgId: string,
  excludeListingId?: string
): Promise<SlugAvailableResponse> {
  const sp = new URLSearchParams({ slug, org_id: orgId });
  if (excludeListingId) sp.set("exclude_listing_id", excludeListingId);

  return authedFetch<SlugAvailableResponse>(
    `/listings/slug-available?${sp.toString()}`
  );
}

export type ReadinessIssue = {
  field: string;
  label: string;
  weight: number;
  satisfied: boolean;
  critical: boolean;
};

export type ReadinessResponse = {
  score: number;
  blocking: boolean;
  issues: ReadinessIssue[];
};

export function fetchListingReadiness(
  listingId: string
): Promise<ReadinessResponse> {
  return authedFetch<ReadinessResponse>(`/listings/${listingId}/readiness`);
}

export function authedFetch<T>(
  path: string,
  init?: RequestInit & { body?: string }
): Promise<T> {
  return baseAuthedFetch<T>(path, init);
}
