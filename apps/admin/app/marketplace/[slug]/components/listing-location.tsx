"use client";

import dynamic from "next/dynamic";
import { Location01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";

const LocationMapInner = dynamic(
  () => import("./listing-location-map").then((mod) => mod.ListingLocationMap),
  { ssr: false }
);

type ListingLocationProps = {
  city: string;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
  isEn: boolean;
};

export function ListingLocation({
  city,
  neighborhood,
  latitude,
  longitude,
  isEn,
}: ListingLocationProps) {
  return (
    <section>
      <h2 className="mb-3 font-semibold text-lg tracking-tight">
        {isEn ? "Location" : "Ubicación"}
      </h2>
      <div className="overflow-hidden rounded-xl border border-border/70">
        {latitude !== null && longitude !== null ? (
          <div className="h-64">
            <LocationMapInner latitude={latitude} longitude={longitude} />
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2 text-sm">
            <Icon className="text-muted-foreground" icon={Location01Icon} size={15} />
            {neighborhood ? `${neighborhood}, ${city}` : city}
          </div>
          {latitude !== null && longitude !== null ? (
            <a
              className="text-primary text-xs hover:underline"
              href={`https://www.google.com/maps?q=${latitude},${longitude}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              {isEn ? "Open in Google Maps" : "Abrir en Google Maps"}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
