"use client";

import dynamic from "next/dynamic";
import { ArrowRight02Icon, Location01Icon } from "@hugeicons/core-free-icons";
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
      <h2 className="mb-4 font-serif text-xl font-medium tracking-tight text-[var(--marketplace-text)]">
        {isEn ? "Location" : "Ubicación"}
      </h2>
      <div className="h-px bg-[#e8e4df]" />

      <div className="mt-4 overflow-hidden rounded-2xl">
        {latitude !== null && longitude !== null ? (
          <div className="h-[40vh] md:h-[50vh]">
            <LocationMapInner latitude={latitude} longitude={longitude} />
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2 text-sm text-[var(--marketplace-text-muted)]">
            <Icon icon={Location01Icon} size={15} />
            {neighborhood ? `${neighborhood}, ${city}` : city}
          </div>
          {latitude !== null && longitude !== null ? (
            <a
              className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
              href={`https://www.google.com/maps?q=${latitude},${longitude}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              {isEn ? "Open in Google Maps" : "Abrir en Google Maps"}
              <Icon icon={ArrowRight02Icon} size={12} />
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
