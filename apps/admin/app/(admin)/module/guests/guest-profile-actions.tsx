"use client";

import { Delete02Icon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

import { deleteGuestAction, updateGuestAction } from "./actions";

type GuestProfile = {
  id: string;
  full_name: string;
  email: string | null;
  phone_e164: string | null;
  document_type: string | null;
  document_number: string | null;
  country_code: string | null;
  preferred_language: string | null;
  notes: string | null;
};

export function GuestProfileActions({
  guest,
  nextPath,
}: {
  guest: GuestProfile;
  nextPath: string;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const t = (en: string, es: string) => (isEn ? en : es);

  const [open, setOpen] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const close = () => {
    setDeleteArmed(false);
    setOpen(false);
  };

  return (
    <>
      <Button
        className="gap-2"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Icon icon={PencilEdit01Icon} size={16} />
        {t("Edit", "Editar")}
      </Button>

      <Sheet
        contentClassName="max-w-full sm:max-w-xl"
        description={t(
          "Update guest details and notes.",
          "Actualiza datos del huésped y sus notas."
        )}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        open={open}
        title={
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{t("Guest", "Huésped")}</Badge>
              <Badge className="text-[11px]" variant="secondary">
                CRM
              </Badge>
            </div>
            <p className="truncate font-semibold text-base">
              {guest.full_name}
            </p>
          </div>
        }
      >
        <Form action={updateGuestAction} className="grid gap-4">
          <input name="id" type="hidden" value={guest.id} />
          <input name="next" type="hidden" value={nextPath} />

          <div className="grid gap-1">
            <label className="font-medium text-xs">
              {t("Full name", "Nombre completo")}
            </label>
            <Input
              defaultValue={guest.full_name}
              name="full_name"
              placeholder="Ana Perez"
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <label className="font-medium text-xs">Email</label>
              <Input
                defaultValue={guest.email ?? ""}
                name="email"
                placeholder="ana@example.com"
                type="email"
              />
            </div>
            <div className="grid gap-1">
              <label className="font-medium text-xs">
                {t("Phone", "Teléfono")}
              </label>
              <Input
                defaultValue={guest.phone_e164 ?? ""}
                name="phone_e164"
                placeholder="+595981000000"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <label className="font-medium text-xs">
                {t("Document type", "Tipo de documento")}
              </label>
              <Input
                defaultValue={guest.document_type ?? ""}
                name="document_type"
                placeholder="passport"
              />
            </div>
            <div className="grid gap-1">
              <label className="font-medium text-xs">
                {t("Document number", "Número de documento")}
              </label>
              <Input
                defaultValue={guest.document_number ?? ""}
                name="document_number"
                placeholder="123456789"
              />
            </div>
            <div className="grid gap-1">
              <label className="font-medium text-xs">
                {t("Country", "País")}
              </label>
              <Input
                defaultValue={guest.country_code ?? ""}
                maxLength={2}
                name="country_code"
                placeholder="PY"
              />
            </div>
          </div>

          <div className="grid gap-1">
            <label className="font-medium text-xs">
              {t("Preferred language", "Idioma preferido")}
            </label>
            <Input
              defaultValue={guest.preferred_language ?? "es"}
              name="preferred_language"
              placeholder={isEn ? "en" : "es"}
            />
          </div>

          <div className="grid gap-1">
            <label className="font-medium text-xs">{t("Notes", "Notas")}</label>
            <Textarea
              defaultValue={guest.notes ?? ""}
              name="notes"
              placeholder={t(
                "Preferences, special requests, document details...",
                "Preferencias, pedidos especiales, datos de documentos..."
              )}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button onClick={close} type="button" variant="ghost">
              {t("Cancel", "Cancelar")}
            </Button>
            <Button className="gap-2" type="submit" variant="secondary">
              <Icon icon={PencilEdit01Icon} size={16} />
              {t("Save changes", "Guardar cambios")}
            </Button>
          </div>
        </Form>

        <div className="mt-8 border-t pt-4">
          <p className="font-medium text-foreground text-sm">
            {t("Risk zone", "Zona de riesgo")}
          </p>
          <p className="mt-1 text-muted-foreground text-sm">
            {t(
              "Deleting a guest removes the contact record. Historical reservations will keep their IDs, but may lose the guest reference.",
              "Eliminar un huésped borra el registro de contacto. Las reservas históricas conservarán sus IDs pero pueden perder la referencia al huésped."
            )}
          </p>

          <Form action={deleteGuestAction} className="mt-3">
            <input name="id" type="hidden" value={guest.id} />
            <input name="next" type="hidden" value="/module/guests" />
            {deleteArmed ? (
              <Button className="gap-2" type="submit" variant="destructive">
                <Icon icon={Delete02Icon} size={16} />
                {t("Confirm deletion", "Confirmar eliminación")}
              </Button>
            ) : (
              <Button
                className={cn("gap-2")}
                onClick={() => setDeleteArmed(true)}
                type="button"
                variant="outline"
              >
                <Icon icon={Delete02Icon} size={16} />
                {t("Delete guest", "Eliminar huésped")}
              </Button>
            )}
          </Form>
        </div>
      </Sheet>
    </>
  );
}
