import Link from "next/link";
import { Suspense } from "react";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchList, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { MaintenanceManager } from "../maintenance/maintenance-manager";
import { TasksManager } from "../tasks/tasks-manager";

type OperationsTab = "tasks" | "maintenance";

type PageProps = {
  searchParams: Promise<{
    tab?: string;
    mine?: string;
    success?: string;
    error?: string;
  }>;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function normalizeTab(value: string | undefined): OperationsTab {
  return value === "maintenance" ? "maintenance" : "tasks";
}

export default async function OperationsHubPage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const params = await searchParams;
  const tab = normalizeTab(params.tab);
  const mineOnly = isTruthy(params.mine);
  const successLabel = params.success
    ? safeDecode(params.success).replaceAll("-", " ")
    : "";
  const errorLabel = params.error ? safeDecode(params.error) : "";

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn
              ? "Missing organization context"
              : "Falta contexto de organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select an organization to load operations."
              : "Selecciona una organización para cargar operaciones."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (tab === "tasks") {
    let sessionUserId: string | null = null;
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getSession();
      sessionUserId = data.session?.user?.id ?? null;
    } catch {
      sessionUserId = null;
    }

    let tasks: Record<string, unknown>[] = [];
    let units: Record<string, unknown>[] = [];

    try {
      const [taskRows, unitRows] = await Promise.all([
        fetchList(
          "/tasks",
          orgId,
          1000,
          mineOnly && sessionUserId
            ? { assigned_user_id: sessionUserId }
            : undefined
        ),
        fetchList("/units", orgId, 500),
      ]);
      tasks = taskRows as Record<string, unknown>[];
      units = unitRows as Record<string, unknown>[];
    } catch (err) {
      const message = errorMessage(err);
      if (isOrgMembershipError(message))
        return <OrgAccessChanged orgId={orgId} />;

      return (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn ? "API connection failed" : "Fallo de conexión a la API"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Could not load operations data from the backend."
                : "No se pudieron cargar operaciones desde el backend."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-muted-foreground text-sm">
            <p>
              {isEn ? "Backend base URL" : "URL base del backend"}:{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {getApiBaseUrl()}
              </code>
            </p>
            <p className="break-words">{message}</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {isEn ? "Operations" : "Operaciones"}
                  </Badge>
                  <Badge className="text-[11px]" variant="secondary">
                    {isEn ? "Tasks" : "Tareas"}
                  </Badge>
                </div>
                <CardTitle className="text-2xl">
                  {isEn ? "Operations" : "Operaciones"}
                </CardTitle>
                <CardDescription>
                  {isEn
                    ? "Coordinate tasks and maintenance from one operations workspace."
                    : "Coordina tareas y mantenimiento desde un solo espacio operativo."}
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  className={cn(
                    buttonVariants({ size: "sm", variant: "secondary" })
                  )}
                  href="/module/operations?tab=tasks"
                >
                  {isEn ? "Tasks" : "Tareas"}
                </Link>
                <Link
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" })
                  )}
                  href="/module/operations?tab=maintenance"
                >
                  {isEn ? "Maintenance" : "Mantenimiento"}
                </Link>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-md border bg-muted/20 p-1">
                <Link
                  className={cn(
                    buttonVariants({
                      variant: mineOnly ? "outline" : "secondary",
                      size: "sm",
                    })
                  )}
                  href="/module/operations?tab=tasks"
                >
                  {isEn ? "All tasks" : "Todas"}
                </Link>
                <Link
                  className={cn(
                    buttonVariants({
                      variant: mineOnly ? "secondary" : "outline",
                      size: "sm",
                    })
                  )}
                  href="/module/operations?tab=tasks&mine=1"
                >
                  {isEn ? "My tasks" : "Mis tareas"}
                </Link>
              </div>
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
                href="/module/calendar"
              >
                {isEn ? "Calendar" : "Calendario"}
              </Link>
              <Link
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" })
                )}
                href="/module/reservations"
              >
                {isEn ? "Reservations" : "Reservas"}
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {errorLabel ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {isEn
                    ? "Could not complete request"
                    : "No se pudo completar la solicitud"}
                </AlertTitle>
                <AlertDescription>{errorLabel}</AlertDescription>
              </Alert>
            ) : null}
            {successLabel ? (
              <Alert variant="success">
                <AlertTitle>
                  {isEn ? "Success" : "Éxito"}: {successLabel}
                </AlertTitle>
              </Alert>
            ) : null}

            <Suspense fallback={null}>
              <TasksManager
                currentUserId={sessionUserId}
                orgId={orgId}
                tasks={tasks}
                units={units}
              />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    );
  }

  let requests: Record<string, unknown>[] = [];
  let properties: Record<string, unknown>[] = [];
  let members: Record<string, unknown>[] = [];

  try {
    const [requestRows, propertyRows, memberRows] = await Promise.all([
      fetchList("/maintenance-requests", orgId, 500),
      fetchList("/properties", orgId, 500),
      fetchList(`/organizations/${orgId}/members`, orgId, 300),
    ]);
    requests = requestRows as Record<string, unknown>[];
    properties = propertyRows as Record<string, unknown>[];
    members = memberRows as Record<string, unknown>[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message))
      return <OrgAccessChanged orgId={orgId} />;

    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Could not load maintenance data from the backend."
              : "No se pudieron cargar datos de mantenimiento."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground text-sm">
          <p>
            {isEn ? "Backend base URL" : "URL base del backend"}:{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              {getApiBaseUrl()}
            </code>
          </p>
          <p className="break-words">{message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {isEn ? "Operations" : "Operaciones"}
                </Badge>
                <Badge className="text-[11px]" variant="secondary">
                  {isEn ? "Maintenance" : "Mantenimiento"}
                </Badge>
              </div>
              <CardTitle className="text-2xl">
                {isEn ? "Operations" : "Operaciones"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Coordinate tasks and maintenance from one operations workspace."
                  : "Coordina tareas y mantenimiento desde un solo espacio operativo."}
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" })
                )}
                href="/module/operations?tab=tasks"
              >
                {isEn ? "Tasks" : "Tareas"}
              </Link>
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "secondary" })
                )}
                href="/module/operations?tab=maintenance"
              >
                {isEn ? "Maintenance" : "Mantenimiento"}
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorLabel ? (
            <Alert variant="destructive">
              <AlertTitle>
                {isEn
                  ? "Could not complete request"
                  : "No se pudo completar la solicitud"}
              </AlertTitle>
              <AlertDescription>{errorLabel}</AlertDescription>
            </Alert>
          ) : null}
          {successLabel ? (
            <Alert variant="success">
              <AlertTitle>
                {isEn ? "Success" : "Éxito"}: {successLabel}
              </AlertTitle>
            </Alert>
          ) : null}

          <MaintenanceManager
            members={members}
            properties={properties}
            requests={requests}
          />
        </CardContent>
      </Card>
    </div>
  );
}
