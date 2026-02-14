import {
  CarParking01Icon,
  CheckListIcon,
  Dumbbell01Icon,
  SecurityCheckIcon,
  Tick01Icon,
  WashingMachineIcon,
  Wifi01Icon,
} from "@hugeicons/core-free-icons";

import { Icon } from "@/components/ui/icon";
import type { IconSvgElement } from "@hugeicons/react";

const AMENITY_ICON_MAP: Record<string, IconSvgElement> = {
  wifi: Wifi01Icon,
  internet: Wifi01Icon,
  gym: Dumbbell01Icon,
  gymnasium: Dumbbell01Icon,
  parking: CarParking01Icon,
  estacionamiento: CarParking01Icon,
  laundry: WashingMachineIcon,
  lavanderia: WashingMachineIcon,
  security: SecurityCheckIcon,
  seguridad: SecurityCheckIcon,
  vigilancia: SecurityCheckIcon,
};

function getAmenityIcon(amenity: string): IconSvgElement {
  const key = amenity.toLowerCase().trim();
  for (const [pattern, icon] of Object.entries(AMENITY_ICON_MAP)) {
    if (key.includes(pattern)) return icon;
  }
  return Tick01Icon;
}

type ListingAmenitiesProps = {
  amenities: string[];
  isEn: boolean;
};

export function ListingAmenities({ amenities, isEn }: ListingAmenitiesProps) {
  if (!amenities.length) return null;

  const visible = amenities.slice(0, 12);

  return (
    <section>
      <h2 className="mb-3 font-semibold text-lg tracking-tight">
        {isEn ? "Amenities" : "Amenidades"}
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((amenity) => (
          <div
            className="inline-flex items-center gap-2.5 rounded-xl border border-border/70 px-3 py-2.5 text-sm"
            key={amenity}
          >
            <Icon
              className="shrink-0 text-muted-foreground"
              icon={getAmenityIcon(amenity)}
              size={16}
            />
            {amenity}
          </div>
        ))}
      </div>
    </section>
  );
}
