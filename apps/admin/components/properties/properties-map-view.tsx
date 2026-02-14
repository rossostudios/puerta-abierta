"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import {
  cityToCoordinates,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  jitter,
} from "@/lib/features/marketplace/geo";
import type { PropertyPortfolioRow } from "@/lib/features/properties/types";
import { cn } from "@/lib/utils";

type PropertiesMapViewProps = {
  rows: PropertyPortfolioRow[];
  isEn: boolean;
  formatLocale: "en-US" | "es-PY";
};

type PopupData = {
  row: PropertyPortfolioRow;
  x: number;
  y: number;
};

export function PropertiesMapView({
  rows,
  isEn,
  formatLocale,
}: PropertiesMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [popup, setPopup] = useState<PopupData | null>(null);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

  useEffect(() => {
    if (!containerRef.current || !token) return;

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });

    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];

    const geoRows = rows.map((row, index) => {
      const center = cityToCoordinates(row.city);
      const coords = jitter(center, index);
      return { row, lat: coords.lat, lng: coords.lng };
    });

    for (const { row, lat, lng } of geoRows) {
      const el = document.createElement("button");
      el.className = "pa-map-marker";
      el.textContent = row.code;

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const point = map.project([lng, lat]);
        setPopup({ row, x: point.x, y: point.y });
      });

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);

      markersRef.current.push(marker);
    }

    if (geoRows.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const { lng, lat } of geoRows) {
        bounds.extend([lng, lat]);
      }
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    } else if (geoRows.length === 1) {
      map.flyTo({
        center: [geoRows[0].lng, geoRows[0].lat],
        zoom: 13,
      });
    }
  }, [rows]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handler = () => setPopup(null);
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, []);

  if (!token) {
    return (
      <div className="flex h-[calc(100vh-260px)] min-h-[400px] items-center justify-center rounded-2xl border border-border/70 bg-muted/20 text-muted-foreground text-sm">
        {isEn
          ? "Map requires NEXT_PUBLIC_MAPBOX_TOKEN"
          : "El mapa requiere NEXT_PUBLIC_MAPBOX_TOKEN"}
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-260px)] min-h-[400px] overflow-hidden rounded-2xl border border-border/70">
      <div className="h-full w-full" ref={containerRef} />

      {popup ? (
        <PropertyMapPopup
          formatLocale={formatLocale}
          isEn={isEn}
          onClose={() => setPopup(null)}
          row={popup.row}
          x={popup.x}
          y={popup.y}
        />
      ) : null}

      <style jsx global>{`
        .pa-map-marker {
          background: white;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 999px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
          color: #1a1a1a;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          white-space: nowrap;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .pa-map-marker:hover {
          transform: scale(1.08);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
          z-index: 10;
        }
      `}</style>
    </div>
  );
}

function PropertyMapPopup({
  row,
  isEn,
  formatLocale,
  onClose,
  x,
  y,
}: {
  row: PropertyPortfolioRow;
  isEn: boolean;
  formatLocale: "en-US" | "es-PY";
  onClose: () => void;
  x: number;
  y: number;
}) {
  return (
    <div
      className="absolute z-30 w-64 -translate-x-1/2 -translate-y-full rounded-xl border border-border/70 bg-background p-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
      style={{ left: x, top: y - 12 }}
    >
      <button
        className="absolute top-2 right-2 text-muted-foreground text-xs hover:text-foreground"
        onClick={onClose}
        type="button"
      >
        x
      </button>

      <p className="font-semibold text-sm">{row.name}</p>
      <p className="text-[11px] text-muted-foreground">
        {row.address || row.city}
      </p>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">
            {isEn ? "Occupancy" : "Ocupación"}
          </span>
          <p className="font-medium">{row.occupancyRate}%</p>
        </div>
        <div>
          <span className="text-muted-foreground">
            {isEn ? "Revenue" : "Ingresos"}
          </span>
          <p className="font-medium">
            {formatCompactCurrency(row.revenueMtdPyg, "PYG", formatLocale)}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">
            {isEn ? "Tasks" : "Tareas"}
          </span>
          <p className="font-medium">{row.openTaskCount}</p>
        </div>
        {row.overdueCollectionCount > 0 ? (
          <div>
            <span className="text-[var(--status-danger-fg)]">
              {isEn ? "Overdue" : "Vencidos"}
            </span>
            <p className="font-medium text-[var(--status-danger-fg)]">
              {row.overdueCollectionCount}
            </p>
          </div>
        ) : null}
      </div>

      <Link
        className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-medium transition-colors hover:bg-primary/90"
        href={`/module/properties/${row.id}`}
      >
        {isEn ? "View Details" : "Ver Detalles"}
      </Link>
    </div>
  );
}
