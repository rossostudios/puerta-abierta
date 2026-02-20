"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/lib/i18n";

type Policy = {
  tool_name: "create_row" | "update_row" | "delete_row";
  approval_mode: "required" | "auto";
  enabled: boolean;
};

type ApprovalPoliciesProps = {
  orgId: string;
  locale: Locale;
};

const TOOL_LABELS: Record<
  Policy["tool_name"],
  { "en-US": string; "es-PY": string }
> = {
  create_row: {
    "en-US": "Create records",
    "es-PY": "Crear registros",
  },
  update_row: {
    "en-US": "Update records",
    "es-PY": "Actualizar registros",
  },
  delete_row: {
    "en-US": "Delete records",
    "es-PY": "Eliminar registros",
  },
};

function normalizePolicies(payload: unknown): Policy[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];

  return data
    .filter((row): row is Record<string, unknown> =>
      Boolean(row && typeof row === "object")
    )
    .map((row) => {
      const toolName = String(row.tool_name ?? "") as Policy["tool_name"];
      const modeValue = String(row.approval_mode ?? "required");
      const mode: Policy["approval_mode"] =
        modeValue === "auto" ? "auto" : "required";
      return {
        tool_name: toolName,
        approval_mode: mode,
        enabled: row.enabled !== false,
      };
    })
    .filter((policy) => policy.tool_name in TOOL_LABELS);
}

export function ApprovalPolicies({ orgId, locale }: ApprovalPoliciesProps) {
  const isEn = locale === "en-US";
  const queryClient = useQueryClient();

  const policiesQuery = useQuery<Policy[], Error>({
    queryKey: ["agent-approval-policies", orgId],
    queryFn: async () => {
      const response = await fetch(
        `/api/agent/approval-policies?org_id=${encodeURIComponent(orgId)}`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }
      );
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const fallback = isEn
          ? "Could not load approval policies."
          : "No se pudieron cargar las politicas de aprobacion.";
        const msg =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error)
            : fallback;
        throw new Error(msg);
      }

      return normalizePolicies(payload);
    },
  });

  const updateMutation = useMutation<
    unknown,
    Error,
    {
      toolName: Policy["tool_name"];
      patch: Partial<Pick<Policy, "approval_mode" | "enabled">>;
    }
  >({
    mutationFn: async ({ toolName, patch }) => {
      const response = await fetch(
        `/api/agent/approval-policies/${encodeURIComponent(toolName)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ org_id: orgId, ...patch }),
        }
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        const fallback = isEn
          ? "Policy update failed."
          : "Fallo la actualizacion de la politica.";
        throw new Error(payload.error || fallback);
      }
      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["agent-approval-policies", orgId],
      });
    },
  });

  const policies = policiesQuery.data ?? [];
  const busyTool = updateMutation.isPending
    ? updateMutation.variables?.toolName
    : null;
  const error =
    policiesQuery.error?.message ?? updateMutation.error?.message ?? null;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>
          {isEn ? "Approval policies" : "Politicas de aprobacion"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "Control when AI write tools require human review."
            : "Controla cuando las herramientas de escritura de IA requieren revision humana."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>
              {isEn ? "Request failed" : "Solicitud fallida"}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {policiesQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="space-y-2">
            {policies.map((policy) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                key={policy.tool_name}
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-sm">
                    {TOOL_LABELS[policy.tool_name][locale]}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge variant={policy.enabled ? "secondary" : "outline"}>
                      {policy.enabled
                        ? isEn
                          ? "Enabled"
                          : "Activo"
                        : isEn
                          ? "Disabled"
                          : "Inactivo"}
                    </Badge>
                    <Badge variant="outline">
                      {policy.approval_mode === "required"
                        ? isEn
                          ? "Approval required"
                          : "Aprobacion requerida"
                        : isEn
                          ? "Auto execute"
                          : "Ejecucion automatica"}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={busyTool === policy.tool_name}
                    onClick={() => {
                      updateMutation.mutate({
                        toolName: policy.tool_name,
                        patch: {
                          approval_mode:
                            policy.approval_mode === "required"
                              ? "auto"
                              : "required",
                        },
                      });
                    }}
                    size="sm"
                    variant="outline"
                  >
                    {isEn ? "Toggle mode" : "Cambiar modo"}
                  </Button>
                  <Button
                    disabled={busyTool === policy.tool_name}
                    onClick={() => {
                      updateMutation.mutate({
                        toolName: policy.tool_name,
                        patch: { enabled: !policy.enabled },
                      });
                    }}
                    size="sm"
                    variant="outline"
                  >
                    {policy.enabled
                      ? isEn
                        ? "Disable"
                        : "Desactivar"
                      : isEn
                        ? "Enable"
                        : "Activar"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
