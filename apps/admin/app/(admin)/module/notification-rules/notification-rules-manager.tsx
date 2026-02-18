"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import {
  createNotificationRuleAction,
  toggleNotificationRuleAction,
} from "@/app/(admin)/module/notification-rules/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DataTableRow } from "@/components/ui/data-table";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { NotionDataTable } from "@/components/ui/notion-data-table";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import type { NotificationRuleMetadataResponse } from "@/lib/api";
import { humanizeKey } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";

type RuleRow = {
  id: string;
  trigger_event: string;
  channel: string;
  is_active: boolean;
  message_template_id: string | null;
  template_name: string | null;
  created_at: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asOptionalString(value: unknown): string | null {
  const text = asString(value).trim();
  return text || null;
}

export function NotificationRulesManager({
  nextPath = "/module/notification-rules",
  orgId,
  rules,
  templates,
  metadata,
}: {
  nextPath?: string;
  orgId: string;
  rules: Record<string, unknown>[];
  templates: Record<string, unknown>[];
  metadata: NotificationRuleMetadataResponse;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const [open, setOpen] = useState(false);

  const templateOptions = useMemo(() => {
    return templates
      .map((t) => {
        const id = asString(t.id).trim();
        const name = asString(t.name).trim();
        return id ? { id, label: name || id } : null;
      })
      .filter((item): item is { id: string; label: string } => Boolean(item));
  }, [templates]);

  const templateIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of templateOptions) {
      map.set(t.id, t.label);
    }
    return map;
  }, [templateOptions]);

  const triggerOptions = useMemo(() => {
    const triggers = Array.isArray(metadata.triggers) ? metadata.triggers : [];
    if (triggers.length > 0) {
      return triggers.map((trigger) => ({
        value: trigger.value,
        label: isEn
          ? trigger.label_en || humanizeKey(trigger.value)
          : trigger.label_es || trigger.label_en || humanizeKey(trigger.value),
      }));
    }

    const fallback = Array.from(
      new Set(
        rules.map((rule) => asString(rule.trigger_event).trim()).filter(Boolean)
      )
    );
    return fallback.map((value) => ({
      value,
      label: humanizeKey(value),
    }));
  }, [isEn, metadata.triggers, rules]);

  const channelOptions = useMemo(() => {
    const channels = Array.isArray(metadata.channels) ? metadata.channels : [];
    if (channels.length === 0) return ["whatsapp", "email", "sms"];
    return channels;
  }, [metadata.channels]);

  const rows = useMemo<RuleRow[]>(() => {
    return rules
      .map((rule) => {
        const id = asString(rule.id).trim();
        if (!id) return null;
        const templateId = asOptionalString(rule.message_template_id);
        return {
          id,
          trigger_event: asString(rule.trigger_event).trim(),
          channel: asString(rule.channel).trim() || "whatsapp",
          is_active:
            rule.is_active === true ||
            asString(rule.is_active).toLowerCase() === "true",
          message_template_id: templateId,
          template_name: templateId
            ? (templateIndex.get(templateId) ?? null)
            : null,
          created_at: asOptionalString(rule.created_at),
        };
      })
      .filter((row): row is RuleRow => Boolean(row));
  }, [rules, templateIndex]);

  const columns = useMemo<ColumnDef<DataTableRow>[]>(
    () => [
      {
        accessorKey: "trigger_event",
        header: isEn ? "Trigger" : "Evento",
        cell: ({ getValue }) => (
          <Badge variant="secondary">
            {humanizeKey(String(getValue() ?? ""))}
          </Badge>
        ),
      },
      {
        accessorKey: "channel",
        header: isEn ? "Channel" : "Canal",
        cell: ({ getValue }) => (
          <Badge variant="outline">{String(getValue() ?? "")}</Badge>
        ),
      },
      {
        accessorKey: "is_active",
        header: isEn ? "Status" : "Estado",
        cell: ({ getValue }) => {
          const active = Boolean(getValue());
          return (
            <StatusBadge
              tone={active ? "success" : "neutral"}
              value={
                active
                  ? isEn
                    ? "Active"
                    : "Activo"
                  : isEn
                    ? "Inactive"
                    : "Inactivo"
              }
            />
          );
        },
      },
      {
        accessorKey: "template_name",
        header: isEn ? "Template" : "Plantilla",
        cell: ({ getValue }) => {
          const name = String(getValue() ?? "");
          return name ? (
            <span className="text-sm">{name}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          );
        },
      },
    ],
    [isEn]
  );

  function renderRowActions(row: DataTableRow) {
    const data = row as unknown as RuleRow;
    return (
      <Form action={toggleNotificationRuleAction}>
        <input name="rule_id" type="hidden" value={data.id} />
        <input
          name="is_active"
          type="hidden"
          value={data.is_active ? "false" : "true"}
        />
        <input name="next" type="hidden" value={nextPath} />
        <Button size="sm" type="submit" variant="outline">
          {data.is_active
            ? isEn
              ? "Deactivate"
              : "Desactivar"
            : isEn
              ? "Activate"
              : "Activar"}
        </Button>
      </Form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)} type="button" variant="secondary">
          <Icon icon={PlusSignIcon} size={16} />
          {isEn ? "New rule" : "Nueva regla"}
        </Button>
      </div>

      <NotionDataTable
        columns={columns}
        data={rows}
        renderRowActions={renderRowActions}
        rowActionsHeader={isEn ? "Actions" : "Acciones"}
      />

      <Sheet
        contentClassName="max-w-xl"
        description={
          isEn
            ? "Create an automated notification rule for a trigger event."
            : "Crea una regla de notificación automática para un evento."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New notification rule" : "Nueva regla de notificación"}
      >
        <Form action={createNotificationRuleAction} className="space-y-4">
          <input name="organization_id" type="hidden" value={orgId} />
          <input name="next" type="hidden" value={nextPath} />

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Trigger event" : "Evento disparador"}
            </span>
            <Select defaultValue="" name="trigger_event" required>
              <option disabled value="">
                {isEn ? "Select an event" : "Selecciona un evento"}
              </option>
              {triggerOptions.map((event) => (
                <option key={event.value} value={event.value}>
                  {event.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn ? "Channel" : "Canal"}
            </span>
            <Select defaultValue="whatsapp" name="channel">
              {channelOptions.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </Select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-muted-foreground">
              {isEn
                ? "Message template (optional)"
                : "Plantilla de mensaje (opcional)"}
            </span>
            <Select defaultValue="" name="message_template_id">
              <option value="">{isEn ? "No template" : "Sin plantilla"}</option>
              {templateOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </label>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              {isEn ? "Cancel" : "Cancelar"}
            </Button>
            <Button type="submit" variant="secondary">
              {isEn ? "Create rule" : "Crear regla"}
            </Button>
          </div>
        </Form>
      </Sheet>
    </div>
  );
}
