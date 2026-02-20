"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { markCollectionPaidAction } from "@/app/(admin)/module/collections/actions";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/lib/i18n";
import { useActiveLocale } from "@/lib/i18n/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

function useReceiptUpload(orgId: string) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const [uploading, setUploading] = useState(false);

  const upload = async (
    file: File | null,
    onSuccess: (publicUrl: string) => void
  ) => {
    if (!file) return;
    if (!orgId) return;
    setUploading(true);
    const errorLabel = isEn
      ? "Receipt upload failed"
      : "Fallo la subida del comprobante";
    try {
      const supabase = getSupabaseBrowserClient();
      const safeName = file.name.replaceAll(/[^\w.-]+/g, "-");
      const key = `${orgId}/collections/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(key, file, { upsert: false });
      if (uploadError) {
        toast.error(errorLabel, { description: uploadError.message });
        setUploading(false);
        return;
      }
      const { data } = supabase.storage.from("receipts").getPublicUrl(key);
      if (!data.publicUrl) {
        toast.error(errorLabel, {
          description: "Could not resolve public URL.",
        });
        setUploading(false);
        return;
      }
      onSuccess(data.publicUrl);
      let uploadedMsg: string;
      if (isEn) {
        uploadedMsg = "Receipt uploaded";
      } else {
        uploadedMsg = "Comprobante subido";
      }
      toast.success(uploadedMsg);
      setUploading(false);
    } catch (err) {
      let errDesc: string;
      if (err instanceof Error) {
        errDesc = err.message;
      } else {
        errDesc = String(err);
      }
      toast.error(errorLabel, { description: errDesc });
      setUploading(false);
    }
  };

  return { upload, uploading };
}

export function MarkPaidSheet({
  orgId,
  markPaidId,
  onClose,
  onSubmit,
  nextPath,
  isEn,
  locale,
  today,
}: {
  orgId: string;
  markPaidId: string | null;
  onClose: () => void;
  onSubmit: () => void;
  nextPath: string;
  isEn: boolean;
  locale: Locale;
  today: string;
}) {
  const [receiptUrl, setReceiptUrl] = useState("");
  const { upload, uploading } = useReceiptUpload(orgId);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);

  const handleReceiptFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      upload(file, (url) => setReceiptUrl(url));
    },
    [upload]
  );

  return (
    <Sheet
      contentClassName="max-w-md"
      description={
        isEn
          ? "Record payment details and attach a receipt."
          : "Registra los detalles de pago y adjunta un comprobante."
      }
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open={markPaidId !== null}
      title={isEn ? "Mark as paid" : "Marcar como pagado"}
    >
      <Form
        action={markCollectionPaidAction}
        className="space-y-4"
        onSubmit={() => {
          onSubmit();
          setReceiptUrl("");
        }}
      >
        <input name="collection_id" type="hidden" value={markPaidId ?? ""} />
        <input name="next" type="hidden" value={nextPath} />
        <input name="receipt_url" type="hidden" value={receiptUrl} />

        <label className="space-y-1 text-sm">
          <span>{isEn ? "Payment method" : "Metodo de pago"}</span>
          <Select defaultValue="bank_transfer" name="payment_method">
            <option value="bank_transfer">
              {isEn ? "Bank transfer" : "Transferencia bancaria"}
            </option>
            <option value="cash">{isEn ? "Cash" : "Efectivo"}</option>
            <option value="qr">QR</option>
            <option value="other">{isEn ? "Other" : "Otro"}</option>
          </Select>
        </label>

        <label className="space-y-1 text-sm">
          <span>{isEn ? "Payment reference" : "Referencia de pago"}</span>
          <Input
            name="payment_reference"
            placeholder={
              isEn
                ? "Transfer #, receipt code..."
                : "# transferencia, codigo..."
            }
          />
        </label>

        <label className="space-y-1 text-sm">
          <span>{isEn ? "Paid at" : "Fecha de pago"}</span>
          <DatePicker defaultValue={today} locale={locale} name="paid_at" />
        </label>

        <div className="space-y-1 text-sm">
          <span>{isEn ? "Receipt" : "Comprobante"}</span>
          <button
            className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-muted-foreground/25 border-dashed px-4 py-4 text-sm transition-colors hover:border-muted-foreground/50"
            onClick={() => receiptInputRef.current?.click()}
            type="button"
          >
            <p className="text-muted-foreground">
              {uploading
                ? isEn
                  ? "Uploading..."
                  : "Subiendo..."
                : receiptUrl
                  ? isEn
                    ? "Receipt attached"
                    : "Comprobante adjunto"
                  : isEn
                    ? "Click to upload receipt"
                    : "Clic para subir comprobante"}
            </p>
          </button>
          <input
            accept="image/*,.pdf"
            className="hidden"
            onChange={handleReceiptFile}
            ref={receiptInputRef}
            type="file"
          />
          {receiptUrl ? (
            <p className="truncate text-muted-foreground text-xs">
              {receiptUrl.split("/").pop()}
            </p>
          ) : null}
        </div>

        <label className="space-y-1 text-sm">
          <span>{isEn ? "Notes" : "Notas"}</span>
          <Textarea name="notes" rows={2} />
        </label>

        <div className="flex justify-end">
          <Button disabled={uploading} type="submit">
            {isEn ? "Confirm payment" : "Confirmar pago"}
          </Button>
        </div>
      </Form>
    </Sheet>
  );
}
