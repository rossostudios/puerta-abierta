"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";

type ListingLocationMapProps = {
  latitude: number;
  longitude: number;
};

export function ListingLocationMap({
  latitude,
  longitude,
}: ListingLocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
    if (!containerRef.current || !token) return;

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [longitude, latitude],
      zoom: 14,
      attributionControl: false,
      interactive: true,
    });

    new mapboxgl.Marker({ color: "#0a84ff" })
      .setLngLat([longitude, latitude])
      .addTo(map);

    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    return () => map.remove();
  }, [latitude, longitude]);

  return <div className="h-full w-full" ref={containerRef} />;
}
