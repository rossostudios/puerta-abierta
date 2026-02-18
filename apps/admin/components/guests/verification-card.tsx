"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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
import { useActiveLocale } from "@/lib/i18n/client";

type VerificationCardProps = {
  guestId: string;
  verificationStatus: string | null;
  idDocumentUrl: string | null;
  selfieUrl: string | null;
  verifiedAt: string | null;
  onStatusChange?: () => void;
};

function statusTone(
  status: string | null
): "info" | "warning" | "success" | "danger" | "neutral" {
  switch (status) {
    case "pending":
      return "warning";
    case "verified":
      return "success";
    case "rejected":
      return "danger";
    default:
      return "neutral";
  }
}

export function VerificationCard({
  guestId,
  verificationStatus,
  idDocumentUrl,
  selfieUrl,
  verifiedAt,
  onStatusChange,
}: VerificationCardProps) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState("");

  async function handleReview(decision: "verified" | "rejected") {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/guests/${guestId}/verification`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verification_status: decision,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error || `Request failed (${response.status})`
          );
        }

        toast.success(
          decision === "verified"
            ? isEn
              ? "Guest verified"
              : "Huésped verificado"
            : isEn
              ? "Verification rejected"
              : "Verificación rechazada"
        );
        onStatusChange?.();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : isEn
              ? "Review failed"
              : "Error en la revisión"
        );
      }
    });
  }

  const hasDocuments = Boolean(idDocumentUrl);
  const isPendingReview = verificationStatus === "pending";
  const isVerified = verificationStatus === "verified";
  const isRejected = verificationStatus === "rejected";
  const noVerification = !verificationStatus;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>
              {isEn ? "ID Verification" : "Verificación de Identidad"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Review submitted identity documents."
                : "Revisa documentos de identidad enviados."}
            </CardDescription>
          </div>
          {verificationStatus ? (
            <StatusBadge
              value={verificationStatus}
              tone={statusTone(verificationStatus)}
            />
          ) : (
            <StatusBadge
              value={isEn ? "not submitted" : "no enviado"}
              tone="neutral"
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {noVerification ? (
          <p className="text-muted-foreground text-sm">
            {isEn
              ? "No verification documents have been submitted yet."
              : "Aún no se han enviado documentos de verificación."}
          </p>
        ) : null}

        {hasDocuments ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="font-medium text-sm">
                {isEn ? "ID Document" : "Documento de Identidad"}
              </p>
              <a
                className="block overflow-hidden rounded-lg border hover:opacity-80"
                href={idDocumentUrl!}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Image
                  alt={isEn ? "ID document" : "Documento de identidad"}
                  className="h-48 w-full object-cover"
                  height={384}
                  sizes="(max-width: 768px) 100vw, 50vw"
                  src={idDocumentUrl!}
                  width={512}
                />
              </a>
            </div>
            {selfieUrl ? (
              <div className="space-y-2">
                <p className="font-medium text-sm">Selfie</p>
                <a
                  className="block overflow-hidden rounded-lg border hover:opacity-80"
                  href={selfieUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Image
                    alt="Selfie"
                    className="h-48 w-full object-cover"
                    height={384}
                    sizes="(max-width: 768px) 100vw, 50vw"
                    src={selfieUrl}
                    width={512}
                  />
                </a>
              </div>
            ) : null}
          </div>
        ) : null}

        {isVerified && verifiedAt ? (
          <p className="text-muted-foreground text-sm">
            {isEn ? "Verified on" : "Verificado el"}{" "}
            {new Date(verifiedAt).toLocaleDateString(locale, {
              dateStyle: "medium",
            })}
          </p>
        ) : null}

        {isPendingReview ? (
          <div className="space-y-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950/30">
            <p className="font-medium text-sm">
              {isEn ? "Review required" : "Revisión requerida"}
            </p>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">
                {isEn ? "Notes (optional)" : "Notas (opcional)"}
              </span>
              <Textarea
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  isEn
                    ? "Reason for approval or rejection..."
                    : "Razón de aprobación o rechazo..."
                }
                rows={2}
                value={notes}
              />
            </label>
            <div className="flex gap-2">
              <Button
                disabled={isPending}
                onClick={() => handleReview("verified")}
                size="sm"
                variant="default"
              >
                {isEn ? "Approve" : "Aprobar"}
              </Button>
              <Button
                disabled={isPending}
                onClick={() => handleReview("rejected")}
                size="sm"
                variant="destructive"
              >
                {isEn ? "Reject" : "Rechazar"}
              </Button>
            </div>
          </div>
        ) : null}

        {isRejected ? (
          <p className="text-red-600 text-sm">
            {isEn
              ? "Verification was rejected. The guest may re-submit."
              : "La verificación fue rechazada. El huésped puede reenviar."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
