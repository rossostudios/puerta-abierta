"use client";

import { Camera02Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useActiveLocale } from "@/lib/i18n/client";

type TaskPhotoUploadProps = {
  taskId: string;
  itemId: string;
  photoUrls: string[];
  orgId: string;
};

export function TaskPhotoUpload({
  taskId,
  itemId,
  photoUrls,
  orgId,
}: TaskPhotoUploadProps) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [urls, setUrls] = useState<string[]>(photoUrls);
  const [isPending, startTransition] = useTransition();

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const safeName = file.name.replaceAll(/[^\w.-]+/g, "-");
      const key = `${orgId}/task-photos/${taskId}/${itemId}/${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage
        .from("receipts")
        .upload(key, file, { upsert: false });
      if (error) throw new Error(error.message);

      const { data } = supabase.storage.from("receipts").getPublicUrl(key);
      const newUrls = [...urls, data.publicUrl];

      await patchItem(newUrls);
      setUrls(newUrls);
      toast.success(isEn ? "Photo uploaded" : "Foto subida");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : isEn
            ? "Upload failed"
            : "Error al subir"
      );
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(index: number) {
    startTransition(async () => {
      const newUrls = urls.filter((_, i) => i !== index);
      try {
        await patchItem(newUrls);
        setUrls(newUrls);
        toast.success(isEn ? "Photo removed" : "Foto eliminada");
      } catch {
        toast.error(
          isEn ? "Failed to remove photo" : "Error al eliminar foto"
        );
      }
    });
  }

  async function patchItem(newPhotoUrls: string[]) {
    const response = await fetch(
      `/api/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_urls: newPhotoUrls }),
      }
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(data.error || `Request failed (${response.status})`);
    }
  }

  return (
    <div className="space-y-2">
      {urls.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {urls.map((url, index) => (
            <div className="group relative" key={url}>
              <a
                className="block overflow-hidden rounded-md border"
                href={url}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Image
                  alt={`${isEn ? "Photo" : "Foto"} ${index + 1}`}
                  className="h-16 w-16 object-cover"
                  height={128}
                  sizes="64px"
                  src={url}
                  width={128}
                />
              </a>
              <button
                className="absolute -top-1.5 -right-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow group-hover:flex"
                disabled={isPending}
                onClick={() => removePhoto(index)}
                type="button"
              >
                <Icon icon={Delete02Icon} size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div>
        <input
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadFile(file);
            e.target.value = "";
          }}
          ref={inputRef}
          type="file"
        />
        <Button
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
          variant="outline"
        >
          <Icon icon={Camera02Icon} size={14} />
          {uploading
            ? isEn
              ? "Uploading..."
              : "Subiendo..."
            : isEn
              ? "Add photo"
              : "Agregar foto"}
        </Button>
      </div>
    </div>
  );
}
