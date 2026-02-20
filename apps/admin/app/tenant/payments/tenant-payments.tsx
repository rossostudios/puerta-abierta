"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  const due = new Date(`${dueDate}T00:00:00`);
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
  return isEn ? `Due in ${days} days` : `Vence en ${days} días`;
}

export function TenantPayments({ locale }: { locale: string }) {
  "use no memo";
  const isEn = locale === "en-US";
  const router = useRouter();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Payment form state
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [notes, setNotes] = useState("");

  const [tokenState] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("tenant_token") : null
  );

  const getToken = useCallback(() => {
    const token = localStorage.getItem("tenant_token");
    if (!token) {
      router.push("/tenant/login");
      return null;
    }
    return token;
  }, [router]);

  const { data: payments = [], isPending: loading } = useQuery({
    queryKey: ["tenant-payments", tokenState],
    queryFn: async () => {
      const token = getToken();
      if (!token) return [];
      const res = await fetch(`${API_BASE}/tenant/payments`, {
        headers: { "x-tenant-token": token },
      });
      if (res.status === 401) {
        localStorage.clear();
        router.push("/tenant/login");
        return [];
      }
      if (!res.ok) return [];
      const json = await res.json();
      const rawData = json.data;
      let rows: Record<string, unknown>[] = [];
      if (rawData != null) rows = rawData as Record<string, unknown>[];
      return rows.map((r): Row => {
        const currency = asString(r.currency);
        const paidAt = asString(r.paid_at);
        const payMethod = asString(r.payment_method);
        const payRef = asString(r.payment_reference);
        const payLinkRef = asString(r.payment_link_reference);
        const notesVal = asString(r.notes);

        let currencyVal = "PYG";
        if (currency) {
          currencyVal = currency;
        }
        let paidAtVal: string | null = null;
        if (paidAt) {
          paidAtVal = paidAt;
        }
        let payMethodVal: string | null = null;
        if (payMethod) {
          payMethodVal = payMethod;
        }
        let payRefVal: string | null = null;
        if (payRef) {
          payRefVal = payRef;
        }
        let payLinkRefVal: string | null = null;
        if (payLinkRef) {
          payLinkRefVal = payLinkRef;
        }
        let notesResult: string | null = null;
        if (notesVal) {
          notesResult = notesVal;
        }

        return {
          id: asString(r.id),
          due_date: asString(r.due_date),
          amount: asNumber(r.amount),
          currency: currencyVal,
          status: asString(r.status),
          paid_at: paidAtVal,
          payment_method: payMethodVal,
          payment_reference: payRefVal,
          payment_link_reference: payLinkRefVal,
          notes: notesResult,
        };
      });
    },
    enabled: Boolean(tokenState),
  });

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
            const bName = asString(bd.bank_name);
            const bAcct = asString(bd.bank_account_number);
            const bHolder = asString(bd.bank_account_holder);
            const bRuc = asString(bd.bank_ruc);
            let bankName: string | null = null;
            if (bName) {
              bankName = bName;
            }
            let bankAcct: string | null = null;
            if (bAcct) {
              bankAcct = bAcct;
            }
            let bankHolder: string | null = null;
            if (bHolder) {
              bankHolder = bHolder;
            }
            let bankRuc: string | null = null;
            if (bRuc) {
              bankRuc = bRuc;
            }
            setBankDetails({
              bank_name: bankName,
              bank_account_number: bankAcct,
              bank_account_holder: bankHolder,
              bank_ruc: bankRuc,
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
    const methodVal = paymentMethod || undefined;
    const refVal = paymentReference || undefined;
    const receiptVal = receiptUrl || undefined;
    const notesVal = notes || undefined;
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
            payment_method: methodVal,
            payment_reference: refVal,
            receipt_url: receiptVal,
            notes: notesVal,
          }),
        }
      );

      if (res.ok) {
        setSubmitSuccess(collectionId);
        setExpandedId(null);
        queryClient.invalidateQueries({ queryKey: ["tenant-payments"] });
      }
      setSubmitting(null);
    } catch {
      /* ignore */
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="animate-pulse text-muted-foreground">
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
        <h1 className="font-bold text-2xl">
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
            <p className="font-medium text-green-800 text-sm dark:text-green-200">
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
          <h2 className="font-semibold text-lg">
            {isEn ? "Pending Payments" : "Pagos Pendientes"}
          </h2>
          {unpaid.map((p) => {
            const days = daysUntilDue(p.due_date);
            const isOverdue = days < 0;
            const isExpanded = expandedId === p.id;

            return (
              <Card
                className={
                  isOverdue
                    ? "border-red-200 dark:border-red-900"
                    : days <= 3
                      ? "border-amber-200 dark:border-amber-900"
                      : ""
                }
                key={p.id}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-xl">
                        {formatCurrency(p.amount, p.currency, locale)}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {isEn ? "Due:" : "Vence:"} {p.due_date}
                      </p>
                      <p
                        className={`font-medium text-xs ${isOverdue ? "text-red-600 dark:text-red-400" : days <= 3 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
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
                        onClick={() => handleExpand(p.id)}
                        size="sm"
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
                            <p className="mb-2 font-semibold text-blue-800 text-sm dark:text-blue-200">
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
                        <label className="font-medium text-sm">
                          {isEn ? "Payment Method" : "Método de Pago"}
                        </label>
                        <select
                          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          onChange={(e) => setPaymentMethod(e.target.value)}
                          value={paymentMethod}
                        >
                          <option value="bank_transfer">
                            {isEn ? "Bank Transfer" : "Transferencia Bancaria"}
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
                        <label className="font-medium text-sm">
                          {isEn
                            ? "Payment Reference / Transaction #"
                            : "Referencia / Nro. de Transacción"}
                        </label>
                        <Input
                          className="mt-1"
                          onChange={(e) => setPaymentReference(e.target.value)}
                          placeholder={
                            isEn
                              ? "e.g. Transfer #12345"
                              : "ej. Transferencia #12345"
                          }
                          value={paymentReference}
                        />
                      </div>

                      {/* Receipt URL */}
                      <div>
                        <label className="font-medium text-sm">
                          {isEn
                            ? "Receipt URL (optional)"
                            : "URL del Comprobante (opcional)"}
                        </label>
                        <Input
                          className="mt-1"
                          onChange={(e) => setReceiptUrl(e.target.value)}
                          placeholder={
                            isEn
                              ? "Paste link to receipt image"
                              : "Pegar enlace a imagen del comprobante"
                          }
                          value={receiptUrl}
                        />
                      </div>

                      {/* Notes */}
                      <div>
                        <label className="font-medium text-sm">
                          {isEn ? "Notes (optional)" : "Notas (opcional)"}
                        </label>
                        <Textarea
                          className="mt-1"
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder={
                            isEn
                              ? "Any additional info"
                              : "Información adicional"
                          }
                          rows={2}
                          value={notes}
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
          <h2 className="font-semibold text-lg">
            {isEn ? "Payment History" : "Historial"}
          </h2>
          {paid.map((p) => (
            <Card className="opacity-75" key={p.id}>
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
