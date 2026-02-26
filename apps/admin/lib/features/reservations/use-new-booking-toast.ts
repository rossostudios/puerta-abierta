"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { authedFetch } from "@/lib/api-client";
import { useVisibilityPollingInterval } from "@/lib/hooks/use-visibility-polling";

type UseNewBookingToastOptions = {
  orgId: string;
  enabled?: boolean;
  isEn?: boolean;
};

export function useNewBookingToast({
  orgId,
  enabled = true,
  isEn = true,
}: UseNewBookingToastOptions) {
  const router = useRouter();
  const initializedRef = useRef(false);
  const seenReservationIdsRef = useRef<Set<string>>(new Set());
  const pollInterval = useVisibilityPollingInterval({
    enabled: enabled && !!orgId,
    foregroundMs: 15_000,
    backgroundMs: 60_000,
  });

  useEffect(() => {
    initializedRef.current = false;
    seenReservationIdsRef.current = new Set();
  }, [orgId]);

  const { data: recentDirectBookings = [] } = useQuery<
    Record<string, unknown>[]
  >({
    queryKey: ["new-booking-toast-poll", orgId],
    enabled: enabled && !!orgId,
    queryFn: async () => {
      const params = new URLSearchParams({
        org_id: orgId,
        limit: "25",
        source: "direct_booking",
      });
      const payload = await authedFetch<{ data?: unknown[] }>(
        `/reservations?${params.toString()}`
      );
      const rows = payload.data ?? [];
      return rows.filter(
        (row): row is Record<string, unknown> =>
          !!row && typeof row === "object"
      );
    },
    staleTime: 10_000,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: pollInterval,
  });

  useEffect(() => {
    if (!enabled || !orgId) return;
    if (recentDirectBookings.length === 0) return;

    const normalized = recentDirectBookings
      .map((row) => {
        const id = typeof row.id === "string" ? row.id : "";
        if (!id) return null;
        return {
          id,
          createdAt:
            typeof row.created_at === "string" ? row.created_at : "",
          guestName:
            typeof row.guest_name === "string" ? row.guest_name : "",
          unitName: typeof row.unit_name === "string" ? row.unit_name : "",
        };
      })
      .filter(
        (
          row
        ): row is {
          id: string;
          createdAt: string;
          guestName: string;
          unitName: string;
        } => Boolean(row)
      )
      .sort((a, b) => {
        if (!a.createdAt && !b.createdAt) return 0;
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return a.createdAt.localeCompare(b.createdAt);
      });

    if (!initializedRef.current) {
      seenReservationIdsRef.current = new Set(normalized.map((row) => row.id));
      initializedRef.current = true;
      return;
    }

    let sawNewBooking = false;
    for (const row of normalized) {
      if (seenReservationIdsRef.current.has(row.id)) continue;
      seenReservationIdsRef.current.add(row.id);
      sawNewBooking = true;

      const description =
        [row.guestName, row.unitName].filter(Boolean).join(" — ") ||
        (isEn ? "New booking" : "Nueva reserva");

      toast.success(
        isEn ? "New marketplace booking!" : "¡Nueva reserva del marketplace!",
        {
          description,
          action: {
            label: isEn ? "View" : "Ver",
            onClick: () => router.push(`/module/reservations/${row.id}`),
          },
          duration: 8000,
        }
      );
    }

    if (seenReservationIdsRef.current.size > 500) {
      const keep = new Set(normalized.slice(-100).map((row) => row.id));
      seenReservationIdsRef.current = keep;
    }

    if (sawNewBooking) {
      router.refresh();
    }
  }, [enabled, isEn, orgId, recentDirectBookings, router]);
}
