"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Image from "next/image";
import { toast } from "sonner";

import { deleteOrganizationFromSettingsAction } from "@/app/(admin)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Org = {
  id: string;
  name?: string | null;
  logo_url?: string | null;
};

type MeResponse = {
  organizations?: Org[];
};

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function OrgList({
  activeOrgId,
  isEn,
}: {
  activeOrgId: string | null;
  isEn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const { data: orgs = [], isLoading: loading } = useQuery({
    queryKey: ["me-organizations"],
    queryFn: async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) return [];
      const payload = (await response.json()) as MeResponse;
      return payload.organizations ?? [];
    },
  });

  const canDelete = orgs.length >= 2;

  const deleteOrg = (orgId: string) => {
    toast(isEn ? "Confirm deletion" : "Confirmar eliminación", {
      description: isEn
        ? "This organization and all its data will be permanently deleted."
        : "Esta organización y todos sus datos se eliminarán permanentemente.",
      action: {
        label: isEn ? "Delete" : "Eliminar",
        onClick: () => {
          startTransition(async () => {
            const result = await deleteOrganizationFromSettingsAction({
              organizationId: orgId,
            });
            if (!result.ok) {
              toast.error(
                isEn
                  ? "Could not delete organization"
                  : "No se pudo eliminar la organización",
                { description: result.error }
              );
              return;
            }
            toast.success(
              isEn ? "Organization deleted" : "Organización eliminada"
            );
            if (orgId === activeOrgId) {
              await fetch("/api/org", {
                method: "DELETE",
                headers: { Accept: "application/json" },
              });
            }
            router.refresh();
          });
        },
      },
    });
  };

  if (loading) {
    return (
      <div className="py-4 text-center text-muted-foreground text-sm">
        {isEn ? "Loading..." : "Cargando..."}
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <div className="py-4 text-muted-foreground text-sm">
        {isEn ? "No organizations found." : "No se encontraron organizaciones."}
      </div>
    );
  }

  return (
    <div className="divide-y overflow-hidden rounded-lg border">
      {orgs.map((org) => {
        const isActive = org.id === activeOrgId;
        return (
          <div
            className="flex items-center justify-between gap-3 p-4"
            key={org.id}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/20">
                {org.logo_url ? (
                  <Image
                    alt={
                      org.name ||
                      (isEn ? "Organization logo" : "Logo de organización")
                    }
                    className="h-full w-full object-cover"
                    height={40}
                    src={org.logo_url}
                    unoptimized
                    width={40}
                  />
                ) : (
                  <span className="font-semibold text-muted-foreground text-xs">
                    {isEn ? "ORG" : "ORG"}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-sm">
                    {org.name || (isEn ? "Unnamed Organization" : "Sin nombre")}
                  </p>
                  {isActive && (
                    <Badge className="text-[11px]" variant="secondary">
                      {isEn ? "Active" : "Activa"}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 font-mono text-muted-foreground text-xs">
                  {shortId(org.id)}
                </p>
              </div>
            </div>
            {canDelete && (
              <Button
                disabled={pending}
                onClick={() => deleteOrg(org.id)}
                size="sm"
                type="button"
                variant="outline"
              >
                {isEn ? "Delete" : "Eliminar"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
