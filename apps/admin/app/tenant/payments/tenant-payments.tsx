"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency } from "@/lib/format";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

function asString(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}
function asNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const p = Number(v);
  return Number.isFinite(p) ? p : 0;
}

type Row = {
  id: string;
  due_date: string;
  amount: number;
  currency: string;
  status: string;
  paid_at: string | null;
  payment_link_reference: string | null;
};

export function TenantPayments({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const [payments, setPayments] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = sessionStorage.getItem("tenant_token");
    if (!token) { router.push("/tenant/login"); return; }
    try {
      const res = await fetch(`${API_BASE}/tenant/payments`, { headers: { "x-tenant-token": token } });
      if (res.status === 401) { sessionStorage.clear(); router.push("/tenant/login"); return; }
      const json = await res.json();
      setPayments(
        ((json.data ?? []) as Record<string, unknown>[]).map((r) => ({
          id: asString(r.id),
          due_date: asString(r.due_date),
          amount: asNumber(r.amount),
          currency: asString(r.currency) || "PYG",
          status: asString(r.status),
          paid_at: asString(r.paid_at) || null,
          payment_link_reference: asString(r.payment_link_reference) || null,
        }))
      );
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-muted-foreground animate-pulse">{isEn ? "Loading..." : "Cargando..."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{isEn ? "Payment History" : "Historial de Pagos"}</h1>
        <Link href="/tenant/dashboard"><Button size="sm" variant="outline">{isEn ? "Back" : "Volver"}</Button></Link>
      </div>
      {payments.length === 0 ? (
        <p className="text-muted-foreground">{isEn ? "No payments found." : "No se encontraron pagos."}</p>
      ) : (
        <div className="space-y-3">
          {payments.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{formatCurrency(p.amount, p.currency, locale)}</p>
                  <p className="text-muted-foreground text-sm">{isEn ? "Due:" : "Vence:"} {p.due_date}</p>
                  {p.paid_at && <p className="text-muted-foreground text-xs">{isEn ? "Paid:" : "Pagado:"} {p.paid_at.slice(0, 10)}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge label={p.status} value={p.status} />
                  {p.status !== "paid" && p.payment_link_reference && (
                    <Link href={`/pay/${p.payment_link_reference}`}>
                      <Button size="sm">{isEn ? "Pay Now" : "Pagar Ahora"}</Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
