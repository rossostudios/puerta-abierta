"use client";

import {
  Add01Icon,
  Cancel01Icon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import Image from "next/image";
import { useCallback, useState } from "react";

import { DocumentUpload } from "@/app/(admin)/module/documents/document-upload";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useActiveLocale } from "@/lib/i18n/client";

import type { GuestCrmRow, SheetMode } from "./guests-crm-types";

const DOCUMENT_TYPE_OPTIONS = [
  { value: "", en: "Select...", es: "Seleccionar..." },
  { value: "passport", en: "Passport", es: "Pasaporte" },
  {
    value: "national_id",
    en: "National ID (Cédula)",
    es: "Cédula de Identidad",
  },
  {
    value: "drivers_license",
    en: "Driver's License",
    es: "Licencia de Conducir",
  },
  {
    value: "residence_permit",
    en: "Residence Permit",
    es: "Permiso de Residencia",
  },
  { value: "other", en: "Other", es: "Otro" },
] as const;

export const LANGUAGE_OPTIONS = [
  { value: "", en: "Select...", es: "Seleccionar..." },
  { value: "es", en: "Spanish", es: "Español" },
  { value: "en", en: "English", es: "Inglés" },
  { value: "pt", en: "Portuguese", es: "Portugués" },
  { value: "gn", en: "Guarani", es: "Guaraní" },
  { value: "de", en: "German", es: "Alemán" },
  { value: "fr", en: "French", es: "Francés" },
] as const;

export function GuestForm({
  mode,
  orgId,
  record,
  onCancel,
  createAction,
  updateAction,
}: {
  mode: SheetMode;
  orgId: string;
  record: GuestCrmRow | null;
  onCancel: () => void;
  createAction: (formData: FormData) => void;
  updateAction: (formData: FormData) => void;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const t = useCallback((en: string, es: string) => (isEn ? en : es), [isEn]);

  const isCreate = mode === "create";
  const action = isCreate ? createAction : updateAction;

  const [idDocumentUrl, setIdDocumentUrl] = useState(
    record?.id_document_url ?? ""
  );

  return (
    <Form action={action} className="grid gap-5">
      <input name="next" type="hidden" value="/module/guests" />
      <input name="id_document_url" type="hidden" value={idDocumentUrl} />
      {isCreate ? (
        <input name="organization_id" type="hidden" value={orgId} />
      ) : (
        <input name="id" type="hidden" value={record?.id ?? ""} />
      )}

      <fieldset className="grid gap-3">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {t("Identity", "Identidad")}
        </p>
        <div className="grid gap-1">
          <label className="font-medium text-xs" htmlFor="gcf-full-name">
            {t("Full name", "Nombre completo")}
          </label>
          <Input
            defaultValue={record?.full_name ?? ""}
            id="gcf-full-name"
            name="full_name"
            placeholder="Ana Perez"
            required
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-email">
              Email
            </label>
            <Input
              defaultValue={record?.email ?? ""}
              id="gcf-email"
              name="email"
              placeholder="ana@example.com"
              type="email"
            />
          </div>
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-phone">
              {t("Phone", "Teléfono")}
            </label>
            <Input
              defaultValue={record?.phone_e164 ?? ""}
              id="gcf-phone"
              name="phone_e164"
              placeholder="+595981000000"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {t("Document", "Documento")}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-doc-type">
              {t("Document type", "Tipo de documento")}
            </label>
            <Select
              defaultValue={record?.document_type ?? ""}
              id="gcf-doc-type"
              name="document_type"
            >
              {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {isEn ? opt.en : opt.es}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-doc-number">
              {t("Document number", "Número de documento")}
            </label>
            <Input
              defaultValue={record?.document_number ?? ""}
              id="gcf-doc-number"
              name="document_number"
              placeholder="123456789"
            />
          </div>
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-country">
              {t("Country", "País")}
            </label>
            <Input
              defaultValue={record?.country_code ?? ""}
              id="gcf-country"
              maxLength={2}
              name="country_code"
              placeholder="PY"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-doc-expiry">
              {t("Document expiry", "Vencimiento del documento")}
            </label>
            <Input
              defaultValue={record?.document_expiry ?? ""}
              id="gcf-doc-expiry"
              name="document_expiry"
              type="date"
            />
          </div>
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-nationality">
              {t("Nationality", "Nacionalidad")}
            </label>
            <Input
              defaultValue={record?.nationality ?? ""}
              id="gcf-nationality"
              maxLength={2}
              name="nationality"
              placeholder="PY"
            />
          </div>
        </div>

        <div className="grid gap-1">
          <label className="font-medium text-xs" htmlFor="gcf-id-doc-photo">
            {t("ID document photo", "Foto de documento de identidad")}
          </label>
          {idDocumentUrl ? (
            <div className="group relative h-36 w-full overflow-hidden rounded-lg border bg-muted/10">
              <Image
                alt={t("ID document", "Documento de identidad")}
                className="object-contain"
                fill
                sizes="(max-width: 640px) 100vw, 36rem"
                src={idDocumentUrl}
              />
              <button
                className="absolute top-2 right-2 rounded-full border bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => setIdDocumentUrl("")}
                type="button"
              >
                <Icon icon={Cancel01Icon} size={14} />
              </button>
            </div>
          ) : (
            <DocumentUpload
              isEn={isEn}
              onUploaded={(file) => setIdDocumentUrl(file.url)}
              orgId={orgId}
            />
          )}
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {t("Personal", "Personal")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-dob">
              {t("Date of birth", "Fecha de nacimiento")}
            </label>
            <Input
              defaultValue={record?.date_of_birth ?? ""}
              id="gcf-dob"
              name="date_of_birth"
              placeholder="1990-01-15"
              type="date"
            />
          </div>
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-occupation">
              {t("Occupation", "Ocupación")}
            </label>
            <Input
              defaultValue={record?.occupation ?? ""}
              id="gcf-occupation"
              name="occupation"
              placeholder={t("Engineer", "Ingeniero")}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-address">
              {t("Address", "Dirección")}
            </label>
            <Input
              defaultValue={record?.address ?? ""}
              id="gcf-address"
              name="address"
              placeholder={t("123 Main St", "Av. Mariscal López 123")}
            />
          </div>
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-city">
              {t("City", "Ciudad")}
            </label>
            <Input
              defaultValue={record?.city ?? ""}
              id="gcf-city"
              name="city"
              placeholder="Asunción"
            />
          </div>
        </div>
        <div className="grid gap-1">
          <label className="font-medium text-xs" htmlFor="gcf-language">
            {t("Preferred language", "Idioma preferido")}
          </label>
          <Select
            defaultValue={record?.preferred_language ?? "es"}
            id="gcf-language"
            name="preferred_language"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {isEn ? opt.en : opt.es}
              </option>
            ))}
          </Select>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {t("Emergency contact", "Contacto de emergencia")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-ec-name">
              {t("Contact name", "Nombre del contacto")}
            </label>
            <Input
              defaultValue={record?.emergency_contact_name ?? ""}
              id="gcf-ec-name"
              name="emergency_contact_name"
              placeholder="Juan Perez"
            />
          </div>
          <div className="grid gap-1">
            <label className="font-medium text-xs" htmlFor="gcf-ec-phone">
              {t("Contact phone", "Teléfono del contacto")}
            </label>
            <Input
              defaultValue={record?.emergency_contact_phone ?? ""}
              id="gcf-ec-phone"
              name="emergency_contact_phone"
              placeholder="+595981000000"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {t("Notes", "Notas")}
        </p>
        <div className="grid gap-1">
          <Textarea
            defaultValue={record?.notes ?? ""}
            name="notes"
            placeholder={t(
              "Preferences, special requests, document details...",
              "Preferencias, pedidos especiales, datos de documentos..."
            )}
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button onClick={onCancel} type="button" variant="ghost">
          {t("Cancel", "Cancelar")}
        </Button>
        <Button className="gap-2" type="submit" variant="secondary">
          <Icon icon={isCreate ? Add01Icon : PencilEdit01Icon} size={16} />
          {isCreate
            ? t("Create guest", "Crear huésped")
            : t("Save changes", "Guardar cambios")}
        </Button>
      </div>
    </Form>
  );
}
