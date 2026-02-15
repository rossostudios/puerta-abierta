"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useActiveLocale } from "@/lib/i18n/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function useReceiptUpload(orgId: string) {
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

      onSuccess(publicUrl);
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

  return { upload, uploading };
}
