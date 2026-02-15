"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Locale } from "@/lib/i18n";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

async function apiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json();
}

async function apiDelete(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json();
}

function asString(val: unknown): string {
  if (typeof val === "string") return val;
  return String(val ?? "");
}

function nestedStr(obj: unknown, ...keys: string[]): string {
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return "";
    }
  }
  return typeof current === "string" ? current : String(current ?? "");
}

const ROLES = [
  { value: "owner_admin", labelEn: "Owner / Admin", labelEs: "Dueño / Admin" },
  { value: "operator", labelEn: "Operator", labelEs: "Operador" },
  { value: "cleaner", labelEn: "Cleaner", labelEs: "Limpieza" },
  { value: "accountant", labelEn: "Accountant", labelEs: "Contador" },
  { value: "viewer", labelEn: "Viewer", labelEs: "Visor" },
];

type TeamManagerProps = {
  members: Record<string, unknown>[];
  invites: Record<string, unknown>[];
  orgId: string;
  locale: Locale;
};

export function TeamManager({
  members,
  invites,
  orgId,
  locale,
}: TeamManagerProps) {
  const isEn = locale === "en-US";
  const router = useRouter();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("operator");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await apiPost(`/organizations/${orgId}/invites`, {
        email: inviteEmail.trim(),
        role: inviteRole,
        expires_in_days: 14,
      });
      setInviteEmail("");
      setSuccess(
        isEn
          ? `Invitation sent to ${inviteEmail.trim()}`
          : `Invitación enviada a ${inviteEmail.trim()}`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    setLoading(true);
    setError(null);
    try {
      await apiDelete(`/organizations/${orgId}/invites/${inviteId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const pendingInvites = invites.filter(
    (inv) => asString(inv.status) === "pending"
  );

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Members list */}
      <div>
        <h3 className="mb-3 font-semibold text-sm">
          {isEn
            ? `Members (${members.length})`
            : `Miembros (${members.length})`}
        </h3>
        <div className="space-y-2">
          {members.map((member, i) => {
            const userId = asString(member.user_id);
            const role = asString(member.role);
            const email = nestedStr(member, "app_users", "email");
            const name = nestedStr(member, "app_users", "full_name");
            const roleInfo = ROLES.find((r) => r.value === role);

            return (
              <div
                className="flex items-center justify-between rounded-lg border border-border/80 px-4 py-3"
                key={userId || i}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">
                    {name || email || userId}
                  </p>
                  {name && email && (
                    <p className="truncate text-muted-foreground text-xs">
                      {email}
                    </p>
                  )}
                </div>
                <Badge variant="secondary" className="ml-2 shrink-0">
                  {isEn
                    ? roleInfo?.labelEn ?? role
                    : roleInfo?.labelEs ?? role}
                </Badge>
              </div>
            );
          })}
          {members.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {isEn ? "No members found." : "No se encontraron miembros."}
            </p>
          )}
        </div>
      </div>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div>
          <h3 className="mb-3 font-semibold text-sm">
            {isEn
              ? `Pending Invitations (${pendingInvites.length})`
              : `Invitaciones Pendientes (${pendingInvites.length})`}
          </h3>
          <div className="space-y-2">
            {pendingInvites.map((inv, i) => {
              const invId = asString(inv.id);
              const email = asString(inv.email);
              const role = asString(inv.role);
              const expiresAt = asString(inv.expires_at);
              const roleInfo = ROLES.find((r) => r.value === role);

              return (
                <div
                  className="flex items-center justify-between rounded-lg border border-dashed border-border/80 px-4 py-3"
                  key={invId || i}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{email}</p>
                    <p className="text-muted-foreground text-xs">
                      {isEn ? "Role:" : "Rol:"}{" "}
                      {isEn
                        ? roleInfo?.labelEn ?? role
                        : roleInfo?.labelEs ?? role}
                      {expiresAt &&
                        ` · ${isEn ? "Expires" : "Expira"} ${expiresAt.slice(0, 10)}`}
                    </p>
                  </div>
                  <Button
                    disabled={loading}
                    onClick={() => handleRevoke(invId)}
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-red-600 hover:text-red-700"
                  >
                    {isEn ? "Revoke" : "Revocar"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Invite form */}
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {isEn ? "Invite a team member" : "Invitar a un miembro"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Send an invitation by email. They'll receive a link to join."
              : "Envía una invitación por email. Recibirán un enlace para unirse."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap gap-3" onSubmit={handleInvite}>
            <div className="min-w-0 flex-1">
              <Input
                aria-label="Email"
                disabled={loading}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={isEn ? "colleague@example.com" : "colega@ejemplo.com"}
                type="email"
                value={inviteEmail}
              />
            </div>
            <div className="w-40">
              <Select
                aria-label={isEn ? "Role" : "Rol"}
                disabled={loading}
                onChange={(e) => setInviteRole(e.target.value)}
                value={inviteRole}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {isEn ? r.labelEn : r.labelEs}
                  </option>
                ))}
              </Select>
            </div>
            <Button disabled={loading || !inviteEmail.trim()} type="submit">
              {loading
                ? isEn
                  ? "Sending..."
                  : "Enviando..."
                : isEn
                  ? "Send invite"
                  : "Enviar invitación"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
