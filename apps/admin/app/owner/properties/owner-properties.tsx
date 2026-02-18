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

type PropertyRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  address_line1: string;
  city: string;
};

function parseRow(raw: Record<string, unknown>): PropertyRow {
  return {
    id: asString(raw.id),
    name: asString(raw.name),
    code: asString(raw.code),
    status: asString(raw.status),
    address_line1: asString(raw.address_line1),
    city: asString(raw.city),
  };
}

export function OwnerProperties({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const [token] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("owner_token") : null
  );

  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: ["owner-properties", token],
    queryFn: async () => {
      if (!token) {
        router.push("/owner/login");
        return [];
      }
      const res = await fetch(`${API_BASE}/owner/properties`, {
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
          {isEn ? "Properties" : "Propiedades"}
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
              {isEn ? "No properties found." : "No se encontraron propiedades."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base truncate">
                    {row.name}
                  </CardTitle>
                  <StatusBadge
                    label={row.status || "active"}
                    value={row.status || "active"}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                {row.code ? <p>Code: {row.code}</p> : null}
                {row.address_line1 ? <p>{row.address_line1}</p> : null}
                {row.city ? <p>{row.city}</p> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
