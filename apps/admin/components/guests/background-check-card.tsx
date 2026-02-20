"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { DocumentUpload } from "@/app/(admin)/module/documents/document-upload";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { authedFetch } from "@/lib/api-client";
import { useActiveLocale } from "@/lib/i18n/client";

type BackgroundCheckCardProps = {
  guestId: string;
  orgId: string;
  backgroundCheckStatus: string | null;
  backgroundCheckDate: string | null;
  backgroundCheckNotes: string | null;
  backgroundCheckReportUrl: string | null;
};

type StatusTone = "info" | "warning" | "success" | "danger" | "neutral";

function bgStatusTone(status: string | null): StatusTone {
  switch (status) {
    case "requested":
      return "warning";
    case "cleared":
      return "success";
    case "failed":
      return "danger";
    case "expired":
      return "warning";
    default:
      return "neutral";
  }
}

export function BackgroundCheckCard({
  guestId,
  orgId,
  backgroundCheckStatus,
  backgroundCheckDate,
  backgroundCheckNotes,
  backgroundCheckReportUrl,
}: BackgroundCheckCardProps) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState(backgroundCheckNotes ?? "");
  const [reportUrl, setReportUrl] = useState(backgroundCheckReportUrl ?? "");

  const status = backgroundCheckStatus ?? "not_requested";

  function updateStatus(newStatus: string, extra?: Record<string, string>) {
    const successMsg = isEn
      ? "Background check updated"
      : "Verificación de antecedentes actualizada";
    const fallbackErrMsg = isEn ? "Update failed" : "Error al actualizar";
    const trimmedNotes = notes.trim();
    const trimmedReportUrl = reportUrl.trim();
    const body = JSON.stringify({
      background_check_status: newStatus,
      background_check_date: new Date().toISOString().slice(0, 10),
      ...(trimmedNotes ? { background_check_notes: trimmedNotes } : {}),
      ...(trimmedReportUrl
        ? { background_check_report_url: trimmedReportUrl }
        : {}),
      ...extra,
    });

    startTransition(async () => {
      try {
        await authedFetch(`/guests/${guestId}/background-check`, {
          method: "PATCH",
          body,
        });
        toast.success(successMsg);
        router.refresh();
      } catch (err) {
        let msg = fallbackErrMsg;
        if (err instanceof Error) {
          msg = err.message;
        }
        toast.error(msg);
      }
    });
  }

  const statusLabel =
    status === "not_requested"
      ? isEn
        ? "Not requested"
        : "No solicitado"
      : status;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>
              {isEn ? "Background Check" : "Verificación de Antecedentes"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Request and track background check status."
                : "Solicita y rastrea el estado de verificación de antecedentes."}
            </CardDescription>
          </div>
          <StatusBadge tone={bgStatusTone(status)} value={statusLabel} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "not_requested" && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              {isEn
                ? "No background check has been requested for this guest."
                : "No se ha solicitado verificación de antecedentes para este huésped."}
            </p>
            <Button
              disabled={isPending}
              onClick={() => updateStatus("requested")}
              size="sm"
              variant="secondary"
            >
              {isEn ? "Request check" : "Solicitar verificación"}
            </Button>
          </div>
        )}

        {status === "requested" && (
          <div className="space-y-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950/30">
            <p className="font-medium text-sm">
              {isEn
                ? "Check requested — upload report and resolve"
                : "Verificación solicitada — carga el reporte y resuelve"}
            </p>

            {!reportUrl && (
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">
                  {isEn ? "Upload report" : "Cargar reporte"}
                </p>
                <DocumentUpload
                  isEn={isEn}
                  onUploaded={(file) => setReportUrl(file.url)}
                  orgId={orgId}
                />
              </div>
            )}

            {reportUrl && (
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">
                  {isEn ? "Report uploaded" : "Reporte cargado"}
                </p>
                <a
                  className="block overflow-hidden rounded-lg border hover:opacity-80"
                  href={reportUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Image
                    alt={
                      isEn
                        ? "Background check report"
                        : "Reporte de antecedentes"
                    }
                    className="h-32 w-full object-cover"
                    height={256}
                    sizes="(max-width: 768px) 100vw, 50vw"
                    src={reportUrl}
                    width={512}
                  />
                </a>
              </div>
            )}

            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">
                {isEn ? "Notes (optional)" : "Notas (opcional)"}
              </span>
              <Textarea
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  isEn
                    ? "Findings, reference numbers..."
                    : "Hallazgos, números de referencia..."
                }
                rows={2}
                value={notes}
              />
            </label>

            <div className="flex gap-2">
              <Button
                disabled={isPending}
                onClick={() => updateStatus("cleared")}
                size="sm"
                variant="default"
              >
                {isEn ? "Mark cleared" : "Marcar aprobado"}
              </Button>
              <Button
                disabled={isPending}
                onClick={() => updateStatus("failed")}
                size="sm"
                variant="destructive"
              >
                {isEn ? "Mark failed" : "Marcar rechazado"}
              </Button>
            </div>
          </div>
        )}

        {status === "cleared" && (
          <div className="space-y-3">
            {backgroundCheckDate && (
              <p className="text-muted-foreground text-sm">
                {isEn ? "Cleared on" : "Aprobado el"}{" "}
                {new Date(backgroundCheckDate).toLocaleDateString(locale, {
                  dateStyle: "medium",
                })}
              </p>
            )}
            {reportUrl && (
              <a
                className="block overflow-hidden rounded-lg border hover:opacity-80"
                href={reportUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Image
                  alt={
                    isEn ? "Background check report" : "Reporte de antecedentes"
                  }
                  className="h-32 w-full object-cover"
                  height={256}
                  sizes="(max-width: 768px) 100vw, 50vw"
                  src={reportUrl}
                  width={512}
                />
              </a>
            )}
            {(backgroundCheckNotes ?? "").trim() && (
              <div className="rounded-md border bg-muted/10 p-3 text-sm">
                <p className="whitespace-pre-wrap">{backgroundCheckNotes}</p>
              </div>
            )}
          </div>
        )}

        {status === "failed" && (
          <div className="space-y-3">
            <p className="text-red-600 text-sm">
              {isEn
                ? "Background check failed."
                : "La verificación de antecedentes falló."}
            </p>
            {(backgroundCheckNotes ?? "").trim() && (
              <div className="rounded-md border bg-muted/10 p-3 text-sm">
                <p className="whitespace-pre-wrap">{backgroundCheckNotes}</p>
              </div>
            )}
          </div>
        )}

        {status === "expired" && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              {isEn
                ? "The previous background check has expired."
                : "La verificación de antecedentes anterior ha expirado."}
            </p>
            <Button
              disabled={isPending}
              onClick={() => updateStatus("requested")}
              size="sm"
              variant="secondary"
            >
              {isEn ? "Request again" : "Solicitar de nuevo"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
