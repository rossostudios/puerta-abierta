import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MarketplaceApplyFormState } from "../hooks/use-marketplace-apply-form";

type MarketplaceApplyFieldsProps = {
  locale: "es-PY" | "en-US";
  isEn: boolean;
  form: MarketplaceApplyFormState;
  onFieldChange: <K extends keyof MarketplaceApplyFormState>(
    key: K,
    value: MarketplaceApplyFormState[K]
  ) => void;
};

export function MarketplaceApplyFields({
  locale,
  isEn,
  form,
  onFieldChange,
}: MarketplaceApplyFieldsProps) {
  return (
    <>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <label className="min-w-0 space-y-1 text-sm" htmlFor="full_name">
          <span>{isEn ? "Full name" : "Nombre completo"}</span>
          <Input
            id="full_name"
            name="full_name"
            onChange={(event) => onFieldChange("full_name", event.target.value)}
            required
            value={form.full_name}
          />
        </label>

        <label className="min-w-0 space-y-1 text-sm" htmlFor="email">
          <span>Email</span>
          <Input
            id="email"
            name="email"
            onChange={(event) => onFieldChange("email", event.target.value)}
            required
            type="email"
            value={form.email}
          />
        </label>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <label className="min-w-0 space-y-1 text-sm" htmlFor="phone_e164">
          <span>{isEn ? "Phone" : "Teléfono"}</span>
          <Input
            id="phone_e164"
            name="phone_e164"
            onChange={(event) => onFieldChange("phone_e164", event.target.value)}
            placeholder="+595..."
            value={form.phone_e164}
          />
        </label>

        <label className="min-w-0 space-y-1 text-sm" htmlFor="document_number">
          <span>{isEn ? "Document number" : "Número de documento"}</span>
          <Input
            id="document_number"
            name="document_number"
            onChange={(event) => onFieldChange("document_number", event.target.value)}
            value={form.document_number}
          />
        </label>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <label className="min-w-0 space-y-1 text-sm" htmlFor="preferred_move_in">
          <span>{isEn ? "Preferred move-in date" : "Fecha de ingreso preferida"}</span>
          <DatePicker
            id="preferred_move_in"
            locale={locale}
            onValueChange={(next) => onFieldChange("preferred_move_in", next)}
            value={form.preferred_move_in}
          />
        </label>

        <label className="min-w-0 space-y-1 text-sm" htmlFor="monthly_income">
          <span>{isEn ? "Monthly income" : "Ingreso mensual"}</span>
          <Input
            id="monthly_income"
            min={0}
            name="monthly_income"
            onChange={(event) => onFieldChange("monthly_income", event.target.value)}
            step="0.01"
            type="number"
            value={form.monthly_income}
          />
        </label>

        <label className="min-w-0 space-y-1 text-sm" htmlFor="guarantee_choice">
          <span>{isEn ? "Guarantee option" : "Opción de garantía"}</span>
          <select
            className="flex h-10 w-full min-w-0 rounded-xl border border-input bg-background/90 px-3 py-1.5 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
            id="guarantee_choice"
            name="guarantee_choice"
            onChange={(event) =>
              onFieldChange(
                "guarantee_choice",
                event.target.value as MarketplaceApplyFormState["guarantee_choice"]
              )
            }
            value={form.guarantee_choice}
          >
            <option value="cash_deposit">{isEn ? "Cash deposit" : "Depósito en efectivo"}</option>
            <option value="guarantor_product">
              {isEn ? "Guarantor product" : "Producto garante"}
            </option>
          </select>
        </label>
      </div>

      <label className="min-w-0 space-y-1 text-sm" htmlFor="message">
        <span>{isEn ? "Message" : "Mensaje"}</span>
        <Textarea
          id="message"
          name="message"
          onChange={(event) => onFieldChange("message", event.target.value)}
          placeholder={
            isEn
              ? "Tell us your preferred move-in date, profile, and questions."
              : "Cuéntanos fecha ideal de ingreso, perfil y consultas."
          }
          value={form.message}
        />
      </label>
    </>
  );
}
