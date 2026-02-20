"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { authedFetch } from "@/lib/api-client";
import { useActiveLocale } from "@/lib/i18n/client";

type AccompanyingGuestsProps = {
  reservationId: string;
  primaryGuestId: string | null;
  orgId: string;
};

type ReservationGuest = {
  id: string;
  guest_id: string;
  role: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone_e164: string | null;
};

type OrgGuest = {
  id: string;
  full_name: string;
  email: string | null;
  phone_e164: string | null;
};

export function AccompanyingGuests({
  reservationId,
  primaryGuestId,
  orgId,
}: AccompanyingGuestsProps) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const [isPending, startTransition] = useTransition();
  const [linked, setLinked] = useState<ReservationGuest[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<OrgGuest[]>([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);

  const linkedGuestIds = new Set(linked.map((g) => g.guest_id));

  const loadLinked = useCallback(async () => {
    try {
      const res = await authedFetch<{ data: ReservationGuest[] }>(
        `/reservations/${reservationId}/guests`
      );
      const data = res.data;
      if (data != null) {
        setLinked(data);
      } else {
        setLinked([]);
      }
    } catch {
      // Silently fail on load
    }
  }, [reservationId]);

  useEffect(() => {
    let cancelled = false;
    authedFetch<{ data: ReservationGuest[] }>(
      `/reservations/${reservationId}/guests`
    )
      .then((res) => {
        if (cancelled) return;
        const data = res.data;
        if (data != null) {
          setLinked(data);
        } else {
          setLinked([]);
        }
      })
      .catch(() => {
        // Silently fail on load
      });
    return () => {
      cancelled = true;
    };
  }, [reservationId]);

  // Search org guests on input change
  useEffect(() => {
    if (!search.trim()) return;

    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const res = await authedFetch<{ data: OrgGuest[] }>(
          `/guests?org_id=${encodeURIComponent(orgId)}&limit=50`
        );
        if (cancelled) return;
        const query = search.toLowerCase().trim();
        const rawData = res.data;
        let allGuests: OrgGuest[] = [];
        if (rawData != null) {
          allGuests = rawData;
        }
        const filtered = allGuests.filter((g) => {
          if (g.id === primaryGuestId) return false;
          if (linkedGuestIds.has(g.id)) return false;
          const gName = g.full_name;
          const gEmail = g.email;
          const gPhone = g.phone_e164;
          let name = "";
          if (gName != null) {
            name = gName.toLowerCase();
          }
          let email = "";
          if (gEmail != null) {
            email = gEmail.toLowerCase();
          }
          let phone = "";
          if (gPhone != null) {
            phone = gPhone.toLowerCase();
          }
          if (name.includes(query)) return true;
          if (email.includes(query)) return true;
          if (phone.includes(query)) return true;
          return false;
        });
        setSearchResults(filtered.slice(0, 8));
        setShowResults(true);
      } catch {
        // Silently fail on search
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, orgId, primaryGuestId, linkedGuestIds]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleAdd(guestId: string) {
    const successMsg = isEn ? "Guest added" : "Huésped agregado";
    const fallbackMsg = isEn
      ? "Failed to add guest"
      : "Error al agregar huésped";
    startTransition(async () => {
      try {
        await authedFetch(`/reservations/${reservationId}/guests`, {
          method: "POST",
          body: JSON.stringify({ guest_id: guestId }),
        });
        toast.success(successMsg);
        setSearch("");
        setShowResults(false);
        await loadLinked();
      } catch (err) {
        let msg = fallbackMsg;
        if (err instanceof Error) {
          msg = err.message;
        }
        toast.error(msg);
      }
    });
  }

  function handleRemove(reservationGuestId: string) {
    const successMsg = isEn ? "Guest removed" : "Huésped removido";
    const fallbackMsg = isEn
      ? "Failed to remove guest"
      : "Error al remover huésped";
    startTransition(async () => {
      try {
        await authedFetch(
          `/reservations/${reservationId}/guests/${reservationGuestId}`,
          { method: "DELETE" }
        );
        toast.success(successMsg);
        await loadLinked();
      } catch (err) {
        let msg = fallbackMsg;
        if (err instanceof Error) {
          msg = err.message;
        }
        toast.error(msg);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {isEn ? "Accompanying guests" : "Huéspedes acompañantes"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "Additional guests linked to this reservation."
            : "Huéspedes adicionales vinculados a esta reserva."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {linked.length > 0 ? (
          <ul className="space-y-2">
            {linked.map((rg) => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border bg-muted/10 px-3 py-2"
                key={rg.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">
                    {rg.guest_name ?? rg.guest_id.slice(0, 8)}
                  </p>
                  <p className="truncate text-muted-foreground text-xs">
                    {(rg.guest_email ?? "").trim() ||
                      (rg.guest_phone_e164 ?? "").trim() ||
                      rg.role}
                  </p>
                </div>
                <Button
                  disabled={isPending}
                  onClick={() => handleRemove(rg.id)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Icon icon={Cancel01Icon} size={14} />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            {isEn
              ? "No accompanying guests yet."
              : "Aún no hay huéspedes acompañantes."}
          </p>
        )}

        <div className="relative" ref={searchRef}>
          <Input
            onChange={(e) => {
              const next = e.target.value;
              setSearch(next);
              if (!next.trim()) {
                setSearchResults([]);
                setShowResults(false);
              }
            }}
            onFocus={() => {
              if (searchResults.length > 0) setShowResults(true);
            }}
            placeholder={
              isEn
                ? "Search guests to add..."
                : "Buscar huéspedes para agregar..."
            }
            value={search}
          />
          {showResults && searchResults.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-background shadow-md">
              {searchResults.map((g) => (
                <li
                  className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/20"
                  key={g.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">
                      {g.full_name}
                    </p>
                    <p className="truncate text-muted-foreground text-xs">
                      {(g.email ?? "").trim() ||
                        (g.phone_e164 ?? "").trim() ||
                        "-"}
                    </p>
                  </div>
                  <Button
                    disabled={isPending}
                    onClick={() => handleAdd(g.id)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {isEn ? "Add" : "Agregar"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {showResults && search.trim() && searchResults.length === 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-background p-3 text-muted-foreground text-sm shadow-md">
              {isEn
                ? "No matching guests found."
                : "No se encontraron huéspedes."}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
