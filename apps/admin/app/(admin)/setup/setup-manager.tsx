"use client";

import {
  Add01Icon,
  Delete02Icon,
  EyeIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet } from "@/components/ui/sheet";
import { humanizeKey } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  createIntegrationAction,
  createOrganizationAction,
  createPropertyAction,
  createUnitAction,
  deleteIntegrationAction,
  deleteOrganizationAction,
  deletePropertyAction,
  deleteUnitAction,
  syncIntegrationIcalAction,
  updateIntegrationAction,
  updateOrganizationAction,
  updatePropertyAction,
  updateUnitAction,
} from "./actions";

type SetupTab =
  | "organizations"
  | "properties"
  | "units"
  | "integrations";

type SetupManagerProps = {
  orgId: string;
  initialTab?: string | null;
  organizations: DataTableRow[];
  properties: DataTableRow[];
  units: DataTableRow[];
  integrations: DataTableRow[];
};

type EntityKind = "organization" | "property" | "unit" | "integration";
type SheetMode = "create" | "view" | "edit";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRAILING_SLASHES_RE = /\/+$/;

function asString(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === null || value === undefined
      ? ""
      : String(value);
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function isIdKey(key: string): boolean {
  return key === "id" || key.endsWith("_id");
}

function buildPublicIcalUrl(token: string): string {
  const base = API_BASE_URL.replace(TRAILING_SLASHES_RE, "");
  return `${base}/public/ical/${token}.ics`;
}

function sortKeys(keys: string[]): string[] {
  const priority = [
    "id",
    "name",
    "code",
    "status",
    "kind",
    "organization_id",
    "property_id",
    "unit_id",
    "integration_id",
    "external_account_ref",
    "is_active",
    "created_at",
    "updated_at",
  ];

  const score = new Map(priority.map((key, index) => [key, index]));
  return [...keys].sort((a, b) => {
    const aScore = score.has(a)
      ? (score.get(a) as number)
      : Number.POSITIVE_INFINITY;
    const bScore = score.has(b)
      ? (score.get(b) as number)
      : Number.POSITIVE_INFINITY;
    if (aScore !== bScore) return aScore - bScore;
    return a.localeCompare(b);
  });
}

function recordLabel(kind: EntityKind, record: DataTableRow | null): string {
  if (!record) return "";
  if (kind === "organization")
    return asString(record.name || record.legal_name || record.id);
  if (kind === "property")
    return asString(record.name || record.code || record.id);
  if (kind === "unit") return asString(record.name || record.code || record.id);
  if (kind === "integration")
    return asString(
      record.public_name || record.channel_name || record.kind || record.id
    );
  return asString(record.id);
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copiado", { description: shortId(value) });
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("No se pudo copiar", {
        description: "Tu navegador bloqueó el acceso al portapapeles.",
      });
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate font-mono text-foreground text-xs" title={value}>
          {value}
        </p>
      </div>
      <Button onClick={onCopy} size="sm" type="button" variant="outline">
        {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

function RecordDetails({ record }: { record: DataTableRow }) {
  const keys = sortKeys(Object.keys(record));
  return (
    <div className="space-y-4">
      {keys.map((key) => {
        const raw = record[key];
        const value = asString(raw);
        const showCopy =
          typeof raw === "string" && (isIdKey(key) || isUuid(value));

        return (
          <div className="grid gap-2 md:grid-cols-12" key={key}>
            <div className="md:col-span-4">
              <p className="font-medium text-muted-foreground text-xs">
                {humanizeKey(key)}
              </p>
            </div>
            <div className="md:col-span-8">
              {showCopy ? (
                <CopyValue value={value} />
              ) : raw === null || raw === undefined ? (
                <p className="text-muted-foreground text-sm">-</p>
              ) : typeof raw === "object" ? (
                <pre className="max-h-40 overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
                  {JSON.stringify(raw, null, 2)}
                </pre>
              ) : (
                <p className="break-words text-foreground text-sm">{value}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-2 font-medium text-sm transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function toTab(value: string | null | undefined): SetupTab | null {
  if (
    value === "organizations" ||
    value === "properties" ||
    value === "units" ||
    value === "integrations"
  )
    return value;
  return null;
}

export function SetupManager({
  orgId,
  initialTab,
  organizations,
  properties,
  units,
  integrations,
}: SetupManagerProps) {
  const [tab, setTab] = useState<SetupTab>(
    () => toTab(initialTab ?? null) ?? "organizations"
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>("view");
  const [sheetKind, setSheetKind] = useState<EntityKind>("organization");
  const [record, setRecord] = useState<DataTableRow | null>(null);
  const deleteFormRef = useRef<HTMLFormElement | null>(null);

  const propertyOptions = useMemo(
    () =>
      properties
        .map((row) => ({
          id: asString(row.id),
          label: asString(row.name || row.code || row.id),
        }))
        .filter((item) => item.id),
    [properties]
  );

  const unitOptions = useMemo(
    () =>
      units
        .map((row) => ({
          id: asString(row.id),
          label: asString(row.name || row.code || row.id),
        }))
        .filter((item) => item.id),
    [units]
  );

  const openSheet = useCallback(
    (
      nextKind: EntityKind,
      nextMode: SheetMode,
      nextRecord: DataTableRow | null
    ) => {
      setSheetKind(nextKind);
      setSheetMode(nextMode);
      setRecord(nextRecord);
      setSheetOpen(true);
    },
    []
  );

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    window.setTimeout(() => {
      setRecord(null);
      setSheetMode("view");
    }, 200);
  }, []);

  const currentTabLabel =
    tab === "organizations"
      ? "Organizaciones"
      : tab === "properties"
        ? "Propiedades"
        : tab === "units"
          ? "Unidades"
          : "Integraciones";

  const sheetTitle = (() => {
    const labels =
      sheetKind === "organization"
        ? { base: "Organización", create: "Nueva organización" }
        : sheetKind === "property"
          ? { base: "Propiedad", create: "Nueva propiedad" }
          : sheetKind === "unit"
            ? { base: "Unidad", create: "Nueva unidad" }
            : { base: "Integración", create: "Nueva integración" };

    if (sheetMode === "create") return labels.create;
    const label = recordLabel(sheetKind, record);
    if (!label) return `Detalles de ${labels.base.toLowerCase()}`;
    return `${labels.base}: ${label}`;
  })();

  const sheetDescription =
    sheetMode === "create"
      ? "Crea un nuevo registro en Supabase."
      : sheetMode === "edit"
        ? "Edita y guarda cambios en Supabase."
        : "Ver detalles del registro y tomar acciones.";

  const canDelete = sheetMode !== "create" && Boolean(asString(record?.id));

  const renderActions = (kind: EntityKind) =>
    function RowActionsCell(row: DataTableRow) {
      return (
        <div className="flex items-center gap-1">
          <button
            aria-label="Ver detalles"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "h-8 w-8"
            )}
            onClick={() => openSheet(kind, "view", row)}
            title="Ver detalles"
            type="button"
          >
            <Icon icon={EyeIcon} size={16} />
          </button>
          <button
            aria-label="Editar"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "h-8 w-8"
            )}
            onClick={() => openSheet(kind, "edit", row)}
            title="Editar"
            type="button"
          >
            <Icon icon={PencilEdit01Icon} size={16} />
          </button>
        </div>
      );
    };

  const activeRows =
    tab === "organizations"
      ? organizations
      : tab === "properties"
        ? properties
        : tab === "units"
          ? units
          : integrations;

  const cardTitle =
    tab === "organizations"
      ? "Organizaciones"
      : tab === "properties"
        ? "Propiedades"
        : tab === "units"
          ? "Unidades"
          : "Integraciones";

  const cardSubtitle =
    tab === "organizations"
      ? "/organizations"
      : tab === "properties"
        ? "/properties"
        : tab === "units"
          ? "/units"
          : "/integrations";

  const onNew = () => {
    const kind: EntityKind =
      tab === "organizations"
        ? "organization"
        : tab === "properties"
          ? "property"
          : tab === "units"
            ? "unit"
            : "integration";
    openSheet(kind, "create", null);
  };

  const actionsForTab =
    tab === "organizations"
      ? renderActions("organization")
      : tab === "properties"
        ? renderActions("property")
        : tab === "units"
          ? renderActions("unit")
          : renderActions("integration");

  const moduleLink =
    sheetKind === "property"
      ? "/module/properties"
      : sheetKind === "unit"
        ? "/module/units"
        : sheetKind === "integration"
          ? "/module/integrations"
          : null;

  const recordId = asString(record?.id);
  const listingExportToken =
    sheetKind === "integration" ? asString(record?.ical_export_token) : "";
  const listingExportUrl = listingExportToken
    ? buildPublicIcalUrl(listingExportToken)
    : "";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardDescription>Administra datos base</CardDescription>
              <CardTitle>Administrador de configuración</CardTitle>
            </div>
            <Badge className="w-fit" variant="secondary">
              {organizations.length +
                properties.length +
                units.length +
                integrations.length}{" "}
              registros totales
            </Badge>
          </div>

          <div className="flex flex-wrap gap-2 rounded-md border bg-muted/20 p-2">
            <TabButton
              active={tab === "organizations"}
              onClick={() => setTab("organizations")}
            >
              Organizaciones{" "}
              <span className="text-muted-foreground text-xs">
                {organizations.length}
              </span>
            </TabButton>
            <TabButton
              active={tab === "properties"}
              onClick={() => setTab("properties")}
            >
              Propiedades{" "}
              <span className="text-muted-foreground text-xs">
                {properties.length}
              </span>
            </TabButton>
            <TabButton active={tab === "units"} onClick={() => setTab("units")}>
              Unidades{" "}
              <span className="text-muted-foreground text-xs">
                {units.length}
              </span>
            </TabButton>
            <TabButton
              active={tab === "integrations"}
              onClick={() => setTab("integrations")}
            >
              Integraciones{" "}
              <span className="text-muted-foreground text-xs">
                {integrations.length}
              </span>
            </TabButton>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground text-sm">
                {currentTabLabel}
              </p>
              <p className="text-muted-foreground text-sm">
                Agrega, edita y elimina registros. Abre una hoja para ver
                detalles.
              </p>
            </div>
            <Button onClick={onNew}>
              <Icon icon={Add01Icon} size={16} />
              Nuevo
            </Button>
          </div>

          <Separator />

          <div className="min-w-0">
            <DataTable
              data={activeRows}
              renderRowActions={actionsForTab}
              rowActionsHeader=""
              rowHrefBase={`/module/${tab}`}
              searchPlaceholder={`Buscar ${cardTitle.toLowerCase()}...`}
            />
          </div>
        </CardContent>
      </Card>

      <Sheet
        description={sheetDescription}
        footer={
          canDelete ? (
            <form
              action={
                sheetKind === "organization"
                  ? deleteOrganizationAction
                  : sheetKind === "property"
                    ? deletePropertyAction
                    : sheetKind === "unit"
                      ? deleteUnitAction
                      : deleteIntegrationAction
              }
              className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
              ref={deleteFormRef}
            >
              <input name="tab" type="hidden" value={tab} />
              <input name="id" type="hidden" value={recordId} />
              <div className="space-y-1 text-muted-foreground text-xs">
                <p>
                  La eliminación es en cascada (p. ej., al eliminar una
                  propiedad se eliminan sus unidades).
                </p>
                <p>Esta acción no se puede deshacer.</p>
              </div>
              <Button
                onClick={() => {
                  const label = recordLabel(sheetKind, record);
                  const entity =
                    sheetKind === "organization"
                      ? "organización"
                      : sheetKind === "property"
                        ? "propiedad"
                        : sheetKind === "unit"
                          ? "unidad"
                          : "integración";

                  toast("Confirmar eliminación", {
                    description: label
                      ? `Eliminar ${entity}: ${label}`
                      : `Eliminar este ${entity}`,
                    action: {
                      label: "Eliminar",
                      onClick: () => deleteFormRef.current?.requestSubmit(),
                    },
                  });
                }}
                type="button"
                variant="destructive"
              >
                <Icon icon={Delete02Icon} size={16} />
                Eliminar
              </Button>
            </form>
          ) : null
        }
        onOpenChange={(next) => (next ? setSheetOpen(true) : closeSheet())}
        open={sheetOpen}
        title={sheetTitle}
      >
        {moduleLink ? (
          <div className="mb-4">
            <a
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              href={moduleLink}
            >
              Abrir módulo relacionado
            </a>
          </div>
        ) : null}

        {sheetMode === "view" && record ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline">{humanizeKey(sheetKind)}</Badge>
              <Button
                onClick={() => {
                  setSheetMode("edit");
                }}
                size="sm"
                variant="outline"
              >
                <Icon icon={PencilEdit01Icon} size={16} />
                Editar
              </Button>
            </div>

            {sheetKind === "integration" ? (
              <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                <div>
                  <p className="font-medium text-sm">Conexión iCal</p>
                  <p className="text-muted-foreground text-xs">
                    Usa iCal para conectar Airbnb, Booking.com, Vrbo, Google
                    Calendar y otros calendarios de canal.
                  </p>
                </div>

                {listingExportUrl ? (
                  <div className="space-y-1">
                    <p className="font-medium text-xs">
                      URL de exportación (para pegar en un canal)
                    </p>
                    <CopyValue value={listingExportUrl} />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    La URL de exportación no está disponible para este anuncio.
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <a
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" })
                    )}
                    href="/module/integration-events?provider=ical"
                  >
                    Ver eventos de integración
                  </a>
                  <a
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" })
                    )}
                    href="/module/reservations"
                  >
                    Ver reservas
                  </a>
                </div>

                <p className="text-muted-foreground text-xs">
                  Tip: Pega la URL de exportación del canal en{" "}
                  <span className="font-mono">URL de importación iCal</span> y
                  luego haz clic en{" "}
                  <span className="font-mono">
                    Solicitar sincronización iCal
                  </span>{" "}
                  para importar reservas/bloqueos en Stoa.
                </p>
              </div>
            ) : null}

            <RecordDetails record={record} />
          </div>
        ) : null}

        {sheetMode === "create" ? (
          <div className="space-y-4">
            {sheetKind === "organization" ? (
              <form action={createOrganizationAction} className="grid gap-3">
                <input name="tab" type="hidden" value={tab} />
                <div className="grid gap-1">
                  <label className="font-medium text-xs">Nombre</label>
                  <Input
                    name="name"
                    placeholder="Stoa Holdings"
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    Razón social (opcional)
                  </label>
                  <Input name="legal_name" placeholder="Stoa S.A." />
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">RUC (opcional)</label>
                  <Input name="ruc" placeholder="80012345-6" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="font-medium text-xs">
                      Moneda predeterminada
                    </label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      defaultValue="PYG"
                      name="default_currency"
                    >
                      <option value="PYG">PYG</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <label className="font-medium text-xs">Zona horaria</label>
                    <Input defaultValue="America/Asuncion" name="timezone" />
                  </div>
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    Tipo de organización
                  </label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    defaultValue="management_company"
                    name="profile_type"
                    required
                  >
                    <option value="management_company">
                      Empresa administradora
                    </option>
                    <option value="owner_operator">Propietario-operador</option>
                  </select>
                </div>
                <Button type="submit">Crear organización</Button>
              </form>
            ) : null}

            {sheetKind === "property" ? (
              <form action={createPropertyAction} className="grid gap-3">
                <input name="tab" type="hidden" value={tab} />
                <input name="organization_id" type="hidden" value={orgId} />
                <div className="grid gap-1">
                  <label className="font-medium text-xs">Nombre</label>
                  <Input name="name" placeholder="Villa Morra HQ" required />
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    Código (opcional)
                  </label>
                  <Input name="code" placeholder="VM-HQ" />
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    Dirección (opcional)
                  </label>
                  <Input name="address_line1" placeholder="Av. Example 123" />
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    Ciudad (opcional)
                  </label>
                  <Input name="city" placeholder="Asunción" />
                </div>
                <Button type="submit">Crear propiedad</Button>
              </form>
            ) : null}

            {sheetKind === "unit" ? (
              <form action={createUnitAction} className="grid gap-3">
                <input name="tab" type="hidden" value={tab} />
                <input name="organization_id" type="hidden" value={orgId} />
                <div className="grid gap-1">
                  <label className="font-medium text-xs">Propiedad</label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    defaultValue={propertyOptions[0]?.id ?? ""}
                    name="property_id"
                    required
                  >
                    {propertyOptions.length === 0 ? (
                      <option value="">Crea una propiedad primero</option>
                    ) : null}
                    {propertyOptions.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    Código de unidad
                  </label>
                  <Input name="code" placeholder="A1" required />
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    Nombre de unidad
                  </label>
                  <Input name="name" placeholder="Departamento A1" required />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="grid gap-1">
                    <label className="font-medium text-xs">
                      Máx. huéspedes
                    </label>
                    <Input
                      defaultValue={2}
                      min={1}
                      name="max_guests"
                      type="number"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="font-medium text-xs">Dormitorios</label>
                    <Input
                      defaultValue={1}
                      min={0}
                      name="bedrooms"
                      type="number"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="font-medium text-xs">Baños</label>
                    <Input
                      defaultValue={1}
                      min={0}
                      name="bathrooms"
                      step="0.5"
                      type="number"
                    />
                  </div>
                </div>
                <Button disabled={propertyOptions.length === 0} type="submit">
                  Crear unidad
                </Button>
                {propertyOptions.length === 0 ? (
                  <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
                    <p className="text-muted-foreground">
                      Las unidades viven dentro de una propiedad. Crea una
                      propiedad primero.
                    </p>
                    <Button
                      onClick={() => {
                        setTab("properties");
                        openSheet("property", "create", null);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Crear una propiedad
                    </Button>
                  </div>
                ) : null}
              </form>
            ) : null}

            {sheetKind === "integration" ? (
              <form action={createIntegrationAction} className="grid gap-3">
                <input name="tab" type="hidden" value={tab} />
                <input name="organization_id" type="hidden" value={orgId} />

                <div className="grid gap-1">
                  <label className="font-medium text-xs">Unidad</label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    defaultValue={unitOptions[0]?.id ?? ""}
                    name="unit_id"
                    required
                  >
                    {unitOptions.length === 0 ? (
                      <option value="">Crea una unidad primero</option>
                    ) : null}
                    {unitOptions.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-1">
                  <label className="font-medium text-xs">Tipo</label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    defaultValue="airbnb"
                    name="kind"
                    required
                  >
                    <option value="airbnb">Airbnb</option>
                    <option value="bookingcom">Booking.com</option>
                    <option value="direct">Directo</option>
                    <option value="vrbo">Vrbo</option>
                    <option value="other">Otro</option>
                  </select>
                </div>

                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    Nombre del canal
                  </label>
                  <Input name="channel_name" placeholder="Airbnb" required />
                </div>

                <div className="grid gap-1">
                  <label className="font-medium text-xs">Nombre público</label>
                  <Input
                    name="public_name"
                    placeholder="Airbnb - Departamento A1"
                    required
                  />
                </div>

                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    ID externo del anuncio (opcional)
                  </label>
                  <Input name="external_listing_id" placeholder="1234567890" />
                </div>

                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    URL de importación iCal (opcional)
                  </label>
                  <Input
                    name="ical_import_url"
                    placeholder="https://calendar.google.com/calendar/ical/..."
                  />
                </div>

                <Button
                  disabled={unitOptions.length === 0}
                  type="submit"
                >
                  Crear integración
                </Button>

                {unitOptions.length === 0 ? (
                  <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
                    <p className="text-muted-foreground">
                      Las integraciones conectan una unidad con un canal externo.
                      Crea una unidad primero.
                    </p>
                    <Button
                      onClick={() => {
                        setTab("units");
                        openSheet("unit", "create", null);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Crear una unidad
                    </Button>
                  </div>
                ) : null}
              </form>
            ) : null}
          </div>
        ) : null}

        {sheetMode === "edit" && record ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline">Editar</Badge>
              <Button
                onClick={() => {
                  setSheetMode("view");
                }}
                size="sm"
                variant="outline"
              >
                Volver a detalles
              </Button>
            </div>

            {sheetKind === "organization" ? (
              <form action={updateOrganizationAction} className="grid gap-3">
                <input name="tab" type="hidden" value={tab} />
                <input name="id" type="hidden" value={recordId} />
                <div className="grid gap-1">
                  <label className="font-medium text-xs">Nombre</label>
                  <Input
                    defaultValue={asString(record.name)}
                    name="name"
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">Razón social</label>
                  <Input
                    defaultValue={asString(record.legal_name)}
                    name="legal_name"
                  />
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">RUC</label>
                  <Input defaultValue={asString(record.ruc)} name="ruc" />
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    Tipo de organización
                  </label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    defaultValue={
                      asString(record.profile_type) || "management_company"
                    }
                    name="profile_type"
                    required
                  >
                    <option value="management_company">
                      Empresa administradora
                    </option>
                    <option value="owner_operator">Propietario-operador</option>
                  </select>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="font-medium text-xs">
                      Moneda predeterminada
                    </label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      defaultValue={asString(record.default_currency) || "PYG"}
                      name="default_currency"
                    >
                      <option value="PYG">PYG</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <label className="font-medium text-xs">Zona horaria</label>
                    <Input
                      defaultValue={
                        asString(record.timezone) || "America/Asuncion"
                      }
                      name="timezone"
                    />
                  </div>
                </div>
                <Button type="submit">Guardar cambios</Button>
              </form>
            ) : null}

            {sheetKind === "property" ? (
              <form action={updatePropertyAction} className="grid gap-3">
                <input name="tab" type="hidden" value={tab} />
                <input name="id" type="hidden" value={recordId} />
                <div className="grid gap-1">
                  <label className="font-medium text-xs">Nombre</label>
                  <Input
                    defaultValue={asString(record.name)}
                    name="name"
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">Estado</label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    defaultValue={asString(record.status) || "active"}
                    name="status"
                    required
                  >
                    <option value="active">Activo</option>
                    <option value="inactive">Inactivo</option>
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">Dirección</label>
                  <Input
                    defaultValue={asString(record.address_line1)}
                    name="address_line1"
                  />
                </div>
                <div className="grid gap-1">
                  <label className="font-medium text-xs">Ciudad</label>
                  <Input defaultValue={asString(record.city)} name="city" />
                </div>
                <Button type="submit">Guardar cambios</Button>
              </form>
            ) : null}

            {sheetKind === "unit" ? (
              <form action={updateUnitAction} className="grid gap-3">
                <input name="tab" type="hidden" value={tab} />
                <input name="id" type="hidden" value={recordId} />
                <div className="grid gap-1">
                  <label className="font-medium text-xs">Nombre</label>
                  <Input
                    defaultValue={asString(record.name)}
                    name="name"
                    required
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="grid gap-1">
                    <label className="font-medium text-xs">
                      Máx. huéspedes
                    </label>
                    <Input
                      defaultValue={asString(record.max_guests) || "2"}
                      min={1}
                      name="max_guests"
                      type="number"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="font-medium text-xs">Dormitorios</label>
                    <Input
                      defaultValue={asString(record.bedrooms) || "1"}
                      min={0}
                      name="bedrooms"
                      type="number"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="font-medium text-xs">Baños</label>
                    <Input
                      defaultValue={asString(record.bathrooms) || "1"}
                      min={0}
                      name="bathrooms"
                      step="0.5"
                      type="number"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
                  <div>
                    <p className="font-medium text-sm">Activo</p>
                    <p className="text-muted-foreground text-xs">
                      Oculta unidades inactivas de la mayoría de flujos.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      className="h-4 w-4"
                      defaultChecked={Boolean(record.is_active ?? true)}
                      name="is_active"
                      type="checkbox"
                      value="true"
                    />
                    <input name="is_active" type="hidden" value="false" />
                  </div>
                </div>
                <Button type="submit">Guardar cambios</Button>
              </form>
            ) : null}

            {sheetKind === "integration" ? (
              <form action={updateIntegrationAction} className="grid gap-3">
                <input name="tab" type="hidden" value={tab} />
                <input name="id" type="hidden" value={recordId} />

                <div className="grid gap-1">
                  <label className="font-medium text-xs">Tipo</label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    defaultValue={asString(record.kind) || "airbnb"}
                    name="kind"
                    required
                  >
                    <option value="airbnb">Airbnb</option>
                    <option value="bookingcom">Booking.com</option>
                    <option value="direct">Directo</option>
                    <option value="vrbo">Vrbo</option>
                    <option value="other">Otro</option>
                  </select>
                </div>

                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    Nombre del canal
                  </label>
                  <Input
                    defaultValue={asString(record.channel_name)}
                    name="channel_name"
                    required
                  />
                </div>

                <div className="grid gap-1">
                  <label className="font-medium text-xs">Nombre público</label>
                  <Input
                    defaultValue={asString(record.public_name)}
                    name="public_name"
                    required
                  />
                </div>

                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    Ref. de cuenta externa
                  </label>
                  <Input
                    defaultValue={asString(record.external_account_ref)}
                    name="external_account_ref"
                  />
                </div>

                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    ID externo del anuncio
                  </label>
                  <Input
                    defaultValue={asString(record.external_listing_id)}
                    name="external_listing_id"
                  />
                </div>

                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    URL de importación iCal
                  </label>
                  <Input
                    defaultValue={asString(record.ical_import_url)}
                    name="ical_import_url"
                  />
                </div>

                <div className="grid gap-1">
                  <label className="font-medium text-xs">
                    URL de exportación iCal
                  </label>
                  {listingExportUrl ? (
                    <CopyValue value={listingExportUrl} />
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Guarda la integración primero para generar una URL de
                      exportación.
                    </p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    Pega esto en Airbnb (u otro canal) como un calendario
                    importado para bloquear fechas.
                  </p>
                </div>

                <p className="text-muted-foreground text-xs">
                  Tip: Solicitar una sincronización creará un evento de
                  integración que puedes revisar en{" "}
                  <span className="font-mono">Eventos de integración</span>.
                </p>

                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
                  <div>
                    <p className="font-medium text-sm">Activo</p>
                    <p className="text-muted-foreground text-xs">
                      Desactiva integraciones que ya no sincronizas.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      className="h-4 w-4"
                      defaultChecked={Boolean(record.is_active ?? true)}
                      name="is_active"
                      type="checkbox"
                      value="true"
                    />
                    <input name="is_active" type="hidden" value="false" />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit">Guardar cambios</Button>
                  <Button
                    disabled={!asString(record.ical_import_url).trim()}
                    formAction={syncIntegrationIcalAction}
                    type="submit"
                    variant="outline"
                  >
                    Solicitar sincronización iCal
                  </Button>
                  <a
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" })
                    )}
                    href="/module/integration-events?provider=ical"
                  >
                    Ver eventos
                  </a>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}

        {sheetMode !== "create" && !record ? (
          <p className="text-muted-foreground text-sm">
            Selecciona un registro.
          </p>
        ) : null}
      </Sheet>

      <p className="text-muted-foreground text-xs">
        Tip: Este administrador usa{" "}
        <span className="font-mono">{cardSubtitle}</span>. Para la operación
        diaria, usa la sección de Módulos.
      </p>
    </div>
  );
}
