export type RecordPageProps = {
  params: Promise<{
    slug: string;
    id: string;
  }>;
};

export type OrganizationMemberRow = {
  organization_id: string;
  user_id: string;
  role: string;
  is_primary?: boolean | null;
  joined_at?: string | null;
  app_users?: { id: string; email: string; full_name: string } | null;
};

export type OrganizationInviteRow = {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expires_at?: string | null;
  created_at?: string | null;
  accepted_at?: string | null;
  revoked_at?: string | null;
};

export type StatementLineItem = {
  bucket: string;
  source_table: string;
  source_id: string;
  kind: string;
  amount_pyg: number;
  date?: string;
  from?: string;
  to?: string;
};

export type StatementReconciliation = {
  gross_total?: number;
  computed_net_payout?: number;
  stored_net_payout?: number;
  stored_vs_computed_diff?: number;
};

export type QueryValue = string | number | boolean | undefined | null;

export type PropertyRelationSnapshot = {
  units: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  ownerStatements: Record<string, unknown>[];
  leases: Record<string, unknown>[];
  reservations: Record<string, unknown>[];
  listings: Record<string, unknown>[];
  applications: Record<string, unknown>[];
  collections: Record<string, unknown>[];
};

export function isOrganizationMemberRow(
  value: unknown
): value is OrganizationMemberRow {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.organization_id === "string" &&
    typeof record.user_id === "string" &&
    typeof record.role === "string"
  );
}

export function isOrganizationInviteRow(
  value: unknown
): value is OrganizationInviteRow {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.organization_id === "string" &&
    typeof record.email === "string" &&
    typeof record.token === "string"
  );
}
