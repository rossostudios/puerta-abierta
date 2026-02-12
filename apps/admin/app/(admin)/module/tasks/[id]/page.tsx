import { ArrowLeft01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { PinButton } from "@/components/shell/pin-button";
import { RecordRecent } from "@/components/shell/record-recent";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import {
  completeTaskAction,
  createTaskItemAction,
  setTaskAssigneeAction,
  updateTaskItemAction,
  updateTaskStatusAction,
} from "../actions";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
};

type TaskRecord = {
  id: string;
  organization_id: string;
  title: string;
  status: string | null;
  type: string | null;
  priority: string | null;
  due_at: string | null;
  completed_at: string | null;
  description: string | null;
  completion_notes: string | null;
  assigned_user_id: string | null;
  property_id: string | null;
  property_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  reservation_id: string | null;
};

type TaskItemRow = {
  id: string;
  label: string;
  sort_order: number;
  is_required: boolean;
  is_completed: boolean;
};

class ApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asOptionalString(value: unknown): string | null {
  const text = asString(value).trim();
  return text ? text : null;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return false;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function taskStatusActions(status: string): { kind: string; next?: string }[] {
  const normalized = status.trim().toLowerCase();
  if (normalized === "todo") {
    return [
      { kind: "status", next: "in_progress" },
      { kind: "status", next: "cancelled" },
    ];
  }
  if (normalized === "in_progress") {
    return [
      { kind: "complete" },
      { kind: "status", next: "todo" },
      { kind: "status", next: "cancelled" },
    ];
  }
  return [];
}

function localizedTaskStatusLabel(isEn: boolean, status: string): string {
  const normalized = status.trim().toLowerCase();
  if (!isEn) {
    if (normalized === "todo") return "Pendiente";
    if (normalized === "in_progress") return "En progreso";
    if (normalized === "done") return "Hecha";
    if (normalized === "cancelled") return "Cancelada";
  }
  if (normalized === "todo") return "To do";
  if (normalized === "in_progress") return "In progress";
  if (normalized === "done") return "Done";
  if (normalized === "cancelled") return "Cancelled";
  return status;
}

function localizedTaskActionLabel(
  isEn: boolean,
  kind: string,
  next?: string
): string {
  if (kind === "complete") return isEn ? "Complete" : "Completar";

  if (next === "in_progress") return isEn ? "Start" : "Iniciar";
  if (next === "todo") return isEn ? "Back to todo" : "Volver";
  if (next === "cancelled") return isEn ? "Cancel" : "Cancelar";
  return next ?? kind;
}

function statusBadgeClass(status: string): StatusTone {
  const normalized = status.trim().toLowerCase();
  if (normalized === "done") return "success";
  if (normalized === "cancelled") return "danger";
  if (normalized === "in_progress") return "warning";
  if (normalized === "todo") return "warning";
  return "neutral";
}

function asDateTimeLabel(locale: string, value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function fetchJson(
  url: string,
  token: string | null,
  isEn: boolean
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      isEn
        ? `API fetch failed. Is the backend running at ${getApiBaseUrl()}? (${message})`
        : `Fallo al consultar la API. ¿Está el backend en ${getApiBaseUrl()}? (${message})`
    );
  }

  if (response.status === 404) {
    notFound();
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const suffix = details ? `: ${details.slice(0, 240)}` : "";
    throw new ApiRequestError(
      response.status,
      isEn
        ? `API request failed (${response.status})${suffix}`
        : `Falló la solicitud a la API (${response.status})${suffix}`
    );
  }

  return response.json();
}

function normalizeTask(
  record: Record<string, unknown>,
  fallbackId: string,
  isEn: boolean
): TaskRecord {
  const id = asString(record.id).trim() || fallbackId;
  const organization_id = asString(record.organization_id).trim();

  return {
    id,
    organization_id,
    title: asString(record.title).trim() || (isEn ? "Task" : "Tarea"),
    status: asOptionalString(record.status),
    type: asOptionalString(record.type),
    priority: asOptionalString(record.priority),
    due_at: asOptionalString(record.due_at),
    completed_at: asOptionalString(record.completed_at),
    description: asOptionalString(record.description),
    completion_notes: asOptionalString(record.completion_notes),
    assigned_user_id: asOptionalString(record.assigned_user_id),
    property_id: asOptionalString(record.property_id),
    property_name: asOptionalString(record.property_name),
    unit_id: asOptionalString(record.unit_id),
    unit_name: asOptionalString(record.unit_name),
    reservation_id: asOptionalString(record.reservation_id),
  };
}

function normalizeTaskItems(rows: unknown[]): TaskItemRow[] {
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      const id = asString(record.id).trim();
      if (!id) return null;

      const label = asString(record.label).trim();
      return {
        id,
        label,
        sort_order: Math.max(0, asNumber(record.sort_order)),
        is_required: asBoolean(record.is_required),
        is_completed: asBoolean(record.is_completed),
      } satisfies TaskItemRow;
    })
    .filter((item): item is TaskItemRow => Boolean(item))
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.label.localeCompare(b.label);
    });
}

export default async function TaskDetailPage({
  params,
  searchParams,
}: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const { id } = await params;
  const { success, error } = await searchParams;
  const successLabel = success ? safeDecode(success).replaceAll("-", " ") : "";
  const errorLabel = error ? safeDecode(error) : "";

  let task: TaskRecord | null = null;
  let items: TaskItemRow[] = [];
  let apiError: string | null = null;
  let requestStatus: number | null = null;
  let sessionUserId: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    sessionUserId = data.session?.user?.id ?? null;

    const baseUrl = getApiBaseUrl();
    const taskUrl = `${baseUrl}/tasks/${encodeURIComponent(id)}`;
    const itemsUrl = `${baseUrl}/tasks/${encodeURIComponent(id)}/items`;

    const [taskPayload, itemsPayload] = await Promise.all([
      fetchJson(taskUrl, token, isEn),
      fetchJson(itemsUrl, token, isEn),
    ]);

    const taskRecord = taskPayload as Record<string, unknown>;
    task = normalizeTask(taskRecord, id, isEn);

    const itemsRecord = itemsPayload as { data?: unknown[] };
    items = normalizeTaskItems(itemsRecord?.data ?? []);
  } catch (err) {
    apiError = errorMessage(err);
    if (err instanceof ApiRequestError) {
      requestStatus = err.status;
    }
  }

  const activeOrgId = await getActiveOrgId();
  if (apiError || !task) {
    if (requestStatus === 403 && apiError && isOrgMembershipError(apiError)) {
      return <OrgAccessChanged orgId={activeOrgId} />;
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Could not load task details from the backend."
              : "No se pudo cargar la tarea desde el backend."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground text-sm">
          <p>
            {isEn ? "Backend base URL" : "URL base del backend"}:{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              {getApiBaseUrl()}
            </code>
          </p>
          <p className="break-words">
            {apiError ?? (isEn ? "Unknown" : "Desconocido")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const href = `/module/tasks/${encodeURIComponent(task.id)}`;
  const next = href;
  const meta = isEn ? "Task" : "Tarea";

  const statusValue = (task.status ?? "").trim();
  const statusLabel = statusValue
    ? localizedTaskStatusLabel(isEn, statusValue)
    : isEn
      ? "Unknown"
      : "Desconocido";

  const actions = statusValue ? taskStatusActions(statusValue) : [];

  const assignedUserId = (task.assigned_user_id ?? "").trim();
  const canTake = sessionUserId && !assignedUserId;
  const canUnassign = sessionUserId && assignedUserId === sessionUserId;

  const completedCount = items.filter((item) => item.is_completed).length;
  const requiredCount = items.filter((item) => item.is_required).length;
  const missingRequiredCount = items.filter(
    (item) => item.is_required && !item.is_completed
  ).length;
  const dueLabel = asDateTimeLabel(locale, task.due_at);
  const completedLabel = asDateTimeLabel(locale, task.completed_at);
  const completionBlocked =
    missingRequiredCount > 0 &&
    actions.some((action) => action.kind === "complete");

  return (
    <div className="space-y-6">
      <RecordRecent href={href} label={task.title} meta={meta} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "gap-2"
          )}
          href="/module/tasks"
        >
          <Icon icon={ArrowLeft01Icon} size={16} />
          {isEn ? "Back" : "Volver"}
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <CopyButton value={task.id} />
          <PinButton href={href} label={task.title} meta={meta} />
        </div>
      </div>

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
                <StatusBadge
                  label={statusLabel}
                  tone={statusBadgeClass(statusValue)}
                  value={statusValue}
                />
              </div>

              <CardTitle className="text-2xl">{task.title}</CardTitle>
              <CardDescription className="flex flex-wrap gap-2">
                {task.unit_id ? (
                  <Link
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      "h-7 px-2 font-mono"
                    )}
                    href={`/module/units/${encodeURIComponent(task.unit_id)}`}
                  >
                    {task.unit_name ?? task.unit_id}
                  </Link>
                ) : null}
                {task.reservation_id ? (
                  <Link
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      "h-7 px-2 font-mono"
                    )}
                    href={`/module/reservations/${encodeURIComponent(task.reservation_id)}`}
                  >
                    {isEn ? "Reservation" : "Reserva"}
                  </Link>
                ) : null}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {canTake ? (
                <form action={setTaskAssigneeAction}>
                  <input name="task_id" type="hidden" value={task.id} />
                  <input
                    name="assigned_user_id"
                    type="hidden"
                    value={sessionUserId ?? ""}
                  />
                  <input name="next" type="hidden" value={next} />
                  <Button size="sm" type="submit" variant="outline">
                    {isEn ? "Take" : "Tomar"}
                  </Button>
                </form>
              ) : null}
              {canUnassign ? (
                <form action={setTaskAssigneeAction}>
                  <input name="task_id" type="hidden" value={task.id} />
                  <input name="assigned_user_id" type="hidden" value="" />
                  <input name="next" type="hidden" value={next} />
                  <Button size="sm" type="submit" variant="ghost">
                    {isEn ? "Unassign" : "Soltar"}
                  </Button>
                </form>
              ) : null}

              {actions.map((action) => {
                if (action.kind === "complete") {
                  return (
                    <form action={completeTaskAction} key="complete">
                      <input name="task_id" type="hidden" value={task.id} />
                      <input name="next" type="hidden" value={next} />
                      <Button
                        disabled={completionBlocked}
                        size="sm"
                        title={
                          completionBlocked
                            ? isEn
                              ? `Complete required checklist items first (${missingRequiredCount} remaining).`
                              : `Completa los items obligatorios primero (${missingRequiredCount} pendientes).`
                            : undefined
                        }
                        type="submit"
                        variant="secondary"
                      >
                        {localizedTaskActionLabel(isEn, action.kind)}
                      </Button>
                    </form>
                  );
                }

                return (
                  <form action={updateTaskStatusAction} key={action.next}>
                    <input name="task_id" type="hidden" value={task.id} />
                    <input name="next" type="hidden" value={next} />
                    <input
                      name="status"
                      type="hidden"
                      value={action.next ?? ""}
                    />
                    <Button size="sm" type="submit" variant="outline">
                      {localizedTaskActionLabel(isEn, action.kind, action.next)}
                    </Button>
                  </form>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border bg-muted/10 p-3">
              <p className="font-medium text-muted-foreground text-xs">
                {isEn ? "Due" : "Vence"}
              </p>
              <p className="text-sm">{dueLabel ?? "-"}</p>
            </div>

            <div className="rounded-md border bg-muted/10 p-3">
              <p className="font-medium text-muted-foreground text-xs">
                {isEn ? "Completed" : "Completada"}
              </p>
              <p className="text-sm">{completedLabel ?? "-"}</p>
            </div>

            <div className="rounded-md border bg-muted/10 p-3">
              <p className="font-medium text-muted-foreground text-xs">
                {isEn ? "Priority" : "Prioridad"}
              </p>
              <p className="text-sm">{task.priority ?? "-"}</p>
            </div>

            <div className="rounded-md border bg-muted/10 p-3">
              <p className="font-medium text-muted-foreground text-xs">
                {isEn ? "Assigned" : "Asignada"}
              </p>
              <p className="break-words font-mono text-xs">
                {assignedUserId
                  ? canUnassign
                    ? isEn
                      ? "Me"
                      : "Yo"
                    : assignedUserId
                  : "-"}
              </p>
            </div>
          </div>

          {task.description ? (
            <div className="rounded-md border bg-muted/10 p-3">
              <p className="font-medium text-muted-foreground text-xs">
                {isEn ? "Description" : "Descripción"}
              </p>
              <p className="mt-1 text-sm">{task.description}</p>
            </div>
          ) : null}

          {task.completion_notes ? (
            <div className="rounded-md border bg-muted/10 p-3">
              <p className="font-medium text-muted-foreground text-xs">
                {isEn ? "Completion notes" : "Notas de finalización"}
              </p>
              <p className="mt-1 text-sm">{task.completion_notes}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-xl">
                {isEn ? "Checklist" : "Checklist"}
              </CardTitle>
              <CardDescription>
                {items.length
                  ? isEn
                    ? `${completedCount}/${items.length} done (${requiredCount} required)`
                    : `${completedCount}/${items.length} hechas (${requiredCount} obligatorias)`
                  : isEn
                    ? "No checklist items yet."
                    : "Todavía no hay items."}
              </CardDescription>
            </div>

            <Badge className="font-mono text-xs" variant="outline">
              {task.id.slice(0, 8)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {completionBlocked ? (
            <Alert variant="warning">
              <AlertTitle>
                {isEn
                  ? "Complete required checklist items to finish this task."
                  : "Completa los items obligatorios para finalizar la tarea."}
              </AlertTitle>
              <AlertDescription className="mt-1 text-xs">
                {isEn
                  ? `${missingRequiredCount} required item(s) remaining.`
                  : `${missingRequiredCount} item(s) obligatorios pendientes.`}
              </AlertDescription>
            </Alert>
          ) : null}
          {items.length ? (
            <div className="space-y-2">
              {items.map((item) => {
                const nextCompleted = item.is_completed ? "0" : "1";

                return (
                  <form
                    action={updateTaskItemAction}
                    className="flex items-start gap-3 rounded-md border bg-muted/10 px-3 py-2"
                    key={item.id}
                  >
                    <input name="task_id" type="hidden" value={task.id} />
                    <input name="item_id" type="hidden" value={item.id} />
                    <input
                      name="is_completed"
                      type="hidden"
                      value={nextCompleted}
                    />
                    <input name="next" type="hidden" value={next} />

                    <Button
                      className="h-auto w-full justify-start gap-3 px-0 py-1"
                      type="submit"
                      variant="ghost"
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          item.is_completed
                            ? "status-tone-success"
                            : "border-input bg-background"
                        )}
                      >
                        {item.is_completed ? (
                          <Icon icon={Tick01Icon} size={12} />
                        ) : null}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block break-words text-sm",
                            item.is_completed
                              ? "text-muted-foreground line-through"
                              : "text-foreground"
                          )}
                        >
                          {item.label}
                        </span>
                        {item.is_required ? (
                          <span className="mt-0.5 block text-muted-foreground text-xs">
                            {isEn ? "Required" : "Obligatorio"}
                          </span>
                        ) : null}
                      </span>

                      <span className="shrink-0 text-muted-foreground text-xs">
                        {item.is_completed
                          ? isEn
                            ? "Done"
                            : "Hecho"
                          : isEn
                            ? "Open"
                            : "Pendiente"}
                      </span>
                    </Button>
                  </form>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border bg-muted/10 p-3 text-muted-foreground text-sm">
              {isEn
                ? "Add checklist items to track what must be done before completing the task."
                : "Agrega items para controlar lo que falta antes de completar la tarea."}
            </div>
          )}

          <form action={createTaskItemAction} className="flex flex-wrap gap-2">
            <input name="task_id" type="hidden" value={task.id} />
            <input name="next" type="hidden" value={next} />
            <Input
              className="min-w-[220px] flex-1"
              name="label"
              placeholder={isEn ? "Add checklist item" : "Agregar item"}
              required
            />
            <Button type="submit" variant="secondary">
              {isEn ? "Add" : "Agregar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
