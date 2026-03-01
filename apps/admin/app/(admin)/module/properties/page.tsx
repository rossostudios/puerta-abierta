import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchList, getApiBaseUrl } from "@/lib/api";
import type { components } from "@/lib/api/types";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveDictionary } from "@/lib/i18n/server";
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";
import { PropertiesManager } from "./properties-manager";

type Property = components["schemas"]["Property"];
type RelationRow = Record<string, unknown>;

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function PropertiesModulePage({
  searchParams,
}: PageProps) {
  const [{ properties: dict, common }, orgId, { success, error }] =
    await Promise.all([getActiveDictionary(), getActiveOrgId(), searchParams]);

  const successMessage = success
    ? safeDecode(success) === "property-created"
      ? dict.created
      : safeDecode(success).replaceAll("-", " ")
    : "";
  const errorLabel = error ? safeDecode(error) : "";

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{common.missingOrg}</CardTitle>
          <CardDescription>{common.selectOrg}</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <code className="rounded bg-muted px-1 py-0.5">Onboarding</code>
        </CardContent>
      </Card>
    );
  }

  let properties: Property[] = [];
  let units: RelationRow[] = [];
  let leases: RelationRow[] = [];
  let tasks: RelationRow[] = [];
  let collections: RelationRow[] = [];

  try {
    properties = (await fetchList("/properties", orgId, 500)) as Property[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>{dict.apiFail}</CardTitle>
          <CardDescription>{dict.couldNotLoad}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground text-sm">
          <p>
            {"URL base"}:{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              {getApiBaseUrl()}
            </code>
          </p>
          <p className="break-words">{message}</p>
        </CardContent>
      </Card>
    );
  }

  try {
    const [unitRows, leaseRows, taskRows, collectionRows] = await Promise.all([
      fetchList("/units", orgId, 800),
      fetchList("/leases", orgId, 800),
      fetchList("/tasks", orgId, 800),
      fetchList("/collections", orgId, 800),
    ]);
    units = unitRows as RelationRow[];
    leases = leaseRows as RelationRow[];
    tasks = taskRows as RelationRow[];
    collections = collectionRows as RelationRow[];
  } catch {
    // Keep portfolio page usable even if supporting relations are temporarily unavailable.
  }

  return (
    <PropertiesManager
      collections={collections}
      dictionary={{
        title: dict.title,
        description: dict.description,
      }}
      error={errorLabel}
      leases={leases}
      orgId={orgId}
      properties={properties}
      success={successMessage}
      tasks={tasks}
      units={units}
    />
  );
}
