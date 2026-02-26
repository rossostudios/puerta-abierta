"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useActiveLocale } from "@/lib/i18n/client";
import {
  safeStorageFileName,
  uploadPublicFileViaApi,
} from "@/lib/storage/public-upload";

export function useListingImageUpload(orgId: string) {
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
      const key = `${orgId}/listings/${crypto.randomUUID()}-${safeName}`;
      const uploaded = await uploadPublicFileViaApi({
        namespace: "listings",
        key,
        file,
        orgId,
      });
      const publicUrl = uploaded.publicUrl;
      if (!publicUrl)
        throw new Error("Could not resolve a public URL for the upload.");

      onSuccess(publicUrl);
      toast.success(isEn ? "Image uploaded" : "Imagen subida", {
        description: safeName,
      });
    } catch (err) {
      toast.error(isEn ? "Image upload failed" : "Falló la subida de imagen", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading };
}
