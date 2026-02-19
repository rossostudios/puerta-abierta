"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createLeaseAction,
  updateLeaseAction,
} from "@/app/(admin)/module/leases/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { authedFetch } from "@/lib/api-client";
import type { Locale } from "@/lib/i18n";

import {
  type GuestResult,
  type LeaseRow,
  type PropertyOption,
  type UnitOption,
  PY_RESIDENTIAL_IVA_RATE,
} from "./lease-types";

export function LeaseFormSheet({
  open,
  onOpenChange,
  editing,
  orgId,
  nextPath,
  isEn,
  locale,
  today,
  propertyOptions,
  unitOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: LeaseRow | null;
  orgId: string;
  nextPath: string;
  isEn: boolean;
  locale: Locale;
  today: string;
  propertyOptions: PropertyOption[];
  unitOptions: UnitOption[];
}) {
  const [tenantName, setTenantName] = useState(
    () => editing?.tenant_full_name ?? ""
  );
  const [tenantEmail, setTenantEmail] = useState(
    () => editing?.tenant_email ?? ""
  );
  const [tenantPhone, setTenantPhone] = useState(
    () => editing?.tenant_phone_e164 ?? ""
  );
  const [guestResults, setGuestResults] = useState<GuestResult[]>([]);
  const [showGuestDropdown, setShowGuestDropdown] = useState(false);
  const [saveAsGuest, setSaveAsGuest] = useState(false);
  const guestSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const resetTenantFields = useCallback((row: LeaseRow | null) => {
    setTenantName(row?.tenant_full_name ?? "");
    setTenantEmail(row?.tenant_email ?? "");
    setTenantPhone(row?.tenant_phone_e164 ?? "");
    setSaveAsGuest(false);
    setGuestResults([]);
    setShowGuestDropdown(false);
  }, []);

  const handleSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        resetTenantFields(editing);
      } else {
        setShowGuestDropdown(false);
      }
      onOpenChange(nextOpen);
    },
    [editing, onOpenChange, resetTenantFields]
  );

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
          let results: GuestResult[];
          if (data != null) {
            results = data;
          } else {
            results = [];
          }
          setGuestResults(results);
          setShowGuestDropdown(results.length > 0);
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

  const rentInputRef = useRef<HTMLInputElement | null>(null);
  const ivaInputRef = useRef<HTMLInputElement | null>(null);

  const autoCalcIva = useCallback(() => {
    const rentValue = rentInputRef.current?.value;
    const rent = Number(rentValue);
    if (Number.isFinite(rent) && rent > 0 && ivaInputRef.current) {
      const iva = Math.round(rent * PY_RESIDENTIAL_IVA_RATE * 100) / 100;
      ivaInputRef.current.value = String(iva);
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(ivaInputRef.current, String(iva));
      ivaInputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, []);

  return (
    <Sheet
      contentClassName="max-w-2xl"
      description={
        editing
          ? isEn
            ? "Edit lease details. Status changes use the separate action buttons."
            : `Edita los detalles del contrato. Los cambios de estado usan los botones de acci${"\u00F3"}n.`
          : isEn
            ? "Create a lease and optionally generate the first collection record."
            : "Crea un contrato y opcionalmente genera el primer registro de cobro."
      }
      onOpenChange={handleSheetOpenChange}
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
                          .join(" \u00B7 ")}
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
            <span>{isEn ? "Phone" : `Tel${"\u00E9"}fono`}</span>
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
                  : `Tambi${"\u00E9"}n guardar inquilino como hu${"\u00E9"}sped en la base de datos`}
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
            <span>{isEn ? "End date" : `Fecha de t${"\u00E9"}rmino`}</span>
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
            <span>{isEn ? "Security deposit" : `Dep${"\u00F3"}sito de garant${"\u00ED"}a`}</span>
            <Input
              defaultValue={editing?.security_deposit ?? ""}
              min={0}
              name="security_deposit"
              step="0.01"
              type="number"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span>{isEn ? "Guarantee option fee" : `Costo de garant${"\u00ED"}a`}</span>
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
                <option value="1">{isEn ? "Yes" : `S${"\u00ED"}`}</option>
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
  );
}
