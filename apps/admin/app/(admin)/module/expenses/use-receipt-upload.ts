"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useActiveLocale } from "@/lib/i18n/client";
import {
  safeStorageFileName,
  uploadPublicFileViaApi,
} from "@/lib/storage/public-upload";

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
      const safeName = safeStorageFileName(file.name);
      const key = `${orgId}/expenses/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
      const uploaded = await uploadPublicFileViaApi({
        namespace: "receipts",
        key,
        file,
        orgId,
      });
      const publicUrl = uploaded.publicUrl;
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
