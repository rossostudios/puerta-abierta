"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { authedFetch } from "@/lib/api-client";
import { useActiveLocale } from "@/lib/i18n/client";

function asString(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}

type TabKey = "channels" | "events";

const KIND_OPTIONS = [
  { value: "ical", label: "iCal" },
  { value: "airbnb", label: "Airbnb" },
  { value: "booking", label: "Booking.com" },
  { value: "direct", label: "Direct" },
];

export function IntegrationsManager({
  integrations,
  units,
  events,
  locale: _locale,
  orgId,
}: {
  integrations: Record<string, unknown>[];
  units: Record<string, unknown>[];
  events: Record<string, unknown>[];
  locale: string;
  orgId: string;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>("channels");
  const [createOpen, setCreateOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Create form state
  const [formUnitId, setFormUnitId] = useState("");
  const [formKind, setFormKind] = useState("ical");
  const [formChannel, setFormChannel] = useState("");
  const [formIcalUrl, setFormIcalUrl] = useState("");
  const [formExternalId, setFormExternalId] = useState("");

  const unitOptions = useMemo(
    () =>
      units.map((u) => ({
        id: asString(u.id),
        label: asString(u.name) || asString(u.id).slice(0, 8),
      })),
    [units]
  );

  const unitNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) {
      m.set(asString(u.id), asString(u.name) || asString(u.id).slice(0, 8));
    }
    return m;
  }, [units]);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await authedFetch("/integrations", {
        method: "POST",
        body: JSON.stringify({
          organization_id: orgId,
          unit_id: formUnitId || undefined,
          kind: formKind,
          channel_name: formChannel || undefined,
          ical_import_url: formKind === "ical" ? formIcalUrl : undefined,
          external_listing_id: formExternalId || undefined,
        }),
      });
      toast.success(isEn ? "Integration created" : "Integración creada");
      setCreateOpen(false);
      setFormUnitId("");
      setFormKind("ical");
      setFormChannel("");
      setFormIcalUrl("");
      setFormExternalId("");
      router.refresh();
    } catch {
      toast.error(isEn ? "Failed to create integration" : "Error al crear integración");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSync(integrationId: string) {
    setSyncingId(integrationId);
    try {
      await authedFetch(`/integrations/${integrationId}/sync-ical`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success(isEn ? "iCal sync started" : "Sincronización iCal iniciada");
      router.refresh();
    } catch {
      toast.error(isEn ? "Sync failed" : "Fallo la sincronización");
    } finally {
      setSyncingId(null);
    }
  }

  async function handleDelete(integrationId: string) {
    if (!confirm(isEn ? "Delete this integration?" : "¿Eliminar esta integración?"))
      return;
    try {
      await authedFetch(`/integrations/${integrationId}`, { method: "DELETE" });
      toast.success(isEn ? "Integration deleted" : "Integración eliminada");
      router.refresh();
    } catch {
      toast.error(isEn ? "Delete failed" : "Error al eliminar");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border">
          <button
            className={`px-3 py-1 text-xs font-medium transition-colors ${tab === "channels" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab("channels")}
            type="button"
          >
            {isEn ? "Channels" : "Canales"}
          </button>
          <button
            className={`px-3 py-1 text-xs font-medium transition-colors ${tab === "events" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab("events")}
            type="button"
          >
            {isEn ? "Events" : "Eventos"}
          </button>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm" type="button">
          <Icon icon={PlusSignIcon} size={16} />
          {isEn ? "New integration" : "Nueva integración"}
        </Button>
      </div>

      {tab === "channels" && (
        <>
          {integrations.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {isEn
                ? "No integrations configured yet."
                : "No hay integraciones configuradas."}
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {integrations.map((row) => {
                const id = asString(row.id);
                const unitId = asString(row.unit_id);
                const kind = asString(row.kind);
                const syncStatus = asString(row.sync_status) || "unknown";
                const lastSynced = asString(row.last_synced_at);

                return (
                  <div
                    className="flex items-center justify-between gap-3 px-4 py-3"
                    key={id}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {unitNameMap.get(unitId) || unitId.slice(0, 8)}
                        {" \u00b7 "}
                        <span className="text-muted-foreground">
                          {asString(row.channel_name) || kind}
                        </span>
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {kind.toUpperCase()}
                        {asString(row.external_listing_id)
                          ? ` \u00b7 ${asString(row.external_listing_id)}`
                          : ""}
                        {lastSynced
                          ? ` \u00b7 ${isEn ? "Synced" : "Sincr."} ${lastSynced.slice(0, 16).replace("T", " ")}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge label={syncStatus} value={syncStatus} />
                      {kind === "ical" && (
                        <Button
                          disabled={syncingId === id}
                          onClick={() => handleSync(id)}
                          size="sm"
                          variant="outline"
                        >
                          {syncingId === id
                            ? isEn ? "Syncing..." : "Sincronizando..."
                            : isEn ? "Sync iCal" : "Sincronizar"}
                        </Button>
                      )}
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
        </>
      )}

      {tab === "events" && (
        <>
          {events.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {isEn ? "No integration events yet." : "No hay eventos de integración."}
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {events.map((evt) => {
                const id = asString(evt.id);
                const provider = asString(evt.provider);
                const eventType = asString(evt.event_type);
                const status = asString(evt.status) || "received";
                const createdAt = asString(evt.created_at);

                return (
                  <div
                    className="flex items-center justify-between gap-3 px-4 py-3"
                    key={id}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {provider || "—"}
                        {" \u00b7 "}
                        <span className="text-muted-foreground">{eventType}</span>
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {createdAt ? createdAt.slice(0, 16).replace("T", " ") : ""}
                        {asString(evt.external_event_id)
                          ? ` \u00b7 ${asString(evt.external_event_id)}`
                          : ""}
                      </p>
                    </div>
                    <StatusBadge label={status} value={status} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Create Sheet */}
      <Sheet
        contentClassName="max-w-md"
        description={
          isEn
            ? "Connect a unit to an external channel."
            : "Conecta una unidad a un canal externo."
        }
        onOpenChange={setCreateOpen}
        open={createOpen}
        title={isEn ? "New integration" : "Nueva integración"}
      >
        <form className="space-y-4" onSubmit={handleCreate}>
          <label className="space-y-1 text-sm">
            <span>{isEn ? "Unit" : "Unidad"}</span>
            <Select
              onChange={(e) => setFormUnitId(e.target.value)}
              value={formUnitId}
            >
              <option value="">
                {isEn ? "Select unit..." : "Seleccionar unidad..."}
              </option>
              {unitOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Kind" : "Tipo"}</span>
            <Select
              onChange={(e) => setFormKind(e.target.value)}
              value={formKind}
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Channel name" : "Nombre del canal"}</span>
            <Input
              onChange={(e) => setFormChannel(e.target.value)}
              placeholder={isEn ? "e.g. Airbnb Main" : "ej. Airbnb Principal"}
              value={formChannel}
            />
          </label>

          {formKind === "ical" && (
            <label className="space-y-1 text-sm">
              <span>{isEn ? "iCal import URL" : "URL de importación iCal"}</span>
              <Input
                onChange={(e) => setFormIcalUrl(e.target.value)}
                placeholder="https://..."
                type="url"
                value={formIcalUrl}
              />
            </label>
          )}

          <label className="space-y-1 text-sm">
            <span>{isEn ? "External listing ID" : "ID del listado externo"}</span>
            <Input
              onChange={(e) => setFormExternalId(e.target.value)}
              placeholder={isEn ? "Optional" : "Opcional"}
              value={formExternalId}
            />
          </label>

          <div className="flex justify-end">
            <Button disabled={submitting} type="submit">
              {submitting
                ? isEn ? "Creating..." : "Creando..."
                : isEn ? "Create" : "Crear"}
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
