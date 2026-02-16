"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
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
  payment_method: string | null;
  payment_reference: string | null;
  payment_link_reference: string | null;
  notes: string | null;
};

type BankDetails = {
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  bank_ruc: string | null;
};

function statusLabel(status: string, isEn: boolean): string {
  const labels: Record<string, [string, string]> = {
    scheduled: ["Scheduled", "Programado"],
    pending: ["Pending", "Pendiente"],
    paid: ["Paid", "Pagado"],
    late: ["Late", "Atrasado"],
    waived: ["Waived", "Exonerado"],
  };
  const pair = labels[status];
  return pair ? pair[isEn ? 0 : 1] : status;
}

function daysUntilDue(dueDate: string): number {
  const now = new Date();
  const due = new Date(dueDate + "T00:00:00");
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function dueLabel(days: number, isEn: boolean): string {
  if (days < 0) {
    const abs = Math.abs(days);
    return isEn
      ? `${abs} day${abs === 1 ? "" : "s"} overdue`
      : `${abs} día${abs === 1 ? "" : "s"} de atraso`;
  }
  if (days === 0) return isEn ? "Due today" : "Vence hoy";
  if (days === 1) return isEn ? "Due tomorrow" : "Vence mañana";
  return isEn
    ? `Due in ${days} days`
    : `Vence en ${days} días`;
}

export function TenantPayments({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const [payments, setPayments] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Payment form state
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [notes, setNotes] = useState("");

  const getToken = useCallback(() => {
    const token = localStorage.getItem("tenant_token");
    if (!token) {
      router.push("/tenant/login");
      return null;
    }
    return token;
  }, [router]);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/tenant/payments`, {
        headers: { "x-tenant-token": token },
      });
      if (res.status === 401) {
        localStorage.clear();
        router.push("/tenant/login");
        return;
      }
      const json = await res.json();
      setPayments(
        ((json.data ?? []) as Record<string, unknown>[]).map((r) => ({
          id: asString(r.id),
          due_date: asString(r.due_date),
          amount: asNumber(r.amount),
          currency: asString(r.currency) || "PYG",
          status: asString(r.status),
          paid_at: asString(r.paid_at) || null,
          payment_method: asString(r.payment_method) || null,
          payment_reference: asString(r.payment_reference) || null,
          payment_link_reference: asString(r.payment_link_reference) || null,
          notes: asString(r.notes) || null,
        }))
      );
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [router, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const fetchPaymentInstructions = useCallback(
    async (collectionId: string) => {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch(
          `${API_BASE}/tenant/payment-instructions/${collectionId}`,
          { headers: { "x-tenant-token": token } }
        );
        if (res.ok) {
          const json = await res.json();
          const bd = json.bank_details as Record<string, unknown> | null;
          if (bd) {
            setBankDetails({
              bank_name: asString(bd.bank_name) || null,
              bank_account_number: asString(bd.bank_account_number) || null,
              bank_account_holder: asString(bd.bank_account_holder) || null,
              bank_ruc: asString(bd.bank_ruc) || null,
            });
          }
        }
      } catch {
        /* ignore */
      }
    },
    [getToken]
  );

  const handleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setPaymentMethod("bank_transfer");
    setPaymentReference("");
    setReceiptUrl("");
    setNotes("");
    setSubmitSuccess(null);
    fetchPaymentInstructions(id);
  };

  const handleSubmitPayment = async (collectionId: string) => {
    const token = getToken();
    if (!token) return;

    setSubmitting(collectionId);
    try {
      const res = await fetch(
        `${API_BASE}/tenant/payments/${collectionId}/submit`,
        {
          method: "POST",
          headers: {
            "x-tenant-token": token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            payment_method: paymentMethod || undefined,
            payment_reference: paymentReference || undefined,
            receipt_url: receiptUrl || undefined,
            notes: notes || undefined,
          }),
        }
      );

      if (res.ok) {
        setSubmitSuccess(collectionId);
        setExpandedId(null);
        // Reload data
        await load();
      }
    } catch {
      /* ignore */
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-muted-foreground animate-pulse">
          {isEn ? "Loading..." : "Cargando..."}
        </p>
      </div>
    );
  }

  const unpaid = payments.filter(
    (p) => p.status !== "paid" && p.status !== "waived"
  );
  const paid = payments.filter(
    (p) => p.status === "paid" || p.status === "waived"
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {isEn ? "My Payments" : "Mis Pagos"}
        </h1>
        <Link href="/tenant/dashboard">
          <Button size="sm" variant="outline">
            {isEn ? "Back" : "Volver"}
          </Button>
        </Link>
      </div>

      {submitSuccess && (
        <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              {isEn
                ? "Payment reported successfully! Your property manager will confirm it shortly."
                : "¡Pago reportado exitosamente! Tu administrador lo confirmará pronto."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pending / Upcoming Payments */}
      {unpaid.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            {isEn ? "Pending Payments" : "Pagos Pendientes"}
          </h2>
          {unpaid.map((p) => {
            const days = daysUntilDue(p.due_date);
            const isOverdue = days < 0;
            const isExpanded = expandedId === p.id;

            return (
              <Card
                key={p.id}
                className={
                  isOverdue
                    ? "border-red-200 dark:border-red-900"
                    : days <= 3
                      ? "border-amber-200 dark:border-amber-900"
                      : ""
                }
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xl font-bold">
                        {formatCurrency(p.amount, p.currency, locale)}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {isEn ? "Due:" : "Vence:"} {p.due_date}
                      </p>
                      <p
                        className={`text-xs font-medium ${isOverdue ? "text-red-600 dark:text-red-400" : days <= 3 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                      >
                        {dueLabel(days, isEn)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        label={statusLabel(p.status, isEn)}
                        value={p.status}
                      />
                      <Button
                        size="sm"
                        onClick={() => handleExpand(p.id)}
                        variant={isExpanded ? "secondary" : "default"}
                      >
                        {isExpanded
                          ? isEn
                            ? "Close"
                            : "Cerrar"
                          : isEn
                            ? "Report Payment"
                            : "Reportar Pago"}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded: Payment form */}
                  {isExpanded && (
                    <div className="mt-4 space-y-4 border-t pt-4">
                      {/* Bank details */}
                      {bankDetails &&
                        (bankDetails.bank_name ||
                          bankDetails.bank_account_number) && (
                          <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950">
                            <p className="mb-2 text-sm font-semibold text-blue-800 dark:text-blue-200">
                              {isEn
                                ? "Bank Transfer Details"
                                : "Datos para Transferencia"}
                            </p>
                            {bankDetails.bank_name && (
                              <p className="text-sm">
                                <span className="text-muted-foreground">
                                  {isEn ? "Bank:" : "Banco:"}
                                </span>{" "}
                                {bankDetails.bank_name}
                              </p>
                            )}
                            {bankDetails.bank_account_number && (
                              <p className="text-sm">
                                <span className="text-muted-foreground">
                                  {isEn ? "Account:" : "Cuenta:"}
                                </span>{" "}
                                {bankDetails.bank_account_number}
                              </p>
                            )}
                            {bankDetails.bank_account_holder && (
                              <p className="text-sm">
                                <span className="text-muted-foreground">
                                  {isEn ? "Holder:" : "Titular:"}
                                </span>{" "}
                                {bankDetails.bank_account_holder}
                              </p>
                            )}
                            {bankDetails.bank_ruc && (
                              <p className="text-sm">
                                <span className="text-muted-foreground">
                                  RUC:
                                </span>{" "}
                                {bankDetails.bank_ruc}
                              </p>
                            )}
                          </div>
                        )}

                      {/* Payment method */}
                      <div>
                        <label className="text-sm font-medium">
                          {isEn ? "Payment Method" : "Método de Pago"}
                        </label>
                        <select
                          className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                        >
                          <option value="bank_transfer">
                            {isEn
                              ? "Bank Transfer"
                              : "Transferencia Bancaria"}
                          </option>
                          <option value="cash">
                            {isEn ? "Cash" : "Efectivo"}
                          </option>
                          <option value="qr_payment">
                            {isEn ? "QR Payment" : "Pago QR"}
                          </option>
                          <option value="other">
                            {isEn ? "Other" : "Otro"}
                          </option>
                        </select>
                      </div>

                      {/* Reference number */}
                      <div>
                        <label className="text-sm font-medium">
                          {isEn
                            ? "Payment Reference / Transaction #"
                            : "Referencia / Nro. de Transacción"}
                        </label>
                        <Input
                          className="mt-1"
                          placeholder={
                            isEn
                              ? "e.g. Transfer #12345"
                              : "ej. Transferencia #12345"
                          }
                          value={paymentReference}
                          onChange={(e) => setPaymentReference(e.target.value)}
                        />
                      </div>

                      {/* Receipt URL */}
                      <div>
                        <label className="text-sm font-medium">
                          {isEn
                            ? "Receipt URL (optional)"
                            : "URL del Comprobante (opcional)"}
                        </label>
                        <Input
                          className="mt-1"
                          placeholder={
                            isEn
                              ? "Paste link to receipt image"
                              : "Pegar enlace a imagen del comprobante"
                          }
                          value={receiptUrl}
                          onChange={(e) => setReceiptUrl(e.target.value)}
                        />
                      </div>

                      {/* Notes */}
                      <div>
                        <label className="text-sm font-medium">
                          {isEn ? "Notes (optional)" : "Notas (opcional)"}
                        </label>
                        <Textarea
                          className="mt-1"
                          rows={2}
                          placeholder={
                            isEn ? "Any additional info" : "Información adicional"
                          }
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      </div>

                      <Button
                        className="w-full"
                        disabled={submitting === p.id}
                        onClick={() => handleSubmitPayment(p.id)}
                      >
                        {submitting === p.id
                          ? isEn
                            ? "Submitting..."
                            : "Enviando..."
                          : isEn
                            ? "Submit Payment Report"
                            : "Enviar Reporte de Pago"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Paid / History */}
      {paid.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            {isEn ? "Payment History" : "Historial"}
          </h2>
          {paid.map((p) => (
            <Card key={p.id} className="opacity-75">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">
                    {formatCurrency(p.amount, p.currency, locale)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {isEn ? "Due:" : "Vence:"} {p.due_date}
                  </p>
                  {p.paid_at && (
                    <p className="text-muted-foreground text-xs">
                      {isEn ? "Paid:" : "Pagado:"} {p.paid_at.slice(0, 10)}
                    </p>
                  )}
                </div>
                <StatusBadge
                  label={statusLabel(p.status, isEn)}
                  value={p.status}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {payments.length === 0 && (
        <p className="text-muted-foreground">
          {isEn ? "No payments found." : "No se encontraron pagos."}
        </p>
      )}
    </div>
  );
}
