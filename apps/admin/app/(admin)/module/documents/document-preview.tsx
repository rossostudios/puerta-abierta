"use client";

import Image from "next/image";

import { Sheet } from "@/components/ui/sheet";

type DocumentPreviewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  isEn: boolean;
};

function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

function isPdf(mime: string): boolean {
  return mime === "application/pdf" || mime.endsWith(".pdf");
}

export function DocumentPreview({
  open,
  onOpenChange,
  fileName,
  fileUrl,
  mimeType,
  isEn,
}: DocumentPreviewProps) {
  const mime = mimeType.toLowerCase();

  return (
    <Sheet
      contentClassName="max-w-2xl"
      description={fileUrl}
      onOpenChange={onOpenChange}
      open={open}
      title={fileName}
    >
      <div className="flex flex-col items-center gap-4">
        {isImage(mime) ? (
          <Image
            alt={fileName}
            className="max-h-[60vh] rounded-lg object-contain"
            height={600}
            src={fileUrl}
            unoptimized
            width={800}
          />
        ) : isPdf(mime) ? (
          <iframe
            className="h-[60vh] w-full rounded-lg border"
            src={fileUrl}
            title={fileName}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 py-10">
            <p className="text-muted-foreground text-sm">
              {isEn
                ? "Preview not available for this file type."
                : "Vista previa no disponible para este tipo de archivo."}
            </p>
            <a
              className="text-sm text-blue-600 hover:underline"
              href={fileUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {isEn ? "Open in new tab" : "Abrir en nueva pestaña"}
            </a>
          </div>
        )}
      </div>
    </Sheet>
  );
}
