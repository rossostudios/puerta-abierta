"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addOrganizationMemberAction,
  removeOrganizationMemberAction,
  updateOrganizationMemberAction,
} from "@/app/(admin)/actions/organization-members";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type MemberRole =
  | "owner_admin"
  | "operator"
  | "cleaner"
  | "accountant"
  | "viewer";

type OrgMemberRow = {
  organization_id: string;
  user_id: string;
  role: MemberRole | string;
  is_primary?: boolean | null;
  joined_at?: string | null;
  app_users?: { id: string; email: string; full_name: string } | null;
};

const ROLE_LABEL: Record<MemberRole, string> = {
  owner_admin: "Administrador",
  operator: "Operaciones",
  cleaner: "Limpieza",
  accountant: "Finanzas",
  viewer: "Solo lectura",
};

const ROLE_OPTIONS: Array<{ value: MemberRole; label: string }> = [
  { value: "owner_admin", label: ROLE_LABEL.owner_admin },
  { value: "operator", label: ROLE_LABEL.operator },
  { value: "cleaner", label: ROLE_LABEL.cleaner },
  { value: "accountant", label: ROLE_LABEL.accountant },
  { value: "viewer", label: ROLE_LABEL.viewer },
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeRole(value: string): MemberRole | null {
  const trimmed = value.trim() as MemberRole;
  return ROLE_LABEL[trimmed] ? trimmed : null;
}

function asName(member: OrgMemberRow): string {
  const raw = member.app_users?.full_name ?? "";
  return raw.trim() || "Miembro";
}

function asEmail(member: OrgMemberRow): string | null {
  const raw = member.app_users?.email ?? "";
  return raw.trim() || null;
}

function roleLabel(value: string): string {
  const normalized = normalizeRole(value);
  return normalized ? ROLE_LABEL[normalized] : value;
}

export function OrgMembersCard({
  organizationId,
  ownerUserId,
  currentUserId,
  canManage,
  members,
}: {
  organizationId: string;
  ownerUserId: string | null;
  currentUserId: string | null;
  canManage: boolean;
  members: OrgMemberRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState<MemberRole>("operator");

  const sorted = useMemo(() => {
    const copy = [...members];
    copy.sort((a, b) => {
      const aOwner = ownerUserId && a.user_id === ownerUserId ? 1 : 0;
      const bOwner = ownerUserId && b.user_id === ownerUserId ? 1 : 0;
      if (aOwner !== bOwner) return bOwner - aOwner;
      const aPrimary = a.is_primary ? 1 : 0;
      const bPrimary = b.is_primary ? 1 : 0;
      if (aPrimary !== bPrimary) return bPrimary - aPrimary;
      return asName(a).localeCompare(asName(b));
    });
    return copy;
  }, [members, ownerUserId]);

  const addMember = () => {
    const userId = newUserId.trim();
    if (!UUID_RE.test(userId)) {
      toast.error("ID inválido", {
        description: "Pega el ID UUID del usuario.",
      });
      return;
    }

    startTransition(async () => {
      const result = await addOrganizationMemberAction({
        organizationId,
        userId,
        role: newRole,
      });
      if (!result.ok) {
        toast.error("No se pudo agregar el miembro", {
          description: result.error,
        });
        return;
      }
      toast.success("Miembro agregado");
      setNewUserId("");
      router.refresh();
    });
  };

  const updateRole = (memberUserId: string, role: MemberRole) => {
    startTransition(async () => {
      const result = await updateOrganizationMemberAction({
        organizationId,
        userId: memberUserId,
        role,
      });
      if (!result.ok) {
        toast.error("No se pudo actualizar el rol", {
          description: result.error,
        });
        return;
      }
      toast.success("Rol actualizado");
      router.refresh();
    });
  };

  const removeMember = (memberUserId: string) => {
    toast("Confirmar eliminación", {
      description: "¿Eliminar este miembro de la organización?",
      action: {
        label: "Eliminar",
        onClick: () => {
          startTransition(async () => {
            const result = await removeOrganizationMemberAction({
              organizationId,
              userId: memberUserId,
            });
            if (!result.ok) {
              toast.error("No se pudo eliminar el miembro", {
                description: result.error,
              });
              return;
            }
            toast.success("Miembro eliminado");
            router.refresh();
          });
        },
      },
    });
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Miembros</CardTitle>
            <CardDescription>
              Gestiona quién puede acceder a esta organización y qué permisos
              tiene.
            </CardDescription>
          </div>
          <Badge variant="secondary">{sorted.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage ? (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <label className="block flex-1" htmlFor="member-user-id">
                <span className="mb-1 block font-medium text-muted-foreground text-xs">
                  ID de usuario
                </span>
                <Input
                  id="member-user-id"
                  onChange={(event) => setNewUserId(event.target.value)}
                  placeholder="UUID del usuario"
                  value={newUserId}
                />
              </label>
              <label className="block md:w-56" htmlFor="member-role">
                <span className="mb-1 block font-medium text-muted-foreground text-xs">
                  Rol
                </span>
                <Select
                  id="member-role"
                  onChange={(event) => {
                    const next = normalizeRole(event.target.value);
                    if (next) setNewRole(next);
                  }}
                  value={newRole}
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
              <Button disabled={pending} onClick={addMember} type="button">
                Agregar
              </Button>
            </div>
            <p className="mt-2 text-muted-foreground text-xs">
              Tip: por ahora se agrega por ID de usuario. Invitaciones por
              correo llegarán pronto.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/10 p-4 text-muted-foreground text-sm">
            Solo los administradores pueden gestionar miembros.
          </div>
        )}

        <div className="divide-y overflow-hidden rounded-lg border">
          {sorted.map((member) => {
            const email = asEmail(member);
            const label = roleLabel(String(member.role ?? ""));
            const isOwner = ownerUserId && member.user_id === ownerUserId;
            const isYou = currentUserId && member.user_id === currentUserId;

            return (
              <div
                className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
                key={member.user_id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-sm">
                      {asName(member)}
                    </p>
                    {isOwner ? (
                      <Badge className="text-[11px]" variant="outline">
                        Propietario
                      </Badge>
                    ) : null}
                    {isYou ? (
                      <Badge className="text-[11px]" variant="secondary">
                        Tú
                      </Badge>
                    ) : null}
                    {member.is_primary ? (
                      <Badge className="text-[11px]" variant="secondary">
                        Principal
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                    <span className="truncate">{email ?? member.user_id}</span>
                    <CopyButton label="Copiar" value={member.user_id} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canManage && !isOwner ? (
                    <Select
                      className="h-9 w-44"
                      disabled={pending}
                      onChange={(event) => {
                        const next = normalizeRole(event.target.value);
                        if (next) updateRole(member.user_id, next);
                      }}
                      value={
                        normalizeRole(String(member.role ?? "")) ?? "viewer"
                      }
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge variant="secondary">{label}</Badge>
                  )}

                  {canManage && !isOwner ? (
                    <Button
                      disabled={pending}
                      onClick={() => removeMember(member.user_id)}
                      type="button"
                      variant="outline"
                    >
                      Quitar
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}

          {sorted.length ? null : (
            <div className="p-6 text-muted-foreground text-sm">
              Aún no hay miembros en esta organización.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
