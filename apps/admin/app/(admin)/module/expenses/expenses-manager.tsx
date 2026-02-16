"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  createExpenseAction,
  updateExpenseAction,
} from "@/app/(admin)/module/expenses/actions";
import { useExpenseColumns } from "@/app/(admin)/module/expenses/columns";
import { useReceiptUpload } from "@/app/(admin)/module/expenses/use-receipt-upload";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseRowActions } from "@/components/expenses/expense-row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DataTableRow } from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NotionDataTable } from "@/components/ui/notion-data-table";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import type {
  ExpenseRecord,
  ExpenseRow,
  PropertyRow,
  UnitRow,
} from "@/lib/features/expenses/types";
import {
  asNumber,
  asOptionalString,
  asString,
  safeIsoDate,
  sumAsPyg,
  sumByCurrency,
} from "@/lib/features/expenses/utils";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";

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

  const createUpload = useReceiptUpload(orgId);
  const editUpload = useReceiptUpload(orgId);

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
        if (normalizedCategory !== "all" && rowCategory !== normalizedCategory)
          return false;

        const rowCurrency = asString(expense.currency).trim().toUpperCase();
        if (normalizedCurrency !== "ALL" && rowCurrency !== normalizedCurrency)
          return false;

        const rowPayment = asString(expense.payment_method)
          .trim()
          .toLowerCase();
        if (normalizedPayment !== "all" && rowPayment !== normalizedPayment)
          return false;

        const rowPropertyId = asString(expense.property_id).trim();
        if (propertyId !== "all" && rowPropertyId !== propertyId) return false;

        const rowUnitId = asString(expense.unit_id).trim();
        if (unitId !== "all" && rowUnitId !== unitId) return false;

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

  const columns = useExpenseColumns(isEn, locale);

  const nextPath = "/module/expenses";

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

  const beginEdit = (row: ExpenseRow) => {
    setEditing(row);
    setEditOpen(true);
  };

  const exportCsv = useCallback(() => {
    const headers = [
      "date",
      "category",
      "vendor",
      "amount",
      "currency",
      "payment_method",
      "property",
      "unit",
      "invoice_number",
      "notes",
    ];
    const csvRows = [headers.join(",")];
    for (const row of rows) {
      csvRows.push(
        [
          row.expense_date,
          row.category,
          (row.vendor_name ?? "").replace(/,/g, " "),
          row.amount,
          row.currency,
          row.payment_method,
          (row.property_name ?? "").replace(/,/g, " "),
          (row.unit_name ?? "").replace(/,/g, " "),
          row.invoice_number ?? "",
          (row.notes ?? "").replace(/,/g, " ").replace(/\n/g, " "),
        ].join(",")
      );
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

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
            {Object.entries(totalsByCurrency).map(([cur, total]) => (
              <Badge className="font-mono text-xs" key={cur} variant="outline">
                {cur} {formatCurrency(total, cur, locale)}
              </Badge>
            ))}
            {totalPyg !== null ? (
              <Badge className="font-mono text-xs" variant="secondary">
                {isEn ? "Total (PYG)" : "Total (PYG)"}{" "}
                {formatCurrency(totalPyg, "PYG", locale)}
              </Badge>
            ) : null}
          </div>

          <Button onClick={exportCsv} type="button" variant="outline">
            {isEn ? "Export CSV" : "Exportar CSV"}
          </Button>
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

      <NotionDataTable
        columns={columns}
        data={rows as unknown as DataTableRow[]}
        hideSearch
        isEn={isEn}
        renderRowActions={(row) => (
          <ExpenseRowActions
            canManage={canManage}
            nextPath={nextPath}
            onEdit={beginEdit}
            row={row as unknown as ExpenseRow}
          />
        )}
        rowActionsHeader={isEn ? "Actions" : "Acciones"}
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
        <ExpenseForm
          action={createExpenseAction}
          editing={null}
          isEn={isEn}
          locale={locale}
          mode="create"
          nextPath={nextPath}
          onClose={() => setOpen(false)}
          onUpload={createUpload.upload}
          orgId={orgId}
          propertyOptions={propertyOptions}
          unitOptions={unitOptions}
          uploading={createUpload.uploading}
        />
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
          <ExpenseForm
            action={updateExpenseAction}
            editing={editing}
            isEn={isEn}
            locale={locale}
            mode="edit"
            nextPath={nextPath}
            onClose={() => {
              setEditOpen(false);
              setEditing(null);
            }}
            onUpload={editUpload.upload}
            orgId={orgId}
            propertyOptions={propertyOptions}
            unitOptions={unitOptions}
            uploading={editUpload.uploading}
          />
        </Sheet>
      ) : null}
    </div>
  );
}
