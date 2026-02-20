"use client";

import { Delete02Icon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { formatCurrency } from "@/lib/format";

import { asDateLabel, type GuestCrmRow } from "./guests-crm-types";

function ContactLine({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  let text: string;
  if (value != null) {
    text = value.trim();
  } else {
    text = "";
  }
  let displayText: string;
  if (text) {
    displayText = text;
  } else {
    displayText = "-";
  }
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-background/40 px-3 py-2">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="max-w-[70%] truncate text-right font-medium text-foreground text-sm">
        {displayText}
      </p>
    </div>
  );
}

export function GuestDetailView({
  record,
  locale,
  deleteArmed,
  onDeleteArm,
  onEditClick,
  deleteAction,
  t,
}: {
  record: GuestCrmRow;
  locale: string;
  deleteArmed: boolean;
  onDeleteArm: () => void;
  onEditClick: () => void;
  deleteAction: (formData: FormData) => void;
  t: (en: string, es: string) => string;
}) {
  const nextStayLabel = asDateLabel(locale, record.next_stay_start);
  const viewNextStayLabel = nextStayLabel != null ? nextStayLabel : "-";
  const lastStayLabel = asDateLabel(locale, record.last_stay_end);
  const viewLastStayLabel = lastStayLabel != null ? lastStayLabel : "-";

  let viewAddressValue: string | null = null;
  const addrPart = record.address != null ? record.address.trim() : "";
  const cityPart = record.city != null ? record.city.trim() : "";
  const joined = [addrPart, cityPart].filter(Boolean).join(", ");
  if (joined) {
    viewAddressValue = joined;
  }

  let showEmergencyContact = false;
  const ecName =
    record.emergency_contact_name != null
      ? record.emergency_contact_name.trim()
      : "";
  const ecPhone =
    record.emergency_contact_phone != null
      ? record.emergency_contact_phone.trim()
      : "";
  if (ecName || ecPhone) {
    showEmergencyContact = true;
  }

  let showIdDocument = false;
  const idUrl =
    record.id_document_url != null ? record.id_document_url.trim() : "";
  if (idUrl) {
    showIdDocument = true;
  }

  let hasNotes = false;
  const notesVal = record.notes != null ? record.notes.trim() : "";
  if (notesVal) {
    hasNotes = true;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-muted/10 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            {t("Reservations", "Reservas")}
          </p>
          <p className="mt-1 font-semibold text-xl tabular-nums">
            {record.reservation_count}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/10 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            {t("Lifetime value", "Valor de por vida")}
          </p>
          <p className="mt-1 font-semibold text-xl tabular-nums">
            {formatCurrency(record.lifetime_value, "PYG", locale)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/10 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            {t("Next stay", "Próxima estancia")}
          </p>
          <p className="mt-1 font-medium text-sm">{viewNextStayLabel}</p>
        </div>
        <div className="rounded-lg border bg-muted/10 p-3">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            {t("Last stay", "Última estancia")}
          </p>
          <p className="mt-1 font-medium text-sm">{viewLastStayLabel}</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="font-medium text-foreground text-sm">
          {t("Contact", "Contacto")}
        </p>
        <div className="grid gap-2">
          <ContactLine label={t("Email", "Correo")} value={record.email} />
          <ContactLine
            label={t("Phone", "Teléfono")}
            value={record.phone_e164}
          />
          <ContactLine
            label={t("Language", "Idioma")}
            value={record.preferred_language}
          />
          <ContactLine
            label={t("Document", "Documento")}
            value={(() => {
              const docType =
                record.document_type != null ? record.document_type : "";
              const docNum =
                record.document_number != null ? record.document_number : "";
              const joined = [docType.trim(), docNum.trim()]
                .filter(Boolean)
                .join(" ");
              return joined ? joined : null;
            })()}
          />
          <ContactLine
            label={t("Country", "País")}
            value={record.country_code}
          />
          <ContactLine
            label={t("Nationality", "Nacionalidad")}
            value={record.nationality}
          />
          <ContactLine
            label={t("Document expiry", "Vencimiento doc.")}
            value={record.document_expiry}
          />
          <ContactLine
            label={t("Date of birth", "Fecha de nacimiento")}
            value={record.date_of_birth}
          />
          <ContactLine
            label={t("Occupation", "Ocupación")}
            value={record.occupation}
          />
          <ContactLine
            label={t("Address", "Dirección")}
            value={viewAddressValue}
          />
        </div>
      </div>

      {showEmergencyContact && (
        <div className="space-y-2">
          <p className="font-medium text-foreground text-sm">
            {t("Emergency contact", "Contacto de emergencia")}
          </p>
          <div className="grid gap-2">
            <ContactLine
              label={t("Name", "Nombre")}
              value={record.emergency_contact_name}
            />
            <ContactLine
              label={t("Phone", "Teléfono")}
              value={record.emergency_contact_phone}
            />
          </div>
        </div>
      )}

      {showIdDocument && (
        <div className="space-y-2">
          <p className="font-medium text-foreground text-sm">
            {t("ID document", "Documento de identidad")}
          </p>
          <div className="relative h-40 w-full overflow-hidden rounded-lg border bg-muted/10">
            <Image
              alt={t("ID document", "Documento de identidad")}
              className="object-contain"
              fill
              sizes="(max-width: 640px) 100vw, 36rem"
              src={record.id_document_url || ""}
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="font-medium text-foreground text-sm">
          {t("Notes", "Notas")}
        </p>
        {hasNotes ? (
          <div className="rounded-md border bg-muted/10 p-3 text-foreground text-sm">
            <p className="whitespace-pre-wrap">{record.notes}</p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t(
              "No notes yet. Add preferences and details to personalize stays.",
              "Aún no hay notas. Agrega preferencias y detalles para personalizar estancias."
            )}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          className="gap-2"
          onClick={onEditClick}
          type="button"
          variant="secondary"
        >
          <Icon icon={PencilEdit01Icon} size={16} />
          {t("Edit guest", "Editar huésped")}
        </Button>

        <Form action={deleteAction}>
          <input name="id" type="hidden" value={record.id} />
          <input name="next" type="hidden" value="/module/guests" />
          {deleteArmed ? (
            <Button className="gap-2" type="submit" variant="destructive">
              <Icon icon={Delete02Icon} size={16} />
              {t("Confirm deletion", "Confirmar eliminación")}
            </Button>
          ) : (
            <Button
              className="gap-2"
              onClick={onDeleteArm}
              type="button"
              variant="outline"
            >
              <Icon icon={Delete02Icon} size={16} />
              {t("Delete", "Eliminar")}
            </Button>
          )}
        </Form>
      </div>
    </div>
  );
}
