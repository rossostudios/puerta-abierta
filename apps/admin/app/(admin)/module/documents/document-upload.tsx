"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type DocumentUploadProps = {
  orgId: string;
  isEn: boolean;
  onUploaded: (file: { url: string; name: string; mimeType: string; size: number }) => void;
};

export function DocumentUpload({ orgId, isEn, onUploaded }: DocumentUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file || !orgId) return;
      setUploading(true);
      try {
        const supabase = getSupabaseBrowserClient();
        const safeName = file.name.replaceAll(/[^\w.-]+/g, "-");
        const key = `${orgId}/documents/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(key, file, { upsert: false });
        if (uploadError) throw new Error(uploadError.message);
        const { data } = supabase.storage.from("documents").getPublicUrl(key);
        if (!data.publicUrl) throw new Error("Could not resolve public URL.");
        onUploaded({
          url: data.publicUrl,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
        });
        toast.success(isEn ? "File uploaded" : "Archivo subido");
      } catch (err) {
        toast.error(
          isEn ? "Upload failed" : "Fallo la subida",
          { description: err instanceof Error ? err.message : String(err) }
        );
      } finally {
        setUploading(false);
      }
    },
    [orgId, isEn, onUploaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
      e.target.value = "";
    },
    [uploadFile]
  );

  return (
    <div
      className={`flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-sm transition-colors ${
        dragOver
          ? "border-primary/50 bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50"
      }`}
      onClick={() => inputRef.current?.click()}
      onDragLeave={() => setDragOver(false)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDrop={handleDrop}
    >
      <p className="text-muted-foreground">
        {uploading
          ? isEn
            ? "Uploading..."
            : "Subiendo..."
          : isEn
            ? "Drag & drop a file or click to browse"
            : "Arrastra un archivo o haz clic para buscar"}
      </p>
      <input
        className="hidden"
        onChange={handleFileChange}
        ref={inputRef}
        type="file"
      />
    </div>
  );
}
