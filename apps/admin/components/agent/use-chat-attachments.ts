"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export type ChatAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
  uploadedUrl: string | null;
  status: "pending" | "uploading" | "done" | "error";
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
];

export function useChatAttachments(orgId: string, isEn: boolean) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const abortControllers = useRef(new Map<string, AbortController>());

  const uploadFile = useCallback(
    async (attachment: ChatAttachment) => {
      const supabase = getSupabaseBrowserClient();
      const safeName = attachment.file.name.replaceAll(/[^\w.-]+/g, "-");
      const key = `${orgId}/chat-attachments/${crypto.randomUUID()}-${safeName}`;

      setAttachments((prev) =>
        prev.map((a) =>
          a.id === attachment.id ? { ...a, status: "uploading" as const } : a
        )
      );

      try {
        const { error: uploadError } = await supabase.storage
          .from("listings")
          .upload(key, attachment.file, { upsert: false });

        if (uploadError) throw new Error(uploadError.message);

        const { data } = supabase.storage.from("listings").getPublicUrl(key);
        const publicUrl = data.publicUrl;
        if (!publicUrl) throw new Error("Could not resolve public URL.");

        setAttachments((prev) =>
          prev.map((a) =>
            a.id === attachment.id
              ? { ...a, status: "done" as const, uploadedUrl: publicUrl }
              : a
          )
        );
      } catch (err) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === attachment.id ? { ...a, status: "error" as const } : a
          )
        );
        toast.error(isEn ? "Upload failed" : "Falló la subida", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [orgId, isEn]
  );

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      const newAttachments: ChatAttachment[] = [];

      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(isEn ? "File too large" : "Archivo muy grande", {
            description: `${file.name} > 10MB`,
          });
          continue;
        }
        if (
          !(
            ACCEPTED_TYPES.includes(file.type) || file.type.startsWith("image/")
          )
        ) {
          toast.error(
            isEn ? "Unsupported file type" : "Tipo de archivo no soportado",
            {
              description: file.name,
            }
          );
          continue;
        }
        const id = crypto.randomUUID();
        const previewUrl = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null;
        newAttachments.push({
          id,
          file,
          previewUrl,
          uploadedUrl: null,
          status: "pending",
        });
      }

      if (newAttachments.length === 0) return;
      setAttachments((prev) => [...prev, ...newAttachments]);

      // Start uploads
      for (const att of newAttachments) {
        uploadFile(att);
      }
    },
    [isEn, uploadFile]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
    const controller = abortControllers.current.get(id);
    if (controller) {
      controller.abort();
      abortControllers.current.delete(id);
    }
  }, []);

  const getReadyUrls = useCallback((): string[] => {
    return attachments
      .filter(
        (a): a is ChatAttachment & { uploadedUrl: string } =>
          a.status === "done" && typeof a.uploadedUrl === "string"
      )
      .map((a) => a.uploadedUrl);
  }, [attachments]);

  const clearAttachments = useCallback(() => {
    for (const att of attachments) {
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
    }
    setAttachments([]);
  }, [attachments]);

  const allReady =
    attachments.length === 0 ||
    attachments.every((a) => a.status === "done" || a.status === "error");
  const hasAttachments = attachments.length > 0;

  return {
    attachments,
    addFiles,
    removeAttachment,
    getReadyUrls,
    clearAttachments,
    allReady,
    hasAttachments,
  };
}
