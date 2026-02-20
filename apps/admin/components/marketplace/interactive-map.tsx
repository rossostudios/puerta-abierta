"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/features/marketplace/geo";
import type { MarketplaceListingViewModel } from "@/lib/features/marketplace/view-model";
import { formatCompactCurrency } from "@/lib/format";

type InteractiveMapProps = {
  listings: MarketplaceListingViewModel[];
  locale: "es-PY" | "en-US";
  onBoundsChange?: (bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }) => void;
};

type PopupData = {
  listing: MarketplaceListingViewModel;
  x: number;
  y: number;
};

type GeoListing = MarketplaceListingViewModel & {
  latitude: number;
  longitude: number;
};

function isGeoListing(
  listing: MarketplaceListingViewModel
): listing is GeoListing {
  return listing.latitude !== null && listing.longitude !== null;
}

export function InteractiveMap({
  listings,
  locale,
  onBoundsChange,
}: InteractiveMapProps) {
  const isEn = locale === "en-US";
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [popup, setPopup] = useState<PopupData | null>(null);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

  // Initialize map
  useEffect(() => {
    if (!(containerRef.current && token)) return;

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

    if (onBoundsChange) {
      map.on("moveend", () => {
        const bounds = map.getBounds();
        if (!bounds) return;
        onBoundsChange({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
      });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, onBoundsChange]);

  // Sync markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old markers
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];

    const geoListings = listings.filter(isGeoListing);

    for (const listing of geoListings) {
      const el = document.createElement("button");
      el.className = "pa-map-marker";
      el.textContent = formatCompactCurrency(
        listing.monthlyRecurring,
        listing.currency,
        locale
      );

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const point = map.project([listing.longitude, listing.latitude]);
        setPopup({ listing, x: point.x, y: point.y });
      });

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([listing.longitude, listing.latitude])
        .addTo(map);

      markersRef.current.push(marker);
    }

    // Fit bounds if listings exist
    if (geoListings.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const l of geoListings) {
        bounds.extend([l.longitude, l.latitude]);
      }
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    } else if (geoListings.length === 1) {
      const firstListing = geoListings[0];
      if (!firstListing) return;
      map.flyTo({
        center: [firstListing.longitude, firstListing.latitude],
        zoom: 13,
      });
    }
  }, [listings, locale]);

  // Close popup on map click
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
      <div className="flex h-full min-h-[400px] items-center justify-center rounded-2xl border border-border/70 bg-muted/20 text-muted-foreground text-sm">
        {isEn
          ? "Map requires NEXT_PUBLIC_MAPBOX_TOKEN"
          : "El mapa requiere NEXT_PUBLIC_MAPBOX_TOKEN"}
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[400px] overflow-hidden rounded-2xl border border-border/70">
      <div className="h-full w-full" ref={containerRef} />

      {popup ? (
        <MapPopup
          isEn={isEn}
          listing={popup.listing}
          onClose={() => setPopup(null)}
          x={popup.x}
          y={popup.y}
        />
      ) : null}

      <style>{`
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

function MapPopup({
  listing,
  isEn,
  onClose,
  x,
  y,
}: {
  listing: MarketplaceListingViewModel;
  isEn: boolean;
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

      {listing.coverImageUrl ? (
        <Image
          alt={listing.title}
          className="mb-2 h-28 w-full rounded-lg object-cover"
          height={224}
          loading="lazy"
          sizes="256px"
          src={listing.coverImageUrl}
          width={256}
        />
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        {listing.neighborhood
          ? `${listing.neighborhood}, ${listing.city}`
          : listing.city}
      </p>
      <p className="line-clamp-1 font-semibold text-sm">{listing.title}</p>
      <p className="font-bold text-base">
        {listing.monthlyRecurringLabel}
        <span className="font-normal text-muted-foreground text-xs">
          {" "}
          /{isEn ? "mo" : "mes"}
        </span>
      </p>

      <Link
        className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-lg bg-primary font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
        href={`/marketplace/${encodeURIComponent(listing.slug)}`}
      >
        {isEn ? "View listing" : "Ver anuncio"}
      </Link>
    </div>
  );
}
