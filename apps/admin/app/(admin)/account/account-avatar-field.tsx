"use client";

import { Camera02Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const WHITESPACE_REGEX = /\s+/;

function safeFileName(name: string): string {
  return name.replaceAll(/[^\w.-]+/g, "-");
}

function initials(value: string | null): string {
  if (!value) return "?";
  const normalized = value.includes("@") ? value.split("@")[0] : value;
  const words = normalized
    .trim()
    .split(WHITESPACE_REGEX)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  }
  return normalized.slice(0, 2).toUpperCase();
}

export function AccountAvatarField({
  currentName,
  initialAvatarUrl,
  isEn,
  userId,
}: {
  currentName: string;
  initialAvatarUrl: string;
  isEn: boolean;
  userId: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [uploading, setUploading] = useState(false);

  async function uploadFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error(isEn ? "Please choose an image file." : "Selecciona una imagen.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(
        isEn
          ? "Image must be smaller than 5MB."
          : "La imagen debe ser menor a 5MB."
      );
      return;
    }

    setUploading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const key = `profiles/${userId}/avatar/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(key, file, { upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const { data } = supabase.storage.from("documents").getPublicUrl(key);
      if (!data.publicUrl) {
        throw new Error(
          isEn ? "Could not resolve uploaded image URL." : "No se pudo obtener la URL de la imagen."
        );
      }
      setAvatarUrl(data.publicUrl);
      toast.success(isEn ? "Avatar uploaded" : "Avatar subido");
    } catch (err) {
      toast.error(
        isEn ? "Avatar upload failed" : "Error al subir avatar",
        { description: err instanceof Error ? err.message : String(err) }
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border bg-muted/40">
          {avatarUrl ? (
            <Image
              alt={isEn ? "Avatar preview" : "Vista previa del avatar"}
              className="h-full w-full object-cover"
              height={64}
              src={avatarUrl}
              unoptimized
              width={64}
            />
          ) : (
            <span className="font-semibold text-muted-foreground text-sm">
              {initials(currentName)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-label={isEn ? "Upload avatar image" : "Subir imagen de avatar"}
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
                ? "Upload image"
                : "Subir imagen"}
          </Button>
          <Button
            aria-label={isEn ? "Remove avatar image" : "Quitar imagen de avatar"}
            disabled={!avatarUrl || uploading}
            onClick={() => setAvatarUrl("")}
            size="sm"
            type="button"
            variant="outline"
          >
            <Icon icon={Delete02Icon} size={14} />
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
            uploadFile(file);
          }
          event.target.value = "";
        }}
        ref={inputRef}
        type="file"
      />

      <label className="block space-y-2" htmlFor="avatar_url">
        <span className="font-medium text-sm">
          {isEn ? "Avatar URL (fallback)" : "URL del avatar (alternativa)"}
        </span>
        <Input
          autoComplete="url"
          id="avatar_url"
          name="avatar_url"
          onChange={(event) => setAvatarUrl(event.target.value)}
          placeholder="https://..."
          value={avatarUrl}
        />
      </label>

      <p className="text-muted-foreground text-xs">
        {isEn
          ? "Accepted formats: image files up to 5MB."
          : "Formatos aceptados: imágenes de hasta 5MB."}
      </p>
    </div>
  );
}
