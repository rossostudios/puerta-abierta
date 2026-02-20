"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchListingReadiness } from "./listings-api";

export function useListingReadiness(listingId: string | null) {
  return useQuery({
    queryKey: ["listing-readiness", listingId],
    queryFn: () => {
      if (!listingId) {
        throw new Error("listingId is required");
      }
      return fetchListingReadiness(listingId);
    },
    enabled: Boolean(listingId),
  });
}
