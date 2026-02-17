"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ConfigProps = {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  isEn: boolean;
};

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNum(v: unknown): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && v !== "") return v;
  return "";
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function CreateTaskConfig({ value, onChange, isEn }: ConfigProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label={isEn ? "Task title" : "Título de la tarea"}>
        <Input
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder={isEn ? "e.g. Turnover cleaning" : "ej. Limpieza de rotación"}
          value={asStr(value.title)}
        />
      </Field>
      <Field label={isEn ? "Type" : "Tipo"}>
        <Select
          onChange={(e) => onChange({ ...value, type: e.target.value })}
          value={asStr(value.type) || "cleaning"}
        >
          <option value="cleaning">{isEn ? "Cleaning" : "Limpieza"}</option>
          <option value="maintenance">{isEn ? "Maintenance" : "Mantenimiento"}</option>
          <option value="inspection">{isEn ? "Inspection" : "Inspección"}</option>
        </Select>
      </Field>
      <Field label={isEn ? "Priority" : "Prioridad"}>
        <Select
          onChange={(e) => onChange({ ...value, priority: e.target.value })}
          value={asStr(value.priority) || "medium"}
        >
          <option value="low">{isEn ? "Low" : "Baja"}</option>
          <option value="medium">{isEn ? "Medium" : "Media"}</option>
          <option value="high">{isEn ? "High" : "Alta"}</option>
        </Select>
      </Field>
    </div>
  );
}

export function SendNotificationConfig({ value, onChange, isEn }: ConfigProps) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={isEn ? "Channel" : "Canal"}>
          <Select
            onChange={(e) => onChange({ ...value, channel: e.target.value })}
            value={asStr(value.channel) || "email"}
          >
            <option value="email">Email</option>
            <option value="push">Push</option>
            <option value="in-app">In-app</option>
          </Select>
        </Field>
        <Field label={isEn ? "Subject" : "Asunto"}>
          <Input
            onChange={(e) => onChange({ ...value, subject: e.target.value })}
            value={asStr(value.subject)}
          />
        </Field>
      </div>
      <Field label={isEn ? "Body" : "Cuerpo"}>
        <Textarea
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          rows={2}
          value={asStr(value.body)}
        />
      </Field>
    </div>
  );
}

export function SendWhatsappConfig({ value, onChange, isEn }: ConfigProps) {
  return (
    <div className="space-y-3">
      <Field label={isEn ? "Message body" : "Cuerpo del mensaje"}>
        <Textarea
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          rows={3}
          value={asStr(value.body)}
        />
      </Field>
      <Field label={isEn ? "Template ID (optional)" : "ID de plantilla (opcional)"}>
        <Input
          onChange={(e) => onChange({ ...value, template_id: e.target.value })}
          placeholder="UUID"
          value={asStr(value.template_id)}
        />
      </Field>
    </div>
  );
}

export function UpdateStatusConfig({ value, onChange, isEn }: ConfigProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={isEn ? "Entity type" : "Tipo de entidad"}>
        <Select
          onChange={(e) => onChange({ ...value, entity_type: e.target.value })}
          value={asStr(value.entity_type) || "reservation"}
        >
          <option value="reservation">{isEn ? "Reservation" : "Reserva"}</option>
          <option value="lease">{isEn ? "Lease" : "Contrato"}</option>
          <option value="task">{isEn ? "Task" : "Tarea"}</option>
        </Select>
      </Field>
      <Field label={isEn ? "Target status" : "Estado destino"}>
        <Input
          onChange={(e) => onChange({ ...value, target_status: e.target.value })}
          placeholder={isEn ? "e.g. completed" : "ej. completado"}
          value={asStr(value.target_status)}
        />
      </Field>
    </div>
  );
}

export function CreateExpenseConfig({ value, onChange, isEn }: ConfigProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label={isEn ? "Category" : "Categoría"}>
        <Input
          onChange={(e) => onChange({ ...value, category: e.target.value })}
          placeholder={isEn ? "e.g. cleaning" : "ej. limpieza"}
          value={asStr(value.category)}
        />
      </Field>
      <Field label={isEn ? "Description" : "Descripción"}>
        <Input
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          value={asStr(value.description)}
        />
      </Field>
      <Field label={isEn ? "Amount" : "Monto"}>
        <Input
          min={0}
          onChange={(e) => onChange({ ...value, amount: e.target.value ? Number(e.target.value) : undefined })}
          step="0.01"
          type="number"
          value={asNum(value.amount)}
        />
      </Field>
    </div>
  );
}

export function AssignTaskRoundRobinConfig({ value, onChange, isEn }: ConfigProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={isEn ? "Task type" : "Tipo de tarea"}>
        <Select
          onChange={(e) => onChange({ ...value, task_type: e.target.value })}
          value={asStr(value.task_type) || "cleaning"}
        >
          <option value="cleaning">{isEn ? "Cleaning" : "Limpieza"}</option>
          <option value="maintenance">{isEn ? "Maintenance" : "Mantenimiento"}</option>
          <option value="inspection">{isEn ? "Inspection" : "Inspección"}</option>
        </Select>
      </Field>
      <Field label={isEn ? "Priority" : "Prioridad"}>
        <Select
          onChange={(e) => onChange({ ...value, priority: e.target.value })}
          value={asStr(value.priority) || "medium"}
        >
          <option value="low">{isEn ? "Low" : "Baja"}</option>
          <option value="medium">{isEn ? "Medium" : "Media"}</option>
          <option value="high">{isEn ? "High" : "Alta"}</option>
        </Select>
      </Field>
    </div>
  );
}

export function ActionConfigForm({
  actionType,
  value,
  onChange,
  isEn,
}: {
  actionType: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  isEn: boolean;
}) {
  switch (actionType) {
    case "create_task":
      return <CreateTaskConfig isEn={isEn} onChange={onChange} value={value} />;
    case "send_notification":
      return <SendNotificationConfig isEn={isEn} onChange={onChange} value={value} />;
    case "send_whatsapp":
      return <SendWhatsappConfig isEn={isEn} onChange={onChange} value={value} />;
    case "update_status":
      return <UpdateStatusConfig isEn={isEn} onChange={onChange} value={value} />;
    case "create_expense":
      return <CreateExpenseConfig isEn={isEn} onChange={onChange} value={value} />;
    case "assign_task_round_robin":
      return <AssignTaskRoundRobinConfig isEn={isEn} onChange={onChange} value={value} />;
    default:
      return (
        <p className="text-muted-foreground text-xs">
          {isEn
            ? "No structured form for this action type."
            : "No hay formulario estructurado para este tipo de acción."}
        </p>
      );
  }
}
