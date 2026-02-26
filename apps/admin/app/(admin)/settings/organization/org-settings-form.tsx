"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useActiveLocale } from "@/lib/i18n/client";
import { uploadPublicFileViaApi } from "@/lib/storage/public-upload";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

function safeFileName(name: string): string {
  return name.replaceAll(/[^\w.-]+/g, "-");
}

type OrgRecord = {
  id: string;
  name: string;
  legal_name: string | null;
  ruc: string | null;
  default_currency: string;
  timezone: string;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  qr_image_url: string | null;
  logo_url: string | null;
};

export function OrgSettingsForm({ org }: { org: OrgRecord }) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(org.name);
  const [legalName, setLegalName] = useState(org.legal_name ?? "");
  const [ruc, setRuc] = useState(org.ruc ?? "");
  const [currency, setCurrency] = useState(org.default_currency);
  const [timezone, setTimezone] = useState(org.timezone);
  const [bankName, setBankName] = useState(org.bank_name ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(
    org.bank_account_number ?? ""
  );
  const [bankAccountHolder, setBankAccountHolder] = useState(
    org.bank_account_holder ?? ""
  );
  const [qrImageUrl, setQrImageUrl] = useState(org.qr_image_url ?? "");
  const [logoUrl, setLogoUrl] = useState(org.logo_url ?? "");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadLogo(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error(
        isEn ? "Please choose an image file." : "Selecciona una imagen."
      );
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(
        isEn
          ? "Image must be smaller than 5MB."
          : "La imagen debe ser menor a 5MB."
      );
      return;
    }

    setUploadingLogo(true);
    const errorLabel = isEn ? "Logo upload failed" : "Error al subir logo";
    const noUrlMsg = isEn
      ? "Could not resolve uploaded image URL."
      : "No se pudo obtener la URL de la imagen.";
    try {
      const key = `orgs/${org.id}/branding/logo/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const uploaded = await uploadPublicFileViaApi({
        namespace: "documents",
        key,
        file,
        orgId: org.id,
      });
      if (!uploaded.publicUrl) {
        toast.error(errorLabel, { description: noUrlMsg });
        setUploadingLogo(false);
        return;
      }
      setLogoUrl(uploaded.publicUrl);
      let uploadedMsg: string;
      if (isEn) {
        uploadedMsg = "Logo uploaded";
      } else {
        uploadedMsg = "Logo subido";
      }
      toast.success(uploadedMsg);
      setUploadingLogo(false);
    } catch (err) {
      let errDesc: string;
      if (err instanceof Error) {
        errDesc = err.message;
      } else {
        errDesc = String(err);
      }
      toast.error(errorLabel, { description: errDesc });
      setUploadingLogo(false);
    }
  }

  function handleSave() {
    const nameVal = name.trim() ? name.trim() : undefined;
    const legalNameVal = legalName.trim() ? legalName.trim() : undefined;
    const rucVal = ruc.trim() ? ruc.trim() : undefined;
    const currencyVal = currency ? currency : undefined;
    const timezoneVal = timezone ? timezone : undefined;
    const bankNameVal = bankName.trim() ? bankName.trim() : undefined;
    const bankAccountNumberVal = bankAccountNumber.trim()
      ? bankAccountNumber.trim()
      : undefined;
    const bankAccountHolderVal = bankAccountHolder.trim()
      ? bankAccountHolder.trim()
      : undefined;
    const qrImageUrlVal = qrImageUrl.trim() ? qrImageUrl.trim() : undefined;

    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/organizations/${encodeURIComponent(org.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: nameVal,
              legal_name: legalNameVal,
              ruc: rucVal,
              default_currency: currencyVal,
              timezone: timezoneVal,
              bank_name: bankNameVal,
              bank_account_number: bankAccountNumberVal,
              bank_account_holder: bankAccountHolderVal,
              qr_image_url: qrImageUrlVal,
              logo_url: logoUrl.trim(),
            }),
          }
        );

        if (!response.ok) {
          let rawData: Record<string, unknown>;
          try {
            rawData = await response.json();
          } catch {
            rawData = {};
          }
          const data = rawData as { error?: string };
          let errMsg: string;
          if (data.error) {
            errMsg = data.error;
          } else {
            errMsg = `Request failed (${response.status})`;
          }
          toast.error(errMsg);
          return;
        }

        let savedMsg: string;
        if (isEn) {
          savedMsg = "Settings saved";
        } else {
          savedMsg = "Configuración guardada";
        }
        toast.success(savedMsg);
      } catch (err) {
        let fallback: string;
        if (isEn) {
          fallback = "Save failed";
        } else {
          fallback = "Error al guardar";
        }
        let msg: string;
        if (err instanceof Error) {
          msg = err.message;
        } else {
          msg = fallback;
        }
        toast.error(msg);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="font-semibold text-sm">
          {isEn ? "General" : "General"}
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <label
            className="block space-y-1 text-sm"
            htmlFor="org-settings-name"
          >
            <span className="font-medium text-muted-foreground">
              {isEn ? "Organization name" : "Nombre de organización"}
            </span>
            <Input
              id="org-settings-name"
              onChange={(e) => setName(e.target.value)}
              required
              value={name}
            />
          </label>
          <label
            className="block space-y-1 text-sm"
            htmlFor="org-settings-legal-name"
          >
            <span className="font-medium text-muted-foreground">
              {isEn ? "Legal name" : "Razón social"}
            </span>
            <Input
              id="org-settings-legal-name"
              onChange={(e) => setLegalName(e.target.value)}
              value={legalName}
            />
          </label>
          <label className="block space-y-1 text-sm" htmlFor="org-settings-ruc">
            <span className="font-medium text-muted-foreground">RUC</span>
            <Input
              id="org-settings-ruc"
              onChange={(e) => setRuc(e.target.value)}
              placeholder="80012345-6"
              value={ruc}
            />
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="font-semibold text-sm">{isEn ? "Branding" : "Marca"}</h3>
        <p className="text-muted-foreground text-xs">
          {isEn
            ? "Used across booking pages and organization selectors."
            : "Se usa en páginas de reserva y selectores de organización."}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border bg-muted/20">
            {logoUrl ? (
              <Image
                alt={
                  isEn
                    ? "Organization logo preview"
                    : "Vista previa del logo de organización"
                }
                className="h-full w-full object-cover"
                height={56}
                src={logoUrl}
                unoptimized
                width={56}
              />
            ) : (
              <span className="font-semibold text-muted-foreground text-xs">
                {isEn ? "No logo" : "Sin logo"}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-label={
                isEn ? "Upload organization logo" : "Subir logo de organización"
              }
              disabled={uploadingLogo}
              onClick={() => logoInputRef.current?.click()}
              size="sm"
              type="button"
              variant="outline"
            >
              {uploadingLogo
                ? isEn
                  ? "Uploading..."
                  : "Subiendo..."
                : isEn
                  ? "Upload logo"
                  : "Subir logo"}
            </Button>
            <Button
              aria-label={
                isEn
                  ? "Remove organization logo"
                  : "Quitar logo de organización"
              }
              disabled={!logoUrl || uploadingLogo}
              onClick={() => setLogoUrl("")}
              size="sm"
              type="button"
              variant="outline"
            >
              {isEn ? "Remove" : "Quitar"}
            </Button>
          </div>
        </div>

        <input
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              uploadLogo(file);
            }
            event.target.value = "";
          }}
          ref={logoInputRef}
          type="file"
        />

        <label
          className="block space-y-1 text-sm"
          htmlFor="org-settings-logo-url"
        >
          <span className="font-medium text-muted-foreground">
            {isEn ? "Logo URL (fallback)" : "URL del logo (alternativa)"}
          </span>
          <Input
            autoComplete="url"
            id="org-settings-logo-url"
            onChange={(event) => setLogoUrl(event.target.value)}
            placeholder="https://..."
            value={logoUrl}
          />
        </label>
      </section>

      <section className="space-y-4">
        <h3 className="font-semibold text-sm">
          {isEn ? "Regional" : "Regional"}
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <label
            className="block space-y-1 text-sm"
            htmlFor="org-settings-currency"
          >
            <span className="font-medium text-muted-foreground">
              {isEn ? "Default currency" : "Moneda predeterminada"}
            </span>
            <Select
              id="org-settings-currency"
              onChange={(e) => setCurrency(e.target.value)}
              value={currency}
            >
              <option value="PYG">PYG (Guaraní)</option>
              <option value="USD">USD (Dólar)</option>
            </Select>
          </label>
          <label
            className="block space-y-1 text-sm"
            htmlFor="org-settings-timezone"
          >
            <span className="font-medium text-muted-foreground">
              {isEn ? "Timezone" : "Zona horaria"}
            </span>
            <Select
              id="org-settings-timezone"
              onChange={(e) => setTimezone(e.target.value)}
              value={timezone}
            >
              <option value="America/Asuncion">America/Asuncion</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Chicago">America/Chicago</option>
              <option value="America/Denver">America/Denver</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
              <option value="America/Sao_Paulo">America/Sao_Paulo</option>
              <option value="America/Buenos_Aires">America/Buenos_Aires</option>
              <option value="Europe/Madrid">Europe/Madrid</option>
              <option value="UTC">UTC</option>
            </Select>
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="font-semibold text-sm">
          {isEn ? "Banking details" : "Datos bancarios"}
        </h3>
        <p className="text-muted-foreground text-xs">
          {isEn
            ? "Used for payment instructions and owner statements."
            : "Utilizados para instrucciones de pago y estados del propietario."}
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <label
            className="block space-y-1 text-sm"
            htmlFor="org-settings-bank-name"
          >
            <span className="font-medium text-muted-foreground">
              {isEn ? "Bank name" : "Nombre del banco"}
            </span>
            <Input
              id="org-settings-bank-name"
              onChange={(e) => setBankName(e.target.value)}
              placeholder={isEn ? "e.g. Banco Itaú" : "Ej. Banco Itaú"}
              value={bankName}
            />
          </label>
          <label
            className="block space-y-1 text-sm"
            htmlFor="org-settings-bank-account"
          >
            <span className="font-medium text-muted-foreground">
              {isEn ? "Account number" : "Número de cuenta"}
            </span>
            <Input
              id="org-settings-bank-account"
              onChange={(e) => setBankAccountNumber(e.target.value)}
              value={bankAccountNumber}
            />
          </label>
          <label
            className="block space-y-1 text-sm"
            htmlFor="org-settings-bank-holder"
          >
            <span className="font-medium text-muted-foreground">
              {isEn ? "Account holder" : "Titular de la cuenta"}
            </span>
            <Input
              id="org-settings-bank-holder"
              onChange={(e) => setBankAccountHolder(e.target.value)}
              value={bankAccountHolder}
            />
          </label>
          <label
            className="block space-y-1 text-sm"
            htmlFor="org-settings-qr-url"
          >
            <span className="font-medium text-muted-foreground">
              {isEn ? "QR image URL" : "URL de imagen QR"}
            </span>
            <Input
              id="org-settings-qr-url"
              onChange={(e) => setQrImageUrl(e.target.value)}
              placeholder="https://..."
              value={qrImageUrl}
            />
          </label>
        </div>
      </section>

      <div className="flex justify-end">
        <Button disabled={isPending} onClick={handleSave} variant="secondary">
          {isPending
            ? isEn
              ? "Saving..."
              : "Guardando..."
            : isEn
              ? "Save settings"
              : "Guardar configuración"}
        </Button>
      </div>
    </div>
  );
}
