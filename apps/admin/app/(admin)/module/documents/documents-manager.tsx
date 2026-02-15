"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

type Document = Record<string, unknown>;

function asString(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}

function formatBytes(bytes: unknown): string {
  const n = typeof bytes === "number" ? bytes : Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const CATEGORIES = [
  { value: "lease_contract", en: "Lease Contract", es: "Contrato" },
  { value: "id_document", en: "ID Document", es: "Documento de identidad" },
  { value: "invoice", en: "Invoice", es: "Factura" },
  { value: "receipt", en: "Receipt", es: "Recibo" },
  { value: "photo", en: "Photo", es: "Foto" },
  { value: "inspection_report", en: "Inspection Report", es: "Informe de inspección" },
  { value: "other", en: "Other", es: "Otro" },
];

async function apiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("API error");
  return res.json();
}

async function apiDelete(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error("API error");
  return res.json();
}

export function DocumentsManager({
  data,
  locale,
  orgId,
}: {
  data: Document[];
  locale: string;
  orgId: string;
}) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState("");

  const filtered = data.filter((doc) => {
    if (!filter) return true;
    const name = asString(doc.file_name).toLowerCase();
    const cat = asString(doc.category).toLowerCase();
    const entity = asString(doc.entity_type).toLowerCase();
    return (
      name.includes(filter.toLowerCase()) ||
      cat.includes(filter.toLowerCase()) ||
      entity.includes(filter.toLowerCase())
    );
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/documents", {
        organization_id: orgId,
        entity_type: fd.get("entity_type") || "general",
        entity_id: fd.get("entity_id") || undefined,
        file_name: fd.get("file_name"),
        file_url: fd.get("file_url"),
        category: fd.get("category") || "other",
        mime_type: fd.get("mime_type") || undefined,
      });
      setShowForm(false);
      router.refresh();
    } catch {
      /* ignore */
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(docId: string) {
    if (!confirm(isEn ? "Delete this document?" : "¿Eliminar este documento?"))
      return;
    try {
      await apiDelete(`/documents/${docId}`);
      router.refresh();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          onChange={(e) => setFilter(e.target.value)}
          placeholder={isEn ? "Search documents..." : "Buscar documentos..."}
          value={filter}
        />
        <Button onClick={() => setShowForm(!showForm)} size="sm" type="button">
          {showForm
            ? isEn
              ? "Cancel"
              : "Cancelar"
            : isEn
              ? "Add Document"
              : "Agregar Documento"}
        </Button>
      </div>

      {showForm && (
        <form
          className="bg-muted/50 space-y-3 rounded-lg border p-4"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>{isEn ? "File Name" : "Nombre del archivo"} *</span>
              <Input name="file_name" required />
            </label>
            <label className="space-y-1 text-sm">
              <span>{isEn ? "File URL" : "URL del archivo"} *</span>
              <Input name="file_url" placeholder="https://..." required />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Category" : "Categoría"}</span>
              <Select defaultValue="other" name="category">
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {isEn ? c.en : c.es}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Entity Type" : "Tipo de entidad"}</span>
              <Select defaultValue="general" name="entity_type">
                <option value="general">{isEn ? "General" : "General"}</option>
                <option value="lease">{isEn ? "Lease" : "Contrato"}</option>
                <option value="property">{isEn ? "Property" : "Propiedad"}</option>
                <option value="expense">{isEn ? "Expense" : "Gasto"}</option>
                <option value="maintenance">{isEn ? "Maintenance" : "Mantenimiento"}</option>
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span>{isEn ? "MIME Type" : "Tipo MIME"}</span>
              <Input name="mime_type" placeholder="application/pdf" />
            </label>
          </div>
          <label className="space-y-1 text-sm">
            <span>{isEn ? "Entity ID" : "ID de entidad"}</span>
            <Input name="entity_id" placeholder={isEn ? "Optional UUID" : "UUID opcional"} />
          </label>
          <Button disabled={submitting} size="sm" type="submit">
            {submitting
              ? isEn
                ? "Saving..."
                : "Guardando..."
              : isEn
                ? "Save"
                : "Guardar"}
          </Button>
        </form>
      )}

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {isEn ? "No documents found." : "No se encontraron documentos."}
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {filtered.map((doc) => (
            <div
              className="flex items-center justify-between gap-3 px-4 py-3"
              key={asString(doc.id)}
            >
              <div className="min-w-0 flex-1">
                <a
                  className="truncate font-medium text-blue-600 hover:underline"
                  href={asString(doc.file_url)}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {asString(doc.file_name)}
                </a>
                <p className="text-muted-foreground text-xs">
                  {asString(doc.entity_type)}
                  {asString(doc.entity_id)
                    ? ` · ${asString(doc.entity_id).slice(0, 8)}…`
                    : ""}
                  {" · "}
                  {formatBytes(doc.file_size_bytes)}
                  {" · "}
                  {asString(doc.created_at).slice(0, 10)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge
                  label={asString(doc.category)}
                  value={asString(doc.category)}
                />
                <Button
                  onClick={() => handleDelete(asString(doc.id))}
                  size="sm"
                  variant="ghost"
                >
                  {isEn ? "Delete" : "Eliminar"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
