"use client";

import { Cancel01Icon, CloudUploadIcon } from "@hugeicons/core-free-icons";
import { useCallback, useRef, useState, type DragEvent } from "react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import { useListingImageUpload } from "./use-listing-image-upload";

type ImageUploadProps = {
  orgId: string;
  name: string;
  multiple?: boolean;
  labelEn: string;
  labelEs: string;
  isEn: boolean;
  defaultValue?: string | string[];
};

export function ImageUpload({
  orgId,
  name,
  multiple = false,
  labelEn,
  labelEs,
  isEn,
  defaultValue,
}: ImageUploadProps) {
  const { upload, uploading } = useListingImageUpload(orgId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const [urls, setUrls] = useState<string[]>(() => {
    if (!defaultValue) return [];
    return Array.isArray(defaultValue) ? defaultValue : [defaultValue];
  });

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const list = multiple ? Array.from(files) : [files[0]];
      for (const file of list) {
        if (!file) continue;
        upload(file, (publicUrl) => {
          setUrls((prev) =>
            multiple ? [...prev, publicUrl] : [publicUrl]
          );
        });
      }
    },
    [multiple, upload]
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const remove = (index: number) => {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const serialized = multiple ? JSON.stringify(urls) : urls[0] ?? "";

  return (
    <div className="space-y-2">
      <input name={name} type="hidden" value={serialized} />

      {/* Drop zone */}
      <div
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-sm transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
        )}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <Icon
          className="text-muted-foreground"
          icon={CloudUploadIcon}
          size={24}
        />
        <p className="text-muted-foreground">
          {uploading
            ? isEn
              ? "Uploading..."
              : "Subiendo..."
            : isEn
              ? "Click or drag to upload"
              : "Clic o arrastra para subir"}
        </p>
      </div>

      <input
        accept="image/*"
        className="hidden"
        multiple={multiple}
        onChange={(e) => handleFiles(e.target.files)}
        ref={inputRef}
        type="file"
      />

      {/* Thumbnails */}
      {urls.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {urls.map((url, index) => (
            <div className="group relative" key={url}>
              <img
                alt=""
                className="h-20 w-20 rounded-md border object-cover"
                src={url}
              />
              <button
                className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => remove(index)}
                type="button"
              >
                <Icon icon={Cancel01Icon} size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <p className="text-muted-foreground text-xs">
        {isEn ? labelEn : labelEs}
      </p>
    </div>
  );
}
