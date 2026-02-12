import Link from "next/link";

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

import { TasksManager } from "./tasks-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string; mine?: string }>;
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

export default async function TasksModulePage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const orgId = await getActiveOrgId();
  const { success, error, mine } = await searchParams;
  const mineOnly = isTruthy(mine);
  const successLabel = success ? safeDecode(success).replaceAll("-", " ") : "";
  const errorLabel = error ? safeDecode(error) : "";

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
              ? "Select an organization to load tasks."
              : "Selecciona una organización para cargar tareas."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {isEn ? (
            <>
              Select an organization from the top bar, or create one in{" "}
              <code className="rounded bg-muted px-1 py-0.5">Setup</code>.
            </>
          ) : (
            <>
              Selecciona una organización desde la barra superior o crea una en{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                Configuración
              </code>
              .
            </>
          )}
        </CardContent>
      </Card>
    );
  }

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
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Could not load tasks from the backend."
              : "No se pudieron cargar tareas desde el backend."}
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
          <p>
            {isEn ? "Make sure" : "Asegúrate de que"}{" "}
            <span className="font-medium">FastAPI</span>{" "}
            {isEn ? "is running" : "esté ejecutándose"} (
            {isEn ? "from" : "desde"}{" "}
            <code className="rounded bg-muted px-1 py-0.5">apps/backend</code>){" "}
            {isEn ? "on port 8000." : "en el puerto 8000."}
          </p>
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
                {isEn ? "Tasks" : "Tareas"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Track cleaning, maintenance, and operational work."
                  : "Seguimiento de limpieza, mantenimiento y trabajo operativo."}
              </CardDescription>
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
                  href="/module/tasks"
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
                  href="/module/tasks?mine=1"
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

          <TasksManager
            currentUserId={sessionUserId}
            orgId={orgId}
            tasks={tasks}
            units={units}
          />
        </CardContent>
      </Card>
    </div>
  );
}
