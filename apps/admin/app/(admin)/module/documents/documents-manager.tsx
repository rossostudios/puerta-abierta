"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { authedFetch } from "@/lib/api-client";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

import { DocumentPreview } from "./document-preview";
import { DocumentUpload } from "./document-upload";

type Document = Record<string, unknown>;

function asString(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}

function formatBytes(bytes: unknown): string {
  const n = typeof bytes === "number" ? bytes : Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "\u2014";
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
  {
    value: "inspection_report",
    en: "Inspection Report",
    es: "Informe de inspección",
  },
  { value: "other", en: "Other", es: "Otro" },
];

const EMPTY_RECORDS: Record<string, unknown>[] = [];

const ENTITY_TYPES = [
  { value: "general", en: "General", es: "General" },
  { value: "property", en: "Property", es: "Propiedad" },
  { value: "lease", en: "Lease", es: "Contrato" },
  { value: "guest", en: "Guest", es: "Huésped" },
  { value: "expense", en: "Expense", es: "Gasto" },
  { value: "maintenance", en: "Maintenance", es: "Mantenimiento" },
];

export function DocumentsManager({
  data,
  locale: _locale,
  orgId,
  properties = EMPTY_RECORDS,
  leases = EMPTY_RECORDS,
  guests = EMPTY_RECORDS,
}: {
  data: Document[];
  locale: string;
  orgId: string;
  properties?: Record<string, unknown>[];
  leases?: Record<string, unknown>[];
  guests?: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const router = useRouter();

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  // Create form state
  const [formFileName, setFormFileName] = useState("");
  const [formFileUrl, setFormFileUrl] = useState("");
  const [formCategory, setFormCategory] = useState("other");
  const [formEntityType, setFormEntityType] = useState("general");
  const [formEntityId, setFormEntityId] = useState("");
  const [formMimeType, setFormMimeType] = useState("");

  // Preview state
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);

  const filtered = useMemo(() => {
    return data.filter((doc) => {
      if (categoryFilter && asString(doc.category) !== categoryFilter)
        return false;
      if (!filter) return true;
      const q = filter.toLowerCase();
      const name = asString(doc.file_name).toLowerCase();
      const cat = asString(doc.category).toLowerCase();
      const entity = asString(doc.entity_type).toLowerCase();
      return name.includes(q) || cat.includes(q) || entity.includes(q);
    });
  }, [data, filter, categoryFilter]);

  const entityOptions = useMemo(() => {
    if (formEntityType === "property") {
      return properties.map((p) => ({
        id: asString(p.id),
        label: asString(p.name) || asString(p.id).slice(0, 8),
      }));
    }
    if (formEntityType === "lease") {
      return leases.map((l) => ({
        id: asString(l.id),
        label: asString(l.tenant_full_name) || asString(l.id).slice(0, 8),
      }));
    }
    if (formEntityType === "guest") {
      return guests.map((g) => ({
        id: asString(g.id),
        label:
          [asString(g.first_name), asString(g.last_name)]
            .filter(Boolean)
            .join(" ") || asString(g.id).slice(0, 8),
      }));
    }
    return [];
  }, [formEntityType, properties, leases, guests]);

  const handleUpload = useCallback(
    (file: { url: string; name: string; mimeType: string; size: number }) => {
      setFormFileUrl(file.url);
      setFormFileName(file.name);
      setFormMimeType(file.mimeType);
    },
    []
  );

  function resetForm() {
    setFormFileName("");
    setFormFileUrl("");
    setFormCategory("other");
    setFormEntityType("general");
    setFormEntityId("");
    setFormMimeType("");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const entityType = formEntityType ? formEntityType : "general";
    const entityId = formEntityId ? formEntityId : undefined;
    const category = formCategory ? formCategory : "other";
    const mimeType = formMimeType ? formMimeType : undefined;
    try {
      await authedFetch("/documents", {
        method: "POST",
        body: JSON.stringify({
          organization_id: orgId,
          entity_type: entityType,
          entity_id: entityId,
          file_name: formFileName,
          file_url: formFileUrl,
          category,
          mime_type: mimeType,
        }),
      });
      let savedMsg: string;
      if (isEn) {
        savedMsg = "Document saved";
      } else {
        savedMsg = "Documento guardado";
      }
      toast.success(savedMsg);
      setShowForm(false);
      resetForm();
      router.refresh();
      setSubmitting(false);
    } catch {
      let saveErrMsg: string;
      if (isEn) {
        saveErrMsg = "Failed to save document";
      } else {
        saveErrMsg = "Error al guardar documento";
      }
      toast.error(saveErrMsg);
      setSubmitting(false);
    }
  }

  async function deleteDocument(docId: string) {
    try {
      await authedFetch(`/documents/${docId}`, { method: "DELETE" });
      let delMsg: string;
      if (isEn) {
        delMsg = "Document deleted";
      } else {
        delMsg = "Documento eliminado";
      }
      toast.success(delMsg);
      router.refresh();
    } catch {
      let delErrMsg: string;
      if (isEn) {
        delErrMsg = "Delete failed";
      } else {
        delErrMsg = "Error al eliminar";
      }
      toast.error(delErrMsg);
    }
  }

  function handleDelete(docId: string) {
    toast(isEn ? "Delete this document?" : "¿Eliminar este documento?", {
      action: {
        label: isEn ? "Delete" : "Eliminar",
        onClick: async () => {
          await deleteDocument(docId);
        },
      },
    });
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
        <Button
          onClick={() => {
            if (showForm) resetForm();
            setShowForm(!showForm);
          }}
          size="sm"
          type="button"
        >
          <Icon icon={PlusSignIcon} size={16} />
          {showForm
            ? isEn
              ? "Cancel"
              : "Cancelar"
            : isEn
              ? "Add Document"
              : "Agregar Documento"}
        </Button>
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          className={cn(
            "rounded-full border px-3 py-1 font-medium text-xs transition-colors",
            categoryFilter
              ? "bg-background text-muted-foreground hover:text-foreground"
              : "border-primary/30 bg-primary/10 text-foreground"
          )}
          onClick={() => setCategoryFilter("")}
          type="button"
        >
          {isEn ? "All" : "Todos"}
        </button>
        {CATEGORIES.map((cat) => (
          <button
            className={cn(
              "rounded-full border px-3 py-1 font-medium text-xs transition-colors",
              categoryFilter === cat.value
                ? "border-primary/30 bg-primary/10 text-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            )}
            key={cat.value}
            onClick={() =>
              setCategoryFilter(cat.value === categoryFilter ? "" : cat.value)
            }
            type="button"
          >
            {isEn ? cat.en : cat.es}
          </button>
        ))}
      </div>

      {/* Create form */}
      {showForm && (
        <form
          className="space-y-3 rounded-lg border bg-muted/50 p-4"
          onSubmit={handleSubmit}
        >
          <DocumentUpload isEn={isEn} onUploaded={handleUpload} orgId={orgId} />

          {formFileUrl && (
            <p className="truncate text-muted-foreground text-xs">
              {formFileName}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>{isEn ? "File Name" : "Nombre del archivo"} *</span>
              <Input
                onChange={(e) => setFormFileName(e.target.value)}
                required
                value={formFileName}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>{isEn ? "File URL" : "URL del archivo"} *</span>
              <Input
                onChange={(e) => setFormFileUrl(e.target.value)}
                placeholder="https://..."
                required
                value={formFileUrl}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Category" : "Categoría"}</span>
              <Select
                onChange={(e) => setFormCategory(e.target.value)}
                value={formCategory}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {isEn ? c.en : c.es}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Entity Type" : "Tipo de entidad"}</span>
              <Select
                onChange={(e) => {
                  setFormEntityType(e.target.value);
                  setFormEntityId("");
                }}
                value={formEntityType}
              >
                {ENTITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {isEn ? t.en : t.es}
                  </option>
                ))}
              </Select>
            </label>
            {entityOptions.length > 0 ? (
              <label className="space-y-1 text-sm">
                <span>{isEn ? "Entity" : "Entidad"}</span>
                <Select
                  onChange={(e) => setFormEntityId(e.target.value)}
                  value={formEntityId}
                >
                  <option value="">
                    {isEn ? "Select..." : "Seleccionar..."}
                  </option>
                  {entityOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <label className="space-y-1 text-sm">
                <span>{isEn ? "Entity ID" : "ID de entidad"}</span>
                <Input
                  onChange={(e) => setFormEntityId(e.target.value)}
                  placeholder={isEn ? "Optional UUID" : "UUID opcional"}
                  value={formEntityId}
                />
              </label>
            )}
          </div>

          <Button disabled={submitting || !formFileUrl} size="sm" type="submit">
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

      {/* Document list */}
      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {isEn ? "No documents found." : "No se encontraron documentos."}
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {filtered.map((doc) => {
            const id = asString(doc.id);
            return (
              <div
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
                key={id}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setPreviewDoc(doc)}
                  type="button"
                >
                  <p className="truncate font-medium text-foreground">
                    {asString(doc.file_name)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {asString(doc.entity_type)}
                    {asString(doc.entity_id)
                      ? ` \u00b7 ${asString(doc.entity_id).slice(0, 8)}\u2026`
                      : ""}
                    {" \u00b7 "}
                    {formatBytes(doc.file_size_bytes)}
                    {" \u00b7 "}
                    {asString(doc.created_at).slice(0, 10)}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    label={asString(doc.category)}
                    value={asString(doc.category)}
                  />
                  <Button
                    onClick={() => handleDelete(id)}
                    size="sm"
                    variant="ghost"
                  >
                    {isEn ? "Delete" : "Eliminar"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Sheet */}
      {previewDoc && (
        <DocumentPreview
          fileName={asString(previewDoc.file_name)}
          fileUrl={asString(previewDoc.file_url)}
          isEn={isEn}
          mimeType={asString(previewDoc.mime_type)}
          onOpenChange={(next) => {
            if (!next) setPreviewDoc(null);
          }}
          open
        />
      )}
    </div>
  );
}
