"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";

import { cityToCoordinates } from "@/lib/features/marketplace/geo";

type PropertyLocationMiniMapProps = {
  city: string;
  isEn: boolean;
};

export function PropertyLocationMiniMap({
  city,
  isEn,
}: PropertyLocationMiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

  useEffect(() => {
    if (!containerRef.current || !token) return;

    mapboxgl.accessToken = token;

    const center = cityToCoordinates(city);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [center.lng, center.lat],
      zoom: 13,
      attributionControl: false,
      interactive: false,
    });

    new mapboxgl.Marker()
      .setLngLat([center.lng, center.lat])
      .addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, city]);

  if (!token) {
    return (
      <div className="flex h-48 w-full items-center justify-center rounded-2xl border border-border/70 bg-muted/20 text-muted-foreground text-xs">
        {isEn
          ? "Map requires NEXT_PUBLIC_MAPBOX_TOKEN"
          : "El mapa requiere NEXT_PUBLIC_MAPBOX_TOKEN"}
      </div>
    );
  }

  return (
    <div className="h-48 w-full overflow-hidden rounded-2xl border border-border/70">
      <div className="h-full w-full" ref={containerRef} />
    </div>
  );
}
