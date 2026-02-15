"use client";

import {
  PencilEdit01Icon,
  PlusSignIcon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ExpenseRow } from "@/lib/features/expenses/types";
import { asNumber, asString, safeIsoDate } from "@/lib/features/expenses/utils";
import { cn } from "@/lib/utils";

type PropertyOption = { id: string; label: string };
type UnitOption = { id: string; property_id: string | null; label: string };

export function ExpenseForm({
  mode,
  action,
  orgId,
  nextPath,
  editing,
  propertyOptions,
  unitOptions,
  locale,
  isEn,
  uploading,
  onUpload,
  onClose,
}: {
  mode: "create" | "edit";
  action: (formData: FormData) => void;
  orgId: string;
  nextPath: string;
  editing: ExpenseRow | null;
  propertyOptions: PropertyOption[];
  unitOptions: UnitOption[];
  locale: "es-PY" | "en-US";
  isEn: boolean;
  uploading: boolean;
  onUpload: (file: File | null, onSuccess: (url: string) => void) => void;
  onClose: () => void;
}) {
  const isEdit = mode === "edit";

  const [category, setCategory] = useState(
    isEdit ? asString(editing?.category).trim() || "other" : "supplies"
  );
  const [expenseDate, setExpenseDate] = useState(
    isEdit ? safeIsoDate(asString(editing?.expense_date).trim()) : ""
  );
  const [amount, setAmount] = useState(
    isEdit ? String(asNumber(editing?.amount)) : ""
  );
  const [currency, setCurrency] = useState(
    isEdit ? asString(editing?.currency).trim().toUpperCase() || "PYG" : "PYG"
  );
  const [fxRate, setFxRate] = useState(() => {
    if (!isEdit) return "";
    const fx = editing?.fx_rate_to_pyg;
    return typeof fx === "number" && fx > 0 ? String(fx) : "";
  });
  const [paymentMethod, setPaymentMethod] = useState(
    isEdit ? asString(editing?.payment_method).trim() || "cash" : "cash"
  );
  const [vendor, setVendor] = useState(
    isEdit ? asString(editing?.vendor_name).trim() : ""
  );
  const [reservationId, setReservationId] = useState(
    isEdit ? asString(editing?.reservation_id).trim() : ""
  );
  const [propertyId, setPropertyId] = useState(
    isEdit ? asString(editing?.property_id).trim() : ""
  );
  const [unitId, setUnitId] = useState(
    isEdit ? asString(editing?.unit_id).trim() : ""
  );
  const [invoiceNumber, setInvoiceNumber] = useState(
    isEdit ? asString(editing?.invoice_number).trim() : ""
  );
  const [invoiceRuc, setInvoiceRuc] = useState(
    isEdit ? asString(editing?.invoice_ruc).trim() : ""
  );
  const [receiptUrl, setReceiptUrl] = useState(
    isEdit ? asString(editing?.receipt_url).trim() : ""
  );
  const [notes, setNotes] = useState(
    isEdit ? asString(editing?.notes).trim() : ""
  );

  const reservationLocked = reservationId.trim().length > 0;

  return (
    <Form action={action} className="space-y-4">
      {isEdit && editing ? (
        <input name="expense_id" type="hidden" value={editing.id} />
      ) : (
        <input name="organization_id" type="hidden" value={orgId} />
      )}
      <input name="next" type="hidden" value={nextPath} />

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Category" : "Categoría"}
          </span>
          <Select
            name="category"
            onChange={(event) => setCategory(event.target.value)}
            value={category}
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
            onValueChange={setExpenseDate}
            value={expenseDate}
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
            onChange={(event) => setAmount(event.target.value)}
            placeholder={isEdit ? undefined : isEn ? "e.g. 95000" : "Ej. 95000"}
            required
            value={amount}
          />
        </label>

        <label className="block space-y-1">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Currency" : "Moneda"}
          </span>
          <Select
            name="currency"
            onChange={(event) => setCurrency(event.target.value)}
            value={currency}
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
            onChange={(event) => setPaymentMethod(event.target.value)}
            value={paymentMethod}
          >
            <option value="bank_transfer">bank_transfer</option>
            <option value="cash">cash</option>
            <option value="card">card</option>
            <option value="qr">qr</option>
            <option value="other">other</option>
          </Select>
        </label>
      </div>

      {currency === "USD" ? (
        <label className="block space-y-1">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "FX rate (USD → PYG)" : "Tipo de cambio (USD → PYG)"}
          </span>
          <Input
            inputMode="decimal"
            name="fx_rate_to_pyg"
            onChange={(event) => setFxRate(event.target.value)}
            placeholder={
              isEdit
                ? undefined
                : isEn
                  ? "Auto (leave blank)"
                  : "Auto (dejar vacío)"
            }
            value={fxRate}
          />
          {isEdit ? null : (
            <p className="text-muted-foreground text-xs">
              {isEn
                ? "If blank, the backend will auto-fetch a snapshot for the expense date. You can override manually."
                : "Si lo dejas vacío, el backend intentará obtener el tipo de cambio para la fecha. Puedes override manualmente."}
            </p>
          )}
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
            onChange={(event) => setVendor(event.target.value)}
            placeholder={
              isEdit
                ? undefined
                : isEn
                  ? "e.g. Supermarket"
                  : "Ej. Supermercado"
            }
            value={vendor}
          />
        </label>

        <label className="block space-y-1">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Reservation ID (optional)" : "ID de reserva (opcional)"}
          </span>
          <Input
            name="reservation_id"
            onChange={(event) => setReservationId(event.target.value)}
            placeholder={
              isEdit ? undefined : isEn ? "Paste UUID" : "Pega el UUID"
            }
            value={reservationId}
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
            onChange={(event) => setPropertyId(event.target.value)}
            value={propertyId}
          >
            <option value="">{isEn ? "No property" : "Sin propiedad"}</option>
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
            onChange={(event) => setUnitId(event.target.value)}
            value={unitId}
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
            onChange={(event) => setInvoiceNumber(event.target.value)}
            value={invoiceNumber}
          />
        </label>

        <label className="block space-y-1">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Invoice RUC (optional)" : "RUC (opcional)"}
          </span>
          <Input
            name="invoice_ruc"
            onChange={(event) => setInvoiceRuc(event.target.value)}
            value={invoiceRuc}
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
                onUpload(event.target.files?.[0] ?? null, setReceiptUrl)
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
            onChange={(event) => setReceiptUrl(event.target.value)}
            placeholder={isEn ? "https://..." : "https://..."}
            required
            value={receiptUrl}
          />
        </label>

        {receiptUrl.trim() ? (
          <a
            className="inline-flex items-center gap-2 text-primary text-sm underline-offset-4 hover:underline"
            href={receiptUrl.trim()}
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
          onChange={(event) => setNotes(event.target.value)}
          value={notes}
        />
      </label>

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} type="button" variant="outline">
          {isEn ? "Cancel" : "Cancelar"}
        </Button>
        <Button disabled={uploading} type="submit" variant="secondary">
          <Icon icon={isEdit ? PencilEdit01Icon : PlusSignIcon} size={16} />
          {isEdit ? (isEn ? "Save" : "Guardar") : isEn ? "Create" : "Crear"}
        </Button>
      </div>
    </Form>
  );
}
