"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

type ReservationRow = {
  id: string;
  unit_name: string;
  unit_id: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  guest_name: string;
  nights: number;
};

function parseRow(raw: Record<string, unknown>): ReservationRow {
  const checkIn = asString(raw.check_in_date);
  const checkOut = asString(raw.check_out_date);
  let nights = 0;
  if (checkIn && checkOut) {
    const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    nights = Math.max(Math.ceil(diff / 86400000), 0);
  }
  return {
    id: asString(raw.id),
    unit_name: asString(raw.unit_name) || asString(raw.unit_id).slice(0, 8),
    unit_id: asString(raw.unit_id),
    check_in_date: checkIn,
    check_out_date: checkOut,
    status: asString(raw.status) || asString(raw.reservation_status),
    guest_name: asString(raw.guest_full_name) || asString(raw.guest_name),
    nights,
  };
}

export function OwnerReservations({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const [token] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("owner_token") : null
  );

  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: ["owner-reservations", token],
    queryFn: async () => {
      if (!token) {
        router.push("/owner/login");
        return [];
      }
      const res = await fetch(`${API_BASE}/owner/reservations`, {
        headers: { "x-owner-token": token },
      });
      if (res.status === 401) {
        localStorage.removeItem("owner_token");
        router.push("/owner/login");
        return [];
      }
      const data = await res.json();
      const items = ((data as { data?: unknown[] }).data ?? []) as Record<
        string,
        unknown
      >[];
      return items.map(parseRow);
    },
    enabled: Boolean(token),
    retry: false,
  });

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground animate-pulse">
          {isEn ? "Loading..." : "Cargando..."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {isEn ? "Reservations" : "Reservas"}
        </h1>
        <Link
          className="text-sm text-primary hover:underline"
          href="/owner/dashboard"
        >
          {isEn ? "Back to dashboard" : "Volver al panel"}
        </Link>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {isEn ? "No reservations yet." : "Aún no hay reservas."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{row.unit_name}</CardTitle>
                  <StatusBadge label={row.status} value={row.status} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {isEn ? "Dates" : "Fechas"}
                    </p>
                    <p className="text-sm font-medium">
                      {row.check_in_date} &rarr; {row.check_out_date}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {isEn ? "Nights" : "Noches"}
                    </p>
                    <p className="text-sm font-medium">{row.nights}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {isEn ? "Guest" : "Huésped"}
                    </p>
                    <p className="text-sm font-medium">
                      {row.guest_name || "—"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
