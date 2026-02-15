import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { TeamManager } from "./team-manager";

export default async function TeamSettingsPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Missing organization" : "Falta organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select an organization to manage team members."
              : "Selecciona una organización para gestionar el equipo."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let members: Record<string, unknown>[] = [];
  let invites: Record<string, unknown>[] = [];
  let fetchError: string | null = null;

  try {
    const [membersRes, invitesRes] = await Promise.all([
      fetchJson<{ data?: Record<string, unknown>[] }>(
        `/organizations/${orgId}/members`,
        { org_id: orgId }
      ),
      fetchJson<{ data?: Record<string, unknown>[] }>(
        `/organizations/${orgId}/invites`,
        { org_id: orgId }
      ).catch(() => ({ data: [] })),
    ]);
    members = membersRes.data ?? [];
    invites = invitesRes.data ?? [];
  } catch (err) {
    if (isOrgMembershipError(errorMessage(err)))
      return <OrgAccessChanged orgId={orgId} />;
    fetchError = errorMessage(err);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEn ? "Team Members" : "Miembros del Equipo"}</CardTitle>
        <CardDescription>
          {isEn
            ? "Manage members and pending invitations for your organization."
            : "Gestiona los miembros e invitaciones pendientes de tu organización."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {fetchError ? (
          <Alert variant="destructive">
            <AlertDescription>{fetchError}</AlertDescription>
          </Alert>
        ) : (
          <TeamManager
            invites={invites}
            locale={locale}
            members={members}
            orgId={orgId}
          />
        )}
      </CardContent>
    </Card>
  );
}
