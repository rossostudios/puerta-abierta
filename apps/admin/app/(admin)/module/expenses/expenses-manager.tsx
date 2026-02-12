"use client";

import {
  Delete02Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  createExpenseAction,
  deleteExpenseAction,
  updateExpenseAction,
} from "@/app/(admin)/module/expenses/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { formatCurrency, humanizeKey } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

type ExpenseRow = {
  id: string;
  organization_id: string;
  property_id: string | null;
  property_name?: string | null;
  unit_id: string | null;
  unit_name?: string | null;
  reservation_id: string | null;
  category: string;
  vendor_name: string | null;
  expense_date: string;
  amount: number;
  currency: string;
  fx_rate_to_pyg?: number | null;
  payment_method: string;
  invoice_number?: string | null;
  invoice_ruc?: string | null;
  receipt_url?: string | null;
  notes?: string | null;
  created_by_user_id?: string | null;
  created_at?: string | null;
};

type PropertyRow = { id: string; name?: string | null };
type UnitRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  property_id?: string | null;
  property_name?: string | null;
};

type ExpenseRecord = Record<string, unknown>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asOptionalString(value: unknown): string | null {
  const text = asString(value).trim();
  return text ? text : null;
}

function safeIsoDate(value: string): string {
  // Keep YYYY-MM-DD only; anything else falls back to "" so inputs don't blow up.
  return ISO_DATE_RE.test(value) ? value : "";
}

function shortId(value: string): string {
  const text = value.trim();
  if (text.length <= 14) return text;
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function sumByCurrency(rows: ExpenseRow[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const currency = (row.currency || "PYG").toUpperCase();
    totals[currency] = (totals[currency] ?? 0) + (row.amount ?? 0);
  }
  return totals;
}

function sumAsPyg(rows: ExpenseRow[]): number | null {
  let total = 0;
  for (const row of rows) {
    const currency = (row.currency || "PYG").toUpperCase();
    const amount = row.amount ?? 0;
    if (!Number.isFinite(amount)) continue;
    if (currency === "PYG") {
      total += amount;
      continue;
    }
    if (currency === "USD") {
      const fx = row.fx_rate_to_pyg;
      if (!(typeof fx === "number" && Number.isFinite(fx) && fx > 0)) {
        return null;
      }
      total += amount * fx;
      continue;
    }
    return null;
  }
  return total;
}

function ExpenseRowActions({
  row,
  nextPath,
  canManage,
  onEdit,
}: {
  row: ExpenseRow;
  nextPath: string;
  canManage: boolean;
  onEdit: (row: ExpenseRow) => void;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const id = asString(row.id).trim();
  if (!id) return null;

  return (
    <div className="flex items-center justify-end gap-2">
      <Link
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        href={`/module/expenses/${encodeURIComponent(id)}`}
      >
        {isEn ? "Open" : "Abrir"}
      </Link>
      {canManage ? (
        <Button
          onClick={() => onEdit(row)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Icon icon={PencilEdit01Icon} size={16} />
          <span className="sr-only">{isEn ? "Edit" : "Editar"}</span>
        </Button>
      ) : null}
      {canManage ? (
        <Form action={deleteExpenseAction}>
          <input name="expense_id" type="hidden" value={id} />
          <input name="next" type="hidden" value={nextPath} />
          <Button size="sm" type="submit" variant="ghost">
            <Icon icon={Delete02Icon} size={16} />
            <span className="sr-only">{isEn ? "Delete" : "Eliminar"}</span>
          </Button>
        </Form>
      ) : null}
    </div>
  );
}

export function ExpensesManager({
  expenses,
  orgId,
  properties,
  units,
}: {
  expenses: Record<string, unknown>[];
  orgId: string;
  properties: Record<string, unknown>[];
  units: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const [membershipRole, setMembershipRole] = useState<string | null>(null);
  const [roleStatus, setRoleStatus] = useState<"loading" | "ok" | "error">(
    "loading"
  );

  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [paymentMethod, setPaymentMethod] = useState("all");
  const [propertyId, setPropertyId] = useState("all");
  const [unitId, setUnitId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const propertyOptions = useMemo(() => {
    return (properties as PropertyRow[])
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        const name = asString(row.name).trim();
        return { id, label: name || id };
      })
      .filter((item): item is { id: string; label: string } => Boolean(item))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [properties]);

  const unitOptions = useMemo(() => {
    return (units as UnitRow[])
      .map((unit) => {
        const id = asString(unit.id).trim();
        if (!id) return null;
        const name = asString(unit.name).trim();
        const code = asString(unit.code).trim();
        const propertyName = asString(unit.property_name).trim();
        const label = [propertyName, code || name || id]
          .filter(Boolean)
          .join(" · ");
        return {
          id,
          property_id: asOptionalString(unit.property_id),
          label: label || id,
        };
      })
      .filter(
        (
          item
        ): item is { id: string; property_id: string | null; label: string } =>
          Boolean(item)
      )
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [units]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const normalizedCategory = category.trim().toLowerCase();
    const normalizedCurrency = currency.trim().toUpperCase();
    const normalizedPayment = paymentMethod.trim().toLowerCase();

    const from = fromDate ? safeIsoDate(fromDate) : "";
    const to = toDate ? safeIsoDate(toDate) : "";

    return (expenses as ExpenseRecord[])
      .filter((expense) => {
        const rowCategory = asString(expense.category).trim().toLowerCase();
        if (
          normalizedCategory !== "all" &&
          rowCategory !== normalizedCategory
        ) {
          return false;
        }

        const rowCurrency = asString(expense.currency).trim().toUpperCase();
        if (
          normalizedCurrency !== "ALL" &&
          rowCurrency !== normalizedCurrency
        ) {
          return false;
        }

        const rowPayment = asString(expense.payment_method)
          .trim()
          .toLowerCase();
        if (normalizedPayment !== "all" && rowPayment !== normalizedPayment) {
          return false;
        }

        const rowPropertyId = asString(expense.property_id).trim();
        if (propertyId !== "all" && rowPropertyId !== propertyId) {
          return false;
        }

        const rowUnitId = asString(expense.unit_id).trim();
        if (unitId !== "all" && rowUnitId !== unitId) {
          return false;
        }

        const dateValue = safeIsoDate(asString(expense.expense_date).trim());
        if (from && dateValue && dateValue < from) return false;
        if (to && dateValue && dateValue > to) return false;

        if (!needle) return true;

        const haystack = [
          expense.id,
          expense.category,
          expense.vendor_name,
          expense.payment_method,
          expense.property_name,
          expense.unit_name,
          expense.reservation_id,
          expense.invoice_number,
          expense.invoice_ruc,
          expense.notes,
        ]
          .map((value) => asString(value).trim().toLowerCase())
          .filter(Boolean)
          .join(" | ");

        return haystack.includes(needle);
      })
      .map((expense) => {
        return {
          id: asString(expense.id).trim(),
          expense_date:
            safeIsoDate(asString(expense.expense_date).trim()) ||
            asString(expense.expense_date).trim(),
          category: asString(expense.category).trim(),
          vendor_name: asOptionalString(expense.vendor_name),
          amount: asNumber(expense.amount),
          currency: asString(expense.currency).trim().toUpperCase() || "PYG",
          fx_rate_to_pyg: asNumber(expense.fx_rate_to_pyg) || null,
          payment_method: asString(expense.payment_method).trim(),
          property_id: asOptionalString(expense.property_id),
          property_name: asOptionalString(expense.property_name),
          unit_id: asOptionalString(expense.unit_id),
          unit_name: asOptionalString(expense.unit_name),
          reservation_id: asOptionalString(expense.reservation_id),
          invoice_number: asOptionalString(expense.invoice_number),
          invoice_ruc: asOptionalString(expense.invoice_ruc),
          receipt_url: asOptionalString(expense.receipt_url),
          notes: asOptionalString(expense.notes),
          created_at: asOptionalString(expense.created_at),
          organization_id: asString(expense.organization_id).trim(),
        } satisfies ExpenseRow;
      });
  }, [
    category,
    currency,
    expenses,
    fromDate,
    paymentMethod,
    propertyId,
    query,
    toDate,
    unitId,
  ]);

  const totalsByCurrency = useMemo(() => sumByCurrency(rows), [rows]);
  const totalPyg = useMemo(() => sumAsPyg(rows), [rows]);

  const columns = useMemo<ColumnDef<DataTableRow>[]>(() => {
    return [
      {
        accessorKey: "expense_date",
        header: isEn ? "Date" : "Fecha",
      },
      {
        accessorKey: "category",
        header: isEn ? "Category" : "Categoría",
        cell: ({ getValue }) => (
          <Badge variant="secondary">
            {humanizeKey(String(getValue() ?? ""))}
          </Badge>
        ),
      },
      {
        id: "amount_display",
        header: isEn ? "Amount" : "Monto",
        accessorFn: (row) => asNumber(row.amount),
        cell: ({ row }) => {
          const original = row.original;
          const amount = asNumber(original.amount);
          const currency =
            asString(original.currency).trim().toUpperCase() || "PYG";
          return (
            <span className="font-medium tabular-nums">
              {formatCurrency(amount, currency, locale)}
            </span>
          );
        },
      },
      {
        accessorKey: "vendor_name",
        header: isEn ? "Vendor" : "Proveedor",
        cell: ({ getValue }) => {
          const text = asString(getValue()).trim();
          return text ? (
            <span className="break-words">{text}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
      },
      {
        accessorKey: "payment_method",
        header: isEn ? "Method" : "Método",
        cell: ({ getValue }) => {
          const text = asString(getValue()).trim();
          return text ? (
            <Badge variant="outline">{humanizeKey(text)}</Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
      },
      {
        accessorKey: "property_name",
        header: isEn ? "Property" : "Propiedad",
        cell: ({ getValue, row }) => {
          const name = asString(getValue()).trim();
          const id = asString(row.original.property_id).trim();
          if (!(name || id))
            return <span className="text-muted-foreground">-</span>;
          return (
            <span className="min-w-0">
              <span className="block truncate">{name || shortId(id)}</span>
            </span>
          );
        },
      },
      {
        accessorKey: "unit_name",
        header: isEn ? "Unit" : "Unidad",
        cell: ({ getValue, row }) => {
          const name = asString(getValue()).trim();
          const id = asString(row.original.unit_id).trim();
          if (!(name || id))
            return <span className="text-muted-foreground">-</span>;
          return (
            <span className="min-w-0">
              <span className="block truncate">{name || shortId(id)}</span>
            </span>
          );
        },
      },
      {
        id: "receipt",
        header: isEn ? "Receipt" : "Comprobante",
        enableSorting: false,
        accessorFn: (row) => row.receipt_url,
        cell: ({ getValue }) => {
          const url = asString(getValue()).trim();
          if (!url) return <span className="text-muted-foreground">-</span>;
          return (
            <a
              className="text-primary underline-offset-4 hover:underline"
              href={url}
              rel="noreferrer"
              target="_blank"
            >
              {isEn ? "View" : "Ver"}
            </a>
          );
        },
      },
    ];
  }, [isEn, locale]);

  const nextPath = "/module/expenses";

  const [createCategory, setCreateCategory] = useState("supplies");
  const [createExpenseDate, setCreateExpenseDate] = useState("");
  const [createAmount, setCreateAmount] = useState("");
  const [createCurrency, setCreateCurrency] = useState("PYG");
  const [createFxRate, setCreateFxRate] = useState("");
  const [createPaymentMethod, setCreatePaymentMethod] = useState("cash");
  const [createVendor, setCreateVendor] = useState("");
  const [createReservationId, setCreateReservationId] = useState("");
  const [createPropertyId, setCreatePropertyId] = useState("");
  const [createUnitId, setCreateUnitId] = useState("");
  const [createInvoiceNumber, setCreateInvoiceNumber] = useState("");
  const [createInvoiceRuc, setCreateInvoiceRuc] = useState("");
  const [createReceiptUrl, setCreateReceiptUrl] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [uploading, setUploading] = useState(false);

  const [editCategory, setEditCategory] = useState("supplies");
  const [editExpenseDate, setEditExpenseDate] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCurrency, setEditCurrency] = useState("PYG");
  const [editFxRate, setEditFxRate] = useState("");
  const [editPaymentMethod, setEditPaymentMethod] = useState("cash");
  const [editVendor, setEditVendor] = useState("");
  const [editReservationId, setEditReservationId] = useState("");
  const [editPropertyId, setEditPropertyId] = useState("");
  const [editUnitId, setEditUnitId] = useState("");
  const [editInvoiceNumber, setEditInvoiceNumber] = useState("");
  const [editInvoiceRuc, setEditInvoiceRuc] = useState("");
  const [editReceiptUrl, setEditReceiptUrl] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editUploading, setEditUploading] = useState(false);

  const reservationLocked = createReservationId.trim().length > 0;
  const editReservationLocked = editReservationId.trim().length > 0;

  const canManage =
    roleStatus !== "ok"
      ? true
      : membershipRole === "owner_admin" || membershipRole === "accountant";

  useEffect(() => {
    let mounted = true;
    setRoleStatus("loading");

    async function load() {
      try {
        const response = await fetch("/api/me", { cache: "no-store" });
        if (!response.ok) {
          if (!mounted) return;
          setRoleStatus("error");
          return;
        }

        const payload = (await response.json()) as {
          memberships?: Array<{ organization_id?: string; role?: string }>;
        };
        const memberships = payload.memberships ?? [];
        const membership =
          memberships.find((item) => item.organization_id === orgId) ?? null;
        if (!mounted) return;
        setMembershipRole(membership?.role ?? null);
        setRoleStatus("ok");
      } catch {
        if (!mounted) return;
        setRoleStatus("error");
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [orgId]);

  const onUploadReceipt = async (file: File | null) => {
    if (!file) return;
    if (!orgId) return;

    setUploading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const safeName = file.name.replaceAll(/[^\w.-]+/g, "-");
      const key = `${orgId}/expenses/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(key, file, { upsert: false });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data } = supabase.storage.from("receipts").getPublicUrl(key);
      const publicUrl = data.publicUrl;
      if (!publicUrl)
        throw new Error("Could not resolve a public URL for the upload.");

      setCreateReceiptUrl(publicUrl);
      toast.success(isEn ? "Receipt uploaded" : "Comprobante subido", {
        description: safeName,
      });
    } catch (err) {
      toast.error(
        isEn ? "Receipt upload failed" : "Falló la subida del comprobante",
        {
          description: err instanceof Error ? err.message : String(err),
        }
      );
    } finally {
      setUploading(false);
    }
  };

  const onUploadEditReceipt = async (file: File | null) => {
    if (!file) return;
    if (!orgId) return;

    setEditUploading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const safeName = file.name.replaceAll(/[^\w.-]+/g, "-");
      const key = `${orgId}/expenses/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(key, file, { upsert: false });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data } = supabase.storage.from("receipts").getPublicUrl(key);
      const publicUrl = data.publicUrl;
      if (!publicUrl)
        throw new Error("Could not resolve a public URL for the upload.");

      setEditReceiptUrl(publicUrl);
      toast.success(isEn ? "Receipt uploaded" : "Comprobante subido", {
        description: safeName,
      });
    } catch (err) {
      toast.error(
        isEn ? "Receipt upload failed" : "Falló la subida del comprobante",
        {
          description: err instanceof Error ? err.message : String(err),
        }
      );
    } finally {
      setEditUploading(false);
    }
  };

  const beginEdit = (row: ExpenseRow) => {
    setEditing(row);
    setEditCategory(asString(row.category).trim() || "other");
    setEditExpenseDate(safeIsoDate(asString(row.expense_date).trim()));
    setEditAmount(String(asNumber(row.amount)));
    setEditCurrency(asString(row.currency).trim().toUpperCase() || "PYG");
    setEditFxRate(
      typeof row.fx_rate_to_pyg === "number" && row.fx_rate_to_pyg > 0
        ? String(row.fx_rate_to_pyg)
        : ""
    );
    setEditPaymentMethod(asString(row.payment_method).trim() || "cash");
    setEditVendor(asString(row.vendor_name).trim());
    setEditReservationId(asString(row.reservation_id).trim());
    setEditPropertyId(asString(row.property_id).trim());
    setEditUnitId(asString(row.unit_id).trim());
    setEditInvoiceNumber(asString(row.invoice_number).trim());
    setEditInvoiceRuc(asString(row.invoice_ruc).trim());
    setEditReceiptUrl(asString(row.receipt_url).trim());
    setEditNotes(asString(row.notes).trim());
    setEditOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="grid w-full gap-2 md:grid-cols-4">
          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Search" : "Buscar"}
            </span>
            <Input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                isEn
                  ? "Vendor, category, notes..."
                  : "Proveedor, categoría, notas..."
              }
              value={query}
            />
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Category" : "Categoría"}
            </span>
            <Select
              onChange={(event) => setCategory(event.target.value)}
              value={category}
            >
              <option value="all">{isEn ? "All" : "Todas"}</option>
              <option value="cleaning">cleaning</option>
              <option value="maintenance">maintenance</option>
              <option value="utilities">utilities</option>
              <option value="supplies">supplies</option>
              <option value="platform_fee">platform_fee</option>
              <option value="tax">tax</option>
              <option value="staff">staff</option>
              <option value="other">other</option>
            </Select>
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Currency" : "Moneda"}
            </span>
            <Select
              onChange={(event) => setCurrency(event.target.value)}
              value={currency}
            >
              <option value="all">{isEn ? "All" : "Todas"}</option>
              <option value="PYG">PYG</option>
              <option value="USD">USD</option>
            </Select>
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Method" : "Método"}
            </span>
            <Select
              onChange={(event) => setPaymentMethod(event.target.value)}
              value={paymentMethod}
            >
              <option value="all">{isEn ? "All" : "Todos"}</option>
              <option value="bank_transfer">bank_transfer</option>
              <option value="cash">cash</option>
              <option value="card">card</option>
              <option value="qr">qr</option>
              <option value="other">other</option>
            </Select>
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Property" : "Propiedad"}
            </span>
            <Select
              onChange={(event) => {
                const next = event.target.value;
                setPropertyId(next);
                if (next !== "all") {
                  setUnitId("all");
                }
              }}
              value={propertyId}
            >
              <option value="all">{isEn ? "All" : "Todas"}</option>
              {propertyOptions.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Unit" : "Unidad"}
            </span>
            <Select
              onChange={(event) => setUnitId(event.target.value)}
              value={unitId}
            >
              <option value="all">{isEn ? "All" : "Todas"}</option>
              {unitOptions
                .filter((unit) =>
                  propertyId === "all" ? true : unit.property_id === propertyId
                )
                .map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
            </Select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "From" : "Desde"}
              </span>
              <DatePicker
                locale={locale}
                max={toDate || undefined}
                onValueChange={setFromDate}
                value={fromDate}
              />
            </label>
            <label className="space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "To" : "Hasta"}
              </span>
              <DatePicker
                locale={locale}
                min={fromDate || undefined}
                onValueChange={setToDate}
                value={toDate}
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(totalsByCurrency).map(([currency, total]) => (
              <Badge
                className="font-mono text-xs"
                key={currency}
                variant="outline"
              >
                {currency} {formatCurrency(total, currency, locale)}
              </Badge>
            ))}
            {totalPyg !== null ? (
              <Badge className="font-mono text-xs" variant="secondary">
                {isEn ? "Total (PYG)" : "Total (PYG)"}{" "}
                {formatCurrency(totalPyg, "PYG", locale)}
              </Badge>
            ) : null}
          </div>

          <Button
            disabled={roleStatus === "ok" ? !canManage : false}
            onClick={() => {
              if (!canManage) {
                toast.error(
                  isEn
                    ? "You do not have permission to create expenses."
                    : "No tienes permiso para crear gastos."
                );
                return;
              }
              setOpen(true);
            }}
            type="button"
            variant="secondary"
          >
            <Icon icon={PlusSignIcon} size={16} />
            {isEn ? "Add expense" : "Agregar gasto"}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows as unknown as DataTableRow[]}
        renderRowActions={(row) => (
          <ExpenseRowActions
            canManage={canManage}
            nextPath={nextPath}
            onEdit={beginEdit}
            row={row as unknown as ExpenseRow}
          />
        )}
        rowActionsHeader={isEn ? "Actions" : "Acciones"}
        rowHrefBase="/module/expenses"
        searchPlaceholder={isEn ? "Filter..." : "Filtrar..."}
      />

      <Sheet
        description={
          isEn
            ? "Record expenses tied to properties, units, or reservations."
            : "Registra gastos vinculados a propiedades, unidades o reservas."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New expense" : "Nuevo gasto"}
      >
        <Form action={createExpenseAction} className="space-y-4">
          <input name="organization_id" type="hidden" value={orgId} />
          <input name="next" type="hidden" value={nextPath} />

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Category" : "Categoría"}
              </span>
              <Select
                name="category"
                onChange={(event) => setCreateCategory(event.target.value)}
                value={createCategory}
              >
                <option value="cleaning">cleaning</option>
                <option value="maintenance">maintenance</option>
                <option value="utilities">utilities</option>
                <option value="supplies">supplies</option>
                <option value="platform_fee">platform_fee</option>
                <option value="tax">tax</option>
                <option value="staff">staff</option>
                <option value="other">other</option>
              </Select>
            </label>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Date" : "Fecha"}
              </span>
              <DatePicker
                locale={locale}
                name="expense_date"
                onValueChange={setCreateExpenseDate}
                value={createExpenseDate}
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Amount" : "Monto"}
              </span>
              <Input
                inputMode="decimal"
                name="amount"
                onChange={(event) => setCreateAmount(event.target.value)}
                placeholder={isEn ? "e.g. 95000" : "Ej. 95000"}
                required
                value={createAmount}
              />
            </label>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Currency" : "Moneda"}
              </span>
              <Select
                name="currency"
                onChange={(event) => setCreateCurrency(event.target.value)}
                value={createCurrency}
              >
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </label>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Payment method" : "Método de pago"}
              </span>
              <Select
                name="payment_method"
                onChange={(event) => setCreatePaymentMethod(event.target.value)}
                value={createPaymentMethod}
              >
                <option value="bank_transfer">bank_transfer</option>
                <option value="cash">cash</option>
                <option value="card">card</option>
                <option value="qr">qr</option>
                <option value="other">other</option>
              </Select>
            </label>
          </div>

          {createCurrency === "USD" ? (
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "FX rate (USD → PYG)" : "Tipo de cambio (USD → PYG)"}
              </span>
              <Input
                inputMode="decimal"
                name="fx_rate_to_pyg"
                onChange={(event) => setCreateFxRate(event.target.value)}
                placeholder={isEn ? "Auto (leave blank)" : "Auto (dejar vacío)"}
                value={createFxRate}
              />
              <p className="text-muted-foreground text-xs">
                {isEn
                  ? "If blank, the backend will auto-fetch a snapshot for the expense date. You can override manually."
                  : "Si lo dejas vacío, el backend intentará obtener el tipo de cambio para la fecha. Puedes override manualmente."}
              </p>
            </label>
          ) : (
            <input name="fx_rate_to_pyg" type="hidden" value="" />
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Vendor (optional)" : "Proveedor (opcional)"}
              </span>
              <Input
                name="vendor_name"
                onChange={(event) => setCreateVendor(event.target.value)}
                placeholder={isEn ? "e.g. Supermarket" : "Ej. Supermercado"}
                value={createVendor}
              />
            </label>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn
                  ? "Reservation ID (optional)"
                  : "ID de reserva (opcional)"}
              </span>
              <Input
                name="reservation_id"
                onChange={(event) => setCreateReservationId(event.target.value)}
                placeholder={isEn ? "Paste UUID" : "Pega el UUID"}
                value={createReservationId}
              />
              {reservationLocked ? (
                <p className="text-muted-foreground text-xs">
                  {isEn
                    ? "Unit/property will be auto-linked from the reservation."
                    : "La unidad/propiedad se vinculará automáticamente desde la reserva."}
                </p>
              ) : null}
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Property (optional)" : "Propiedad (opcional)"}
              </span>
              <Select
                disabled={reservationLocked}
                name="property_id"
                onChange={(event) => setCreatePropertyId(event.target.value)}
                value={createPropertyId}
              >
                <option value="">
                  {isEn ? "No property" : "Sin propiedad"}
                </option>
                {propertyOptions.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Unit (optional)" : "Unidad (opcional)"}
              </span>
              <Select
                disabled={reservationLocked}
                name="unit_id"
                onChange={(event) => setCreateUnitId(event.target.value)}
                value={createUnitId}
              >
                <option value="">{isEn ? "No unit" : "Sin unidad"}</option>
                {unitOptions.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Invoice number (optional)" : "Nro. factura (opcional)"}
              </span>
              <Input
                name="invoice_number"
                onChange={(event) => setCreateInvoiceNumber(event.target.value)}
                value={createInvoiceNumber}
              />
            </label>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Invoice RUC (optional)" : "RUC (opcional)"}
              </span>
              <Input
                name="invoice_ruc"
                onChange={(event) => setCreateInvoiceRuc(event.target.value)}
                value={createInvoiceRuc}
              />
            </label>
          </div>

          <div className="space-y-2 rounded-md border bg-muted/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-sm">
                  {isEn ? "Receipt (required)" : "Comprobante (obligatorio)"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {isEn
                    ? "Upload a file or paste a URL."
                    : "Sube un archivo o pega un enlace."}
                </p>
              </div>

              <label
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "cursor-pointer"
                )}
              >
                <Icon icon={Upload04Icon} size={16} />
                {uploading
                  ? isEn
                    ? "Uploading..."
                    : "Subiendo..."
                  : isEn
                    ? "Upload"
                    : "Subir"}
                <input
                  accept="image/*,application/pdf"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) =>
                    onUploadReceipt(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Receipt URL" : "URL del comprobante"}
              </span>
              <Input
                name="receipt_url"
                onChange={(event) => setCreateReceiptUrl(event.target.value)}
                placeholder={isEn ? "https://..." : "https://..."}
                required
                value={createReceiptUrl}
              />
            </label>

            {createReceiptUrl.trim() ? (
              <a
                className="inline-flex items-center gap-2 text-primary text-sm underline-offset-4 hover:underline"
                href={createReceiptUrl.trim()}
                rel="noreferrer"
                target="_blank"
              >
                {isEn ? "Preview receipt" : "Ver comprobante"}
              </a>
            ) : null}
          </div>

          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Notes (optional)" : "Notas (opcional)"}
            </span>
            <Input
              name="notes"
              onChange={(event) => setCreateNotes(event.target.value)}
              value={createNotes}
            />
          </label>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              {isEn ? "Cancel" : "Cancelar"}
            </Button>
            <Button disabled={uploading} type="submit" variant="secondary">
              <Icon icon={PlusSignIcon} size={16} />
              {isEn ? "Create" : "Crear"}
            </Button>
          </div>
        </Form>
      </Sheet>

      {editing ? (
        <Sheet
          description={
            isEn
              ? "Update expense details. Receipt is required."
              : "Actualiza los datos del gasto. El comprobante es obligatorio."
          }
          onOpenChange={(next) => {
            if (next) {
              setEditOpen(true);
              return;
            }
            setEditOpen(false);
            setEditing(null);
          }}
          open={editOpen}
          title={isEn ? "Edit expense" : "Editar gasto"}
        >
          <Form action={updateExpenseAction} className="space-y-4">
            <input name="expense_id" type="hidden" value={editing.id} />
            <input name="next" type="hidden" value={nextPath} />

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn ? "Category" : "Categoría"}
                </span>
                <Select
                  name="category"
                  onChange={(event) => setEditCategory(event.target.value)}
                  value={editCategory}
                >
                  <option value="cleaning">cleaning</option>
                  <option value="maintenance">maintenance</option>
                  <option value="utilities">utilities</option>
                  <option value="supplies">supplies</option>
                  <option value="platform_fee">platform_fee</option>
                  <option value="tax">tax</option>
                  <option value="staff">staff</option>
                  <option value="other">other</option>
                </Select>
              </label>

              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn ? "Date" : "Fecha"}
                </span>
                <DatePicker
                  locale={locale}
                  name="expense_date"
                  onValueChange={setEditExpenseDate}
                  value={editExpenseDate}
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn ? "Amount" : "Monto"}
                </span>
                <Input
                  inputMode="decimal"
                  name="amount"
                  onChange={(event) => setEditAmount(event.target.value)}
                  required
                  value={editAmount}
                />
              </label>

              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn ? "Currency" : "Moneda"}
                </span>
                <Select
                  name="currency"
                  onChange={(event) => setEditCurrency(event.target.value)}
                  value={editCurrency}
                >
                  <option value="PYG">PYG</option>
                  <option value="USD">USD</option>
                </Select>
              </label>

              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn ? "Payment method" : "Método de pago"}
                </span>
                <Select
                  name="payment_method"
                  onChange={(event) => setEditPaymentMethod(event.target.value)}
                  value={editPaymentMethod}
                >
                  <option value="bank_transfer">bank_transfer</option>
                  <option value="cash">cash</option>
                  <option value="card">card</option>
                  <option value="qr">qr</option>
                  <option value="other">other</option>
                </Select>
              </label>
            </div>

            {editCurrency === "USD" ? (
              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn ? "FX rate (USD → PYG)" : "Tipo de cambio (USD → PYG)"}
                </span>
                <Input
                  inputMode="decimal"
                  name="fx_rate_to_pyg"
                  onChange={(event) => setEditFxRate(event.target.value)}
                  value={editFxRate}
                />
              </label>
            ) : (
              <input name="fx_rate_to_pyg" type="hidden" value="" />
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn ? "Vendor (optional)" : "Proveedor (opcional)"}
                </span>
                <Input
                  name="vendor_name"
                  onChange={(event) => setEditVendor(event.target.value)}
                  value={editVendor}
                />
              </label>

              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn
                    ? "Reservation ID (optional)"
                    : "ID de reserva (opcional)"}
                </span>
                <Input
                  name="reservation_id"
                  onChange={(event) => setEditReservationId(event.target.value)}
                  value={editReservationId}
                />
                {editReservationLocked ? (
                  <p className="text-muted-foreground text-xs">
                    {isEn
                      ? "Unit/property will be auto-linked from the reservation."
                      : "La unidad/propiedad se vinculará automáticamente desde la reserva."}
                  </p>
                ) : null}
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn ? "Property (optional)" : "Propiedad (opcional)"}
                </span>
                <Select
                  disabled={editReservationLocked}
                  name="property_id"
                  onChange={(event) => setEditPropertyId(event.target.value)}
                  value={editPropertyId}
                >
                  <option value="">
                    {isEn ? "No property" : "Sin propiedad"}
                  </option>
                  {propertyOptions.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.label}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn ? "Unit (optional)" : "Unidad (opcional)"}
                </span>
                <Select
                  disabled={editReservationLocked}
                  name="unit_id"
                  onChange={(event) => setEditUnitId(event.target.value)}
                  value={editUnitId}
                >
                  <option value="">{isEn ? "No unit" : "Sin unidad"}</option>
                  {unitOptions.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn
                    ? "Invoice number (optional)"
                    : "Nro. factura (opcional)"}
                </span>
                <Input
                  name="invoice_number"
                  onChange={(event) => setEditInvoiceNumber(event.target.value)}
                  value={editInvoiceNumber}
                />
              </label>

              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn ? "Invoice RUC (optional)" : "RUC (opcional)"}
                </span>
                <Input
                  name="invoice_ruc"
                  onChange={(event) => setEditInvoiceRuc(event.target.value)}
                  value={editInvoiceRuc}
                />
              </label>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">
                    {isEn ? "Receipt (required)" : "Comprobante (obligatorio)"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {isEn
                      ? "Upload a file or paste a URL."
                      : "Sube un archivo o pega un enlace."}
                  </p>
                </div>

                <label
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "cursor-pointer"
                  )}
                >
                  <Icon icon={Upload04Icon} size={16} />
                  {editUploading
                    ? isEn
                      ? "Uploading..."
                      : "Subiendo..."
                    : isEn
                      ? "Upload"
                      : "Subir"}
                  <input
                    accept="image/*,application/pdf"
                    className="sr-only"
                    disabled={editUploading}
                    onChange={(event) =>
                      onUploadEditReceipt(event.target.files?.[0] ?? null)
                    }
                    type="file"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="block font-medium text-muted-foreground text-xs">
                  {isEn ? "Receipt URL" : "URL del comprobante"}
                </span>
                <Input
                  name="receipt_url"
                  onChange={(event) => setEditReceiptUrl(event.target.value)}
                  required
                  value={editReceiptUrl}
                />
              </label>

              {editReceiptUrl.trim() ? (
                <a
                  className="inline-flex items-center gap-2 text-primary text-sm underline-offset-4 hover:underline"
                  href={editReceiptUrl.trim()}
                  rel="noreferrer"
                  target="_blank"
                >
                  {isEn ? "Preview receipt" : "Ver comprobante"}
                </a>
              ) : null}
            </div>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Notes (optional)" : "Notas (opcional)"}
              </span>
              <Input
                name="notes"
                onChange={(event) => setEditNotes(event.target.value)}
                value={editNotes}
              />
            </label>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                onClick={() => {
                  setEditOpen(false);
                  setEditing(null);
                }}
                type="button"
                variant="outline"
              >
                {isEn ? "Cancel" : "Cancelar"}
              </Button>
              <Button
                disabled={editUploading}
                type="submit"
                variant="secondary"
              >
                <Icon icon={PencilEdit01Icon} size={16} />
                {isEn ? "Save" : "Guardar"}
              </Button>
            </div>
          </Form>
        </Sheet>
      ) : null}
    </div>
  );
}
