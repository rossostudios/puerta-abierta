"use client";

import { Edit02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
} from "react";

import {
  acceptRenewalAction,
  createLeaseAction,
  generateCollectionsAction,
  renewLeaseAction,
  sendRenewalOfferAction,
  setLeaseStatusAction,
  updateLeaseAction,
} from "@/app/(admin)/module/leases/actions";
import {
  generateLeaseContractPdf,
  type LeaseContractData,
} from "@/components/reports/lease-contract-pdf";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { type DataTableRow } from "@/components/ui/data-table";
import { NotionDataTable } from "@/components/ui/notion-data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { authedFetch } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Paraguay IVA rate for residential rentals
// ---------------------------------------------------------------------------
const PY_RESIDENTIAL_IVA_RATE = 0.05;

// ---------------------------------------------------------------------------
// Guest type for tenant picker
// ---------------------------------------------------------------------------
type GuestResult = {
  id: string;
  full_name: string;
  email?: string | null;
  phone_e164?: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canActivate(status: string): boolean {
  return status.trim().toLowerCase() === "draft";
}

function canTerminate(status: string): boolean {
  return ["active", "delinquent"].includes(status.trim().toLowerCase());
}

function canComplete(status: string): boolean {
  return status.trim().toLowerCase() === "terminated";
}

function statusLabel(value: string, isEn: boolean): string {
  const normalized = value.trim().toLowerCase();
  if (isEn) return normalized || "unknown";

  if (normalized === "draft") return "Borrador";
  if (normalized === "active") return "Activo";
  if (normalized === "delinquent") return "Moroso";
  if (normalized === "terminated") return "Terminado";
  if (normalized === "completed") return "Completado";

  return normalized || "desconocido";
}

type LeaseRow = DataTableRow & {
  id: string;
  lease_status: string;
  lease_status_label: string;
  renewal_status: string;
  tenant_full_name: string;
  tenant_email: string | null;
  tenant_phone_e164: string | null;
  property_id: string | null;
  unit_id: string | null;
  starts_on: string;
  ends_on: string | null;
  currency: string;
  monthly_rent: number;
  service_fee_flat: number;
  security_deposit: number;
  guarantee_option_fee: number;
  tax_iva: number;
  platform_fee: number;
  notes: string | null;
};

export function LeasesManager({
  orgId,
  leases,
  properties,
  units,
}: {
  orgId: string;
  leases: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  units: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => {
    const suffix = searchParams.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  }, [pathname, searchParams]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LeaseRow | null>(null);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const openCreate = useCallback(() => {
    setEditing(null);
    setOpen(true);
  }, []);

  const openEdit = useCallback((row: LeaseRow) => {
    setEditing(row);
    setOpen(true);
  }, []);

  const [generatingFor, setGeneratingFor] = useState<LeaseRow | null>(null);
  const [renewingFrom, setRenewingFrom] = useState<LeaseRow | null>(null);

  // ── Tenant picker state ──
  const [tenantName, setTenantName] = useState("");
  const [tenantEmail, setTenantEmail] = useState("");
  const [tenantPhone, setTenantPhone] = useState("");
  const [guestResults, setGuestResults] = useState<GuestResult[]>([]);
  const [showGuestDropdown, setShowGuestDropdown] = useState(false);
  const [saveAsGuest, setSaveAsGuest] = useState(false);
  const guestSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Reset tenant fields when sheet opens/closes or editing changes
  useEffect(() => {
    if (open) {
      setTenantName(editing?.tenant_full_name ?? "");
      setTenantEmail(editing?.tenant_email ?? "");
      setTenantPhone(editing?.tenant_phone_e164 ?? "");
      setSaveAsGuest(false);
      setGuestResults([]);
      setShowGuestDropdown(false);
    }
  }, [open, editing]);

  const searchGuests = useCallback(
    (query: string) => {
      if (guestSearchTimer.current) clearTimeout(guestSearchTimer.current);
      if (query.length < 2) {
        setGuestResults([]);
        setShowGuestDropdown(false);
        return;
      }
      guestSearchTimer.current = setTimeout(async () => {
        try {
          const params = new URLSearchParams({
            organization_id: orgId,
            q: query,
          });
          const data = await authedFetch<GuestResult[]>(
            `/guests?${params.toString()}`
          );
          setGuestResults(data ?? []);
          setShowGuestDropdown((data ?? []).length > 0);
        } catch {
          setGuestResults([]);
          setShowGuestDropdown(false);
        }
      }, 300);
    },
    [orgId]
  );

  const selectGuest = useCallback((guest: GuestResult) => {
    setTenantName(guest.full_name);
    setTenantEmail(guest.email ?? "");
    setTenantPhone(guest.phone_e164 ?? "");
    setShowGuestDropdown(false);
    setSaveAsGuest(false);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowGuestDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── IVA auto-calc ref ──
  const rentInputRef = useRef<HTMLInputElement | null>(null);
  const ivaInputRef = useRef<HTMLInputElement | null>(null);

  const autoCalcIva = useCallback(() => {
    const rentValue = rentInputRef.current?.value;
    const rent = Number(rentValue);
    if (Number.isFinite(rent) && rent > 0 && ivaInputRef.current) {
      const iva = Math.round(rent * PY_RESIDENTIAL_IVA_RATE * 100) / 100;
      ivaInputRef.current.value = String(iva);
      // Trigger React's onChange for controlled components
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(ivaInputRef.current, String(iva));
      ivaInputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, []);

  function canRenew(status: string): boolean {
    return ["active", "completed"].includes(status.trim().toLowerCase());
  }

  const rows = useMemo<LeaseRow[]>(() => {
    return leases.map((row) => {
      const status = asString(row.lease_status).trim();
      return {
        id: asString(row.id).trim(),
        tenant_full_name: asString(row.tenant_full_name).trim(),
        tenant_email: asString(row.tenant_email).trim() || null,
        tenant_phone_e164: asString(row.tenant_phone_e164).trim() || null,
        lease_status: status,
        lease_status_label: statusLabel(status, isEn),
        renewal_status: asString(row.renewal_status).trim(),
        property_id: asString(row.property_id).trim() || null,
        property_name: asString(row.property_name).trim() || null,
        unit_id: asString(row.unit_id).trim() || null,
        unit_name: asString(row.unit_name).trim() || null,
        starts_on: asString(row.starts_on).trim(),
        ends_on: asString(row.ends_on).trim() || null,
        currency: asString(row.currency).trim().toUpperCase() || "PYG",
        monthly_rent: asNumber(row.monthly_rent),
        service_fee_flat: asNumber(row.service_fee_flat),
        security_deposit: asNumber(row.security_deposit),
        guarantee_option_fee: asNumber(row.guarantee_option_fee),
        tax_iva: asNumber(row.tax_iva),
        platform_fee: asNumber(row.platform_fee),
        total_move_in: asNumber(row.total_move_in),
        monthly_recurring_total: asNumber(row.monthly_recurring_total),
        collection_count: asNumber(row.collection_count),
        collection_paid_count: asNumber(row.collection_paid_count),
        notes: asString(row.notes).trim() || null,
      } satisfies LeaseRow;
    });
  }, [leases, isEn]);

  const [optimisticRows, queueOptimisticRowUpdate] = useOptimistic(
    rows,
    (
      currentRows,
      action: { type: "set-status"; leaseId: string; nextStatus: string }
    ) => {
      return currentRows.map((row) => {
        if (row.id !== action.leaseId) return row;
        return {
          ...row,
          lease_status: action.nextStatus,
          lease_status_label: statusLabel(action.nextStatus, isEn),
        };
      });
    }
  );

  const columns = useMemo<ColumnDef<DataTableRow>[]>(() => {
    return [
      {
        accessorKey: "tenant_full_name",
        header: isEn ? "Tenant" : "Inquilino",
        cell: ({ row, getValue }) => {
          const name = asString(getValue());
          const email = asString(row.original.tenant_email).trim();
          const phone = asString(row.original.tenant_phone_e164).trim();
          return (
            <div className="space-y-1">
              <p className="font-medium">{name}</p>
              {email ? (
                <p className="text-muted-foreground text-xs">{email}</p>
              ) : null}
              {phone ? (
                <p className="text-muted-foreground text-xs">{phone}</p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "lease_status_label",
        header: isEn ? "Status" : "Estado",
        cell: ({ row, getValue }) => (
          <StatusBadge
            label={asString(getValue())}
            value={asString(row.original.lease_status)}
          />
        ),
      },
      {
        accessorKey: "property_name",
        header: isEn ? "Property / Unit" : "Propiedad / Unidad",
        cell: ({ row }) => {
          const property = asString(row.original.property_name).trim();
          const unit = asString(row.original.unit_name).trim();
          return (
            <p className="text-sm">
              {[property, unit].filter(Boolean).join(" · ") || "-"}
            </p>
          );
        },
      },
      {
        accessorKey: "starts_on",
        header: isEn ? "Start" : "Inicio",
      },
      {
        accessorKey: "monthly_recurring_total",
        header: isEn ? "Monthly recurring" : "Mensual recurrente",
        cell: ({ row, getValue }) =>
          formatCurrency(
            asNumber(getValue()),
            asString(row.original.currency),
            locale
          ),
      },
      {
        accessorKey: "collection_paid_count",
        header: isEn ? "Collections paid" : "Cobros pagados",
        cell: ({ row, getValue }) => {
          const paid = asNumber(getValue());
          const total = asNumber(row.original.collection_count);
          return `${paid}/${total}`;
        },
      },
    ];
  }, [isEn, locale]);

  const propertyOptions = useMemo(() => {
    return properties
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        return {
          id,
          label: asString(row.name).trim() || id,
        };
      })
      .filter((row): row is { id: string; label: string } => Boolean(row));
  }, [properties]);

  const unitOptions = useMemo(() => {
    return units
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        const unitName = asString(row.name).trim();
        const propertyName = asString(row.property_name).trim();
        return {
          id,
          label: [propertyName, unitName || id].filter(Boolean).join(" · "),
        };
      })
      .filter((row): row is { id: string; label: string } => Boolean(row));
  }, [units]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {optimisticRows.length} {isEn ? "leases" : "contratos"}
        </p>
        <Button onClick={openCreate} type="button">
          <Icon icon={PlusSignIcon} size={16} />
          {isEn ? "New lease" : "Nuevo contrato"}
        </Button>
      </div>

      <NotionDataTable
        columns={columns}
        data={optimisticRows}
        hideSearch
        isEn={isEn}
        renderRowActions={(row) => {
          const id = asString(row.id);
          const status = asString(row.lease_status);

          const handleDownloadContract = async () => {
            const unitId = asString(row.unit_id);
            const unit = units.find((u) => asString(u.id) === unitId);
            const propId = asString(unit?.property_id ?? row.property_id);
            const prop = properties.find((p) => asString(p.id) === propId);

            const contractData: LeaseContractData = {
              tenantName: asString(row.tenant_full_name),
              tenantEmail: asString(row.tenant_email),
              tenantPhone: asString(row.tenant_phone_e164),
              propertyName: asString(prop?.name),
              unitName: asString(unit?.name ?? unit?.code),
              startsOn: asString(row.starts_on),
              endsOn: asString(row.ends_on),
              monthlyRent: asNumber(row.monthly_rent),
              serviceFee: asNumber(row.service_fee_flat),
              securityDeposit: asNumber(row.security_deposit),
              guaranteeFee: asNumber(row.guarantee_option_fee),
              taxIva: asNumber(row.tax_iva),
              totalMoveIn: asNumber(row.total_move_in),
              monthlyTotal: asNumber(row.monthly_recurring_total),
              currency: asString(row.currency) || "PYG",
              notes: asString(row.notes),
              orgName: "Casaora",
            };
            await generateLeaseContractPdf(contractData, isEn);
          };

          return (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openEdit(row as unknown as LeaseRow)}
              >
                <Icon icon={Edit02Icon} size={14} />
                {isEn ? "Edit" : "Editar"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDownloadContract}
              >
                {isEn ? "Contract" : "Contrato"}
              </Button>
              <Link
                className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
                href="/module/collections"
              >
                {isEn ? "Collections" : "Cobros"}
              </Link>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setGeneratingFor(row as unknown as LeaseRow)
                }
              >
                {isEn ? "Generate" : "Generar"}
              </Button>

              {canRenew(status) && !(row as unknown as LeaseRow).renewal_status ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setRenewingFrom(row as unknown as LeaseRow)
                  }
                >
                  {isEn ? "Renew" : "Renovar"}
                </Button>
              ) : null}

              {canRenew(status) && !(row as unknown as LeaseRow).renewal_status ? (
                <Form action={sendRenewalOfferAction}>
                  <input name="lease_id" type="hidden" value={id} />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="outline">
                    {isEn ? "Send Offer" : "Enviar Oferta"}
                  </Button>
                </Form>
              ) : null}

              {(row as unknown as LeaseRow).renewal_status === "offered" || (row as unknown as LeaseRow).renewal_status === "pending" ? (
                <Form action={acceptRenewalAction}>
                  <input name="lease_id" type="hidden" value={id} />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="secondary">
                    {isEn ? "Accept Renewal" : "Aceptar Renovación"}
                  </Button>
                </Form>
              ) : null}

              {canActivate(status) ? (
                <Form
                  action={setLeaseStatusAction}
                  onSubmit={() =>
                    queueOptimisticRowUpdate({
                      type: "set-status",
                      leaseId: id,
                      nextStatus: "active",
                    })
                  }
                >
                  <input name="lease_id" type="hidden" value={id} />
                  <input name="lease_status" type="hidden" value="active" />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="outline">
                    {isEn ? "Activate" : "Activar"}
                  </Button>
                </Form>
              ) : null}

              {canTerminate(status) ? (
                <Form
                  action={setLeaseStatusAction}
                  onSubmit={() =>
                    queueOptimisticRowUpdate({
                      type: "set-status",
                      leaseId: id,
                      nextStatus: "terminated",
                    })
                  }
                >
                  <input name="lease_id" type="hidden" value={id} />
                  <input name="lease_status" type="hidden" value="terminated" />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="outline">
                    {isEn ? "Terminate" : "Terminar"}
                  </Button>
                </Form>
              ) : null}

              {canComplete(status) ? (
                <Form
                  action={setLeaseStatusAction}
                  onSubmit={() =>
                    queueOptimisticRowUpdate({
                      type: "set-status",
                      leaseId: id,
                      nextStatus: "completed",
                    })
                  }
                >
                  <input name="lease_id" type="hidden" value={id} />
                  <input name="lease_status" type="hidden" value="completed" />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="secondary">
                    {isEn ? "Complete" : "Completar"}
                  </Button>
                </Form>
              ) : null}
            </div>
          );
        }}
      />

      <Sheet
        contentClassName="max-w-2xl"
        description={
          editing
            ? isEn
              ? "Edit lease details. Status changes use the separate action buttons."
              : "Edita los detalles del contrato. Los cambios de estado usan los botones de acción."
            : isEn
              ? "Create a lease and optionally generate the first collection record."
              : "Crea un contrato y opcionalmente genera el primer registro de cobro."
        }
        onOpenChange={setOpen}
        open={open}
        title={
          editing
            ? isEn
              ? "Edit lease"
              : "Editar contrato"
            : isEn
              ? "New lease"
              : "Nuevo contrato"
        }
      >
        <Form
          action={editing ? updateLeaseAction : createLeaseAction}
          className="space-y-4"
          key={editing?.id ?? "create"}
        >
          {editing ? (
            <input name="lease_id" type="hidden" value={editing.id} />
          ) : (
            <input name="organization_id" type="hidden" value={orgId} />
          )}
          <input name="next" type="hidden" value={nextPath} />

          <div className="grid gap-3 md:grid-cols-2">
            <div className="relative space-y-1 text-sm md:col-span-2" ref={dropdownRef}>
              <span>{isEn ? "Tenant full name" : "Nombre completo"}</span>
              <Input
                autoComplete="off"
                name="tenant_full_name"
                onChange={(e) => {
                  setTenantName(e.target.value);
                  searchGuests(e.target.value);
                }}
                onFocus={() => {
                  if (guestResults.length > 0) setShowGuestDropdown(true);
                }}
                required
                value={tenantName}
              />
              {showGuestDropdown && guestResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
                  {guestResults.map((guest) => (
                    <button
                      className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                      key={guest.id}
                      onClick={() => selectGuest(guest)}
                      type="button"
                    >
                      <span className="font-medium">{guest.full_name}</span>
                      {(guest.email || guest.phone_e164) && (
                        <span className="text-muted-foreground text-xs">
                          {[guest.email, guest.phone_e164]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Email" : "Correo"}</span>
              <Input
                name="tenant_email"
                onChange={(e) => setTenantEmail(e.target.value)}
                type="email"
                value={tenantEmail}
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Phone" : "Teléfono"}</span>
              <Input
                name="tenant_phone_e164"
                onChange={(e) => setTenantPhone(e.target.value)}
                placeholder="+595..."
                value={tenantPhone}
              />
            </label>

            {!editing && (
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <Checkbox
                  checked={saveAsGuest}
                  onCheckedChange={(checked) =>
                    setSaveAsGuest(checked === true)
                  }
                />
                <input
                  name="save_as_guest"
                  type="hidden"
                  value={saveAsGuest ? "1" : "0"}
                />
                <span className="text-muted-foreground">
                  {isEn
                    ? "Also save tenant as a guest in the database"
                    : "También guardar inquilino como huésped en la base de datos"}
                </span>
              </label>
            )}

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Start date" : "Fecha de inicio"}</span>
              <DatePicker
                defaultValue={editing?.starts_on ?? today}
                locale={locale}
                name="starts_on"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "End date" : "Fecha de término"}</span>
              <DatePicker
                defaultValue={editing?.ends_on ?? ""}
                locale={locale}
                name="ends_on"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Property" : "Propiedad"}</span>
              <Select
                defaultValue={editing?.property_id ?? ""}
                name="property_id"
              >
                <option value="">
                  {isEn ? "Select property" : "Seleccionar"}
                </option>
                {propertyOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Unit" : "Unidad"}</span>
              <Select defaultValue={editing?.unit_id ?? ""} name="unit_id">
                <option value="">{isEn ? "Select unit" : "Seleccionar"}</option>
                {unitOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Currency" : "Moneda"}</span>
              <Select
                defaultValue={editing?.currency ?? "PYG"}
                name="currency"
              >
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </label>

            {!editing ? (
              <label className="space-y-1 text-sm">
                <span>{isEn ? "Lease status" : "Estado del contrato"}</span>
                <Select defaultValue="active" name="lease_status">
                  <option value="draft">{isEn ? "Draft" : "Borrador"}</option>
                  <option value="active">{isEn ? "Active" : "Activo"}</option>
                </Select>
              </label>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Monthly rent" : "Alquiler mensual"}</span>
              <Input
                defaultValue={editing?.monthly_rent ?? ""}
                min={0}
                name="monthly_rent"
                ref={rentInputRef}
                required
                step="0.01"
                type="number"
              />
            </label>

            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span>IVA</span>
                <button
                  className="rounded border border-input px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={autoCalcIva}
                  title={
                    isEn
                      ? "Auto-calculate 5% IVA (residential rental rate)"
                      : "Auto-calcular IVA 5% (tasa alquiler residencial)"
                  }
                  type="button"
                >
                  5%
                </button>
              </div>
              <Input
                defaultValue={editing?.tax_iva ?? ""}
                min={0}
                name="tax_iva"
                ref={ivaInputRef}
                step="0.01"
                type="number"
              />
            </div>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Service fee" : "Tarifa de servicio"}</span>
              <Input
                defaultValue={editing?.service_fee_flat ?? ""}
                min={0}
                name="service_fee_flat"
                step="0.01"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Security deposit" : "Depósito de garantía"}</span>
              <Input
                defaultValue={editing?.security_deposit ?? ""}
                min={0}
                name="security_deposit"
                step="0.01"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Guarantee option fee" : "Costo de garantía"}</span>
              <Input
                defaultValue={editing?.guarantee_option_fee ?? ""}
                min={0}
                name="guarantee_option_fee"
                step="0.01"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Platform fee" : "Tarifa plataforma"}</span>
              <Input
                defaultValue={editing?.platform_fee ?? ""}
                min={0}
                name="platform_fee"
                step="0.01"
                type="number"
              />
            </label>
          </div>

          {!editing ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>
                  {isEn ? "Generate first collection" : "Generar primer cobro"}
                </span>
                <Select defaultValue="1" name="generate_first_collection">
                  <option value="1">{isEn ? "Yes" : "Sí"}</option>
                  <option value="0">{isEn ? "No" : "No"}</option>
                </Select>
              </label>

              <label className="space-y-1 text-sm">
                <span>
                  {isEn ? "First collection due" : "Vencimiento primer cobro"}
                </span>
                <DatePicker
                  defaultValue={today}
                  locale={locale}
                  name="first_collection_due_date"
                />
              </label>
            </div>
          ) : null}

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Notes" : "Notas"}</span>
            <Textarea
              defaultValue={editing?.notes ?? ""}
              name="notes"
              rows={3}
            />
          </label>

          <div className="flex justify-end">
            <Button type="submit">
              {editing
                ? isEn
                  ? "Save changes"
                  : "Guardar cambios"
                : isEn
                  ? "Create lease"
                  : "Crear contrato"}
            </Button>
          </div>
        </Form>
      </Sheet>

      <Sheet
        contentClassName="max-w-md"
        description={
          isEn
            ? `Generate monthly collection records for ${generatingFor?.tenant_full_name ?? "this lease"}.`
            : `Genera registros de cobro mensual para ${generatingFor?.tenant_full_name ?? "este contrato"}.`
        }
        onOpenChange={(v) => {
          if (!v) setGeneratingFor(null);
        }}
        open={!!generatingFor}
        title={isEn ? "Generate collections" : "Generar cobros"}
      >
        {generatingFor ? (
          <Form
            action={generateCollectionsAction}
            className="space-y-4"
            key={generatingFor.id}
          >
            <input name="organization_id" type="hidden" value={orgId} />
            <input name="lease_id" type="hidden" value={generatingFor.id} />
            <input name="currency" type="hidden" value={generatingFor.currency} />
            <input name="next" type="hidden" value={nextPath} />

            <label className="space-y-1 text-sm">
              <span>
                {isEn ? "Number of months" : "Cantidad de meses"}
              </span>
              <Input
                defaultValue={12}
                max={36}
                min={1}
                name="count"
                required
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Starting from" : "A partir de"}</span>
              <DatePicker
                defaultValue={today}
                locale={locale}
                name="start_date"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>
                {isEn ? "Amount per month" : "Monto mensual"} (
                {generatingFor.currency})
              </span>
              <Input
                defaultValue={
                  asNumber(generatingFor.monthly_recurring_total) ||
                  generatingFor.monthly_rent ||
                  0
                }
                min={0}
                name="amount"
                required
                step="0.01"
                type="number"
              />
            </label>

            <div className="flex justify-end">
              <Button type="submit">
                {isEn ? "Generate" : "Generar"}
              </Button>
            </div>
          </Form>
        ) : null}
      </Sheet>

      <Sheet
        contentClassName="max-w-2xl"
        description={
          isEn
            ? `Renew lease for ${renewingFrom?.tenant_full_name ?? "tenant"}. A new active lease will be created and the current one marked as completed.`
            : `Renovar contrato para ${renewingFrom?.tenant_full_name ?? "inquilino"}. Se creará un nuevo contrato activo y el actual se marcará como completado.`
        }
        onOpenChange={(v) => {
          if (!v) setRenewingFrom(null);
        }}
        open={!!renewingFrom}
        title={isEn ? "Renew lease" : "Renovar contrato"}
      >
        {renewingFrom ? (
          <Form
            action={renewLeaseAction}
            className="space-y-4"
            key={`renew-${renewingFrom.id}`}
          >
            <input
              name="old_lease_id"
              type="hidden"
              value={renewingFrom.id}
            />
            <input name="organization_id" type="hidden" value={orgId} />
            <input name="next" type="hidden" value={nextPath} />

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm md:col-span-2">
                <span>{isEn ? "Tenant full name" : "Nombre completo"}</span>
                <Input
                  defaultValue={renewingFrom.tenant_full_name}
                  name="tenant_full_name"
                  required
                />
              </label>

              <label className="space-y-1 text-sm">
                <span>{isEn ? "Email" : "Correo"}</span>
                <Input
                  defaultValue={renewingFrom.tenant_email ?? ""}
                  name="tenant_email"
                  type="email"
                />
              </label>

              <label className="space-y-1 text-sm">
                <span>{isEn ? "Phone" : "Teléfono"}</span>
                <Input
                  defaultValue={renewingFrom.tenant_phone_e164 ?? ""}
                  name="tenant_phone_e164"
                  placeholder="+595..."
                />
              </label>

              <label className="space-y-1 text-sm">
                <span>{isEn ? "New start date" : "Nueva fecha inicio"}</span>
                <DatePicker
                  defaultValue={renewingFrom.ends_on ?? today}
                  locale={locale}
                  name="starts_on"
                />
              </label>

              <label className="space-y-1 text-sm">
                <span>{isEn ? "New end date" : "Nueva fecha término"}</span>
                <DatePicker locale={locale} name="ends_on" />
              </label>

              <label className="space-y-1 text-sm">
                <span>{isEn ? "Property" : "Propiedad"}</span>
                <Select
                  defaultValue={renewingFrom.property_id ?? ""}
                  name="property_id"
                >
                  <option value="">
                    {isEn ? "Select property" : "Seleccionar"}
                  </option>
                  {propertyOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="space-y-1 text-sm">
                <span>{isEn ? "Unit" : "Unidad"}</span>
                <Select
                  defaultValue={renewingFrom.unit_id ?? ""}
                  name="unit_id"
                >
                  <option value="">
                    {isEn ? "Select unit" : "Seleccionar"}
                  </option>
                  {unitOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="space-y-1 text-sm">
                <span>{isEn ? "Currency" : "Moneda"}</span>
                <Select
                  defaultValue={renewingFrom.currency}
                  name="currency"
                >
                  <option value="PYG">PYG</option>
                  <option value="USD">USD</option>
                </Select>
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span>{isEn ? "Monthly rent" : "Alquiler mensual"}</span>
                <Input
                  defaultValue={renewingFrom.monthly_rent}
                  min={0}
                  name="monthly_rent"
                  required
                  step="0.01"
                  type="number"
                />
              </label>

              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <span>IVA</span>
                  <button
                    className="rounded border border-input px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={(e) => {
                      const form = (e.target as HTMLElement).closest("form");
                      if (!form) return;
                      const rentEl = form.querySelector<HTMLInputElement>(
                        'input[name="monthly_rent"]'
                      );
                      const ivaEl = form.querySelector<HTMLInputElement>(
                        'input[name="tax_iva"]'
                      );
                      if (rentEl && ivaEl) {
                        const rent = Number(rentEl.value);
                        if (Number.isFinite(rent) && rent > 0) {
                          const iva =
                            Math.round(rent * PY_RESIDENTIAL_IVA_RATE * 100) /
                            100;
                          ivaEl.value = String(iva);
                          ivaEl.dispatchEvent(
                            new Event("input", { bubbles: true })
                          );
                        }
                      }
                    }}
                    title={
                      isEn
                        ? "Auto-calculate 5% IVA (residential rental rate)"
                        : "Auto-calcular IVA 5% (tasa alquiler residencial)"
                    }
                    type="button"
                  >
                    5%
                  </button>
                </div>
                <Input
                  defaultValue={renewingFrom.tax_iva}
                  min={0}
                  name="tax_iva"
                  step="0.01"
                  type="number"
                />
              </div>

              <label className="space-y-1 text-sm">
                <span>{isEn ? "Service fee" : "Tarifa de servicio"}</span>
                <Input
                  defaultValue={renewingFrom.service_fee_flat}
                  min={0}
                  name="service_fee_flat"
                  step="0.01"
                  type="number"
                />
              </label>

              <label className="space-y-1 text-sm">
                <span>
                  {isEn ? "Security deposit" : "Depósito de garantía"}
                </span>
                <Input
                  defaultValue={renewingFrom.security_deposit}
                  min={0}
                  name="security_deposit"
                  step="0.01"
                  type="number"
                />
              </label>

              <label className="space-y-1 text-sm">
                <span>
                  {isEn ? "Guarantee option fee" : "Costo de garantía"}
                </span>
                <Input
                  defaultValue={renewingFrom.guarantee_option_fee}
                  min={0}
                  name="guarantee_option_fee"
                  step="0.01"
                  type="number"
                />
              </label>

              <label className="space-y-1 text-sm">
                <span>{isEn ? "Platform fee" : "Tarifa plataforma"}</span>
                <Input
                  defaultValue={renewingFrom.platform_fee}
                  min={0}
                  name="platform_fee"
                  step="0.01"
                  type="number"
                />
              </label>
            </div>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Notes" : "Notas"}</span>
              <Textarea name="notes" rows={3} />
            </label>

            <div className="flex justify-end">
              <Button type="submit">
                {isEn ? "Renew lease" : "Renovar contrato"}
              </Button>
            </div>
          </Form>
        ) : null}
      </Sheet>
    </div>
  );
}
