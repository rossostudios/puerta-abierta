"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useActiveLocale } from "@/lib/i18n/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

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
      toast.error(isEn ? "Please choose an image file." : "Selecciona una imagen.");
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
    try {
      const supabase = getSupabaseBrowserClient();
      const key = `orgs/${org.id}/branding/logo/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(key, file, { upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const { data } = supabase.storage.from("documents").getPublicUrl(key);
      if (!data.publicUrl) {
        throw new Error(
          isEn
            ? "Could not resolve uploaded image URL."
            : "No se pudo obtener la URL de la imagen."
        );
      }
      setLogoUrl(data.publicUrl);
      toast.success(isEn ? "Logo uploaded" : "Logo subido");
    } catch (err) {
      toast.error(
        isEn ? "Logo upload failed" : "Error al subir logo",
        { description: err instanceof Error ? err.message : String(err) }
      );
    } finally {
      setUploadingLogo(false);
    }
  }

  function handleSave() {
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/organizations/${encodeURIComponent(org.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim() || undefined,
              legal_name: legalName.trim() || undefined,
              ruc: ruc.trim() || undefined,
              default_currency: currency || undefined,
              timezone: timezone || undefined,
              bank_name: bankName.trim() || undefined,
              bank_account_number: bankAccountNumber.trim() || undefined,
              bank_account_holder: bankAccountHolder.trim() || undefined,
              qr_image_url: qrImageUrl.trim() || undefined,
              logo_url: logoUrl.trim(),
            }),
          }
        );

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error || `Request failed (${response.status})`
          );
        }

        toast.success(isEn ? "Settings saved" : "Configuración guardada");
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : isEn
              ? "Save failed"
              : "Error al guardar"
        );
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
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Organization name" : "Nombre de organización"}
            </span>
            <Input
              onChange={(e) => setName(e.target.value)}
              required
              value={name}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Legal name" : "Razón social"}
            </span>
            <Input
              onChange={(e) => setLegalName(e.target.value)}
              value={legalName}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">RUC</span>
            <Input
              onChange={(e) => setRuc(e.target.value)}
              placeholder="80012345-6"
              value={ruc}
            />
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="font-semibold text-sm">
          {isEn ? "Branding" : "Marca"}
        </h3>
        <p className="text-muted-foreground text-xs">
          {isEn
            ? "Used across booking pages and organization selectors."
            : "Se usa en páginas de reserva y selectores de organización."}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border bg-muted/20">
            {logoUrl ? (
              <Image
                alt={isEn ? "Organization logo preview" : "Vista previa del logo de organización"}
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
              aria-label={isEn ? "Upload organization logo" : "Subir logo de organización"}
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
              aria-label={isEn ? "Remove organization logo" : "Quitar logo de organización"}
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

        <label className="block space-y-1 text-sm">
          <span className="font-medium text-muted-foreground">
            {isEn ? "Logo URL (fallback)" : "URL del logo (alternativa)"}
          </span>
          <Input
            autoComplete="url"
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
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Default currency" : "Moneda predeterminada"}
            </span>
            <Select
              onChange={(e) => setCurrency(e.target.value)}
              value={currency}
            >
              <option value="PYG">PYG (Guaraní)</option>
              <option value="USD">USD (Dólar)</option>
            </Select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Timezone" : "Zona horaria"}
            </span>
            <Select
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
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Bank name" : "Nombre del banco"}
            </span>
            <Input
              onChange={(e) => setBankName(e.target.value)}
              placeholder={isEn ? "e.g. Banco Itaú" : "Ej. Banco Itaú"}
              value={bankName}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Account number" : "Número de cuenta"}
            </span>
            <Input
              onChange={(e) => setBankAccountNumber(e.target.value)}
              value={bankAccountNumber}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Account holder" : "Titular de la cuenta"}
            </span>
            <Input
              onChange={(e) => setBankAccountHolder(e.target.value)}
              value={bankAccountHolder}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "QR image URL" : "URL de imagen QR"}
            </span>
            <Input
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
