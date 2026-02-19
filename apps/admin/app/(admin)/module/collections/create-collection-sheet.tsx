"use client";

import { createCollectionAction } from "@/app/(admin)/module/collections/actions";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/lib/i18n";

export function CreateCollectionSheet({
  orgId,
  open,
  onOpenChange,
  leaseOptions,
  nextPath,
  isEn,
  locale,
  today,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaseOptions: { id: string; label: string }[];
  nextPath: string;
  isEn: boolean;
  locale: Locale;
  today: string;
}) {
  return (
    <Sheet
      contentClassName="max-w-xl"
      description={
        isEn
          ? "Create a scheduled collection record linked to a lease."
          : "Crea un registro de cobro programado vinculado a un contrato."
      }
      onOpenChange={onOpenChange}
      open={open}
      title={isEn ? "New collection" : "Nuevo cobro"}
    >
      <Form action={createCollectionAction} className="space-y-4">
        <input name="organization_id" type="hidden" value={orgId} />
        <input name="next" type="hidden" value={nextPath} />

        <label className="space-y-1 text-sm">
          <span>{isEn ? "Lease" : "Contrato"}</span>
          <Select defaultValue="" name="lease_id" required>
            <option value="">
              {isEn ? "Select lease" : "Seleccionar contrato"}
            </option>
            {leaseOptions.map((lease) => (
              <option key={lease.id} value={lease.id}>
                {lease.label}
              </option>
            ))}
          </Select>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span>{isEn ? "Due date" : "Fecha de vencimiento"}</span>
            <DatePicker
              defaultValue={today}
              locale={locale}
              name="due_date"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Amount" : "Monto"}</span>
            <Input min={0} name="amount" required step="0.01" type="number" />
          </label>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Currency" : "Moneda"}</span>
            <Select defaultValue="PYG" name="currency">
              <option value="PYG">PYG</option>
              <option value="USD">USD</option>
            </Select>
          </label>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Status" : "Estado"}</span>
            <Select defaultValue="scheduled" name="status">
              <option value="scheduled">
                {isEn ? "Scheduled" : "Programado"}
              </option>
              <option value="pending">
                {isEn ? "Pending" : "Pendiente"}
              </option>
            </Select>
          </label>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Payment method" : "Metodo de pago"}</span>
            <Input
              defaultValue="bank_transfer"
              name="payment_method"
              placeholder="bank_transfer"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Reference" : "Referencia"}</span>
            <Input name="payment_reference" />
          </label>
        </div>

        <label className="space-y-1 text-sm">
          <span>{isEn ? "Notes" : "Notas"}</span>
          <Textarea name="notes" rows={3} />
        </label>

        <div className="flex justify-end">
          <Button type="submit">
            {isEn ? "Create collection" : "Crear cobro"}
          </Button>
        </div>
      </Form>
    </Sheet>
  );
}
