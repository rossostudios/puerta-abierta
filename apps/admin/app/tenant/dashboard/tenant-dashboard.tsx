"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency } from "@/lib/format";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function TenantDashboard({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    const token = sessionStorage.getItem("tenant_token");
    if (!token) {
      router.push("/tenant/login");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/tenant/me`, {
        headers: { "x-tenant-token": token },
      });
      if (res.status === 401) {
        sessionStorage.clear();
        router.push("/tenant/login");
        return;
      }
      setData(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground animate-pulse">
          {isEn ? "Loading..." : "Cargando..."}
        </p>
      </div>
    );
  }
  if (!data) return null;

  const lease = (data.lease ?? {}) as Record<string, unknown>;
  const property = (data.property ?? {}) as Record<string, unknown>;
  const unit = (data.unit ?? {}) as Record<string, unknown>;
  const nextPayment = data.next_payment as Record<string, unknown> | null;
  const upcomingCount = asNumber(data.total_upcoming_payments);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        {isEn ? "Welcome" : "Bienvenido"},{" "}
        {asString(lease.tenant_full_name) || (isEn ? "Tenant" : "Inquilino")}
      </h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            {isEn ? "Your Lease" : "Tu Contrato"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground text-xs">{isEn ? "Property" : "Propiedad"}</p>
              <p className="font-medium">{asString(property.name) || "-"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{isEn ? "Unit" : "Unidad"}</p>
              <p className="font-medium">{asString(unit.name) || "-"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{isEn ? "Monthly Rent" : "Alquiler Mensual"}</p>
              <p className="font-medium">
                {formatCurrency(asNumber(lease.monthly_rent), asString(lease.currency) || "PYG", locale)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{isEn ? "Status" : "Estado"}</p>
              <StatusBadge label={asString(lease.lease_status)} value={asString(lease.lease_status)} />
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{isEn ? "Start" : "Inicio"}</p>
              <p className="font-medium">{asString(lease.starts_on) || "-"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{isEn ? "End" : "Fin"}</p>
              <p className="font-medium">{asString(lease.ends_on) || "-"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {nextPayment && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{isEn ? "Next Payment" : "Próximo Pago"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {formatCurrency(asNumber(nextPayment.amount), asString(nextPayment.currency) || "PYG", locale)}
                </p>
                <p className="text-muted-foreground text-sm">
                  {isEn ? "Due:" : "Vence:"} {asString(nextPayment.due_date)}
                </p>
              </div>
              <StatusBadge label={asString(nextPayment.status)} value={asString(nextPayment.status)} />
            </div>
            {upcomingCount > 1 && (
              <p className="text-muted-foreground mt-2 text-sm">
                {upcomingCount - 1} {isEn ? "more upcoming" : "más por venir"}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/tenant/payments">
          <Card className="hover:border-primary cursor-pointer transition-colors">
            <CardContent className="p-4 text-center">
              <p className="font-medium">{isEn ? "Payments" : "Pagos"}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/tenant/maintenance">
          <Card className="hover:border-primary cursor-pointer transition-colors">
            <CardContent className="p-4 text-center">
              <p className="font-medium">{isEn ? "Maintenance" : "Mantenimiento"}</p>
            </CardContent>
          </Card>
        </Link>
        <Button
          className="h-auto"
          onClick={() => { sessionStorage.clear(); router.push("/tenant/login"); }}
          variant="outline"
        >
          {isEn ? "Sign Out" : "Cerrar Sesión"}
        </Button>
      </div>
    </div>
  );
}
