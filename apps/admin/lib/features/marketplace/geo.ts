export type LatLng = { lat: number; lng: number };

export const CITY_CENTERS: Record<string, LatLng> = {
  asuncion: { lat: -25.2637, lng: -57.5759 },
  "ciudad del este": { lat: -25.5097, lng: -54.6114 },
  encarnacion: { lat: -27.3306, lng: -55.8667 },
  luque: { lat: -25.2697, lng: -57.4872 },
  "san lorenzo": { lat: -25.3388, lng: -57.5092 },
  lambare: { lat: -25.3455, lng: -57.6064 },
  "fernando de la mora": { lat: -25.3164, lng: -57.5544 },
  capiata: { lat: -25.3547, lng: -57.4439 },
  "mariano roque alonso": { lat: -25.2065, lng: -57.5319 },
  itaugua: { lat: -25.3878, lng: -57.3545 },
  "villa elisa": { lat: -25.3667, lng: -57.5867 },
  aregua: { lat: -25.3042, lng: -57.3892 },
  ypacarai: { lat: -25.3889, lng: -57.2825 },
  "san bernardino": { lat: -25.3085, lng: -57.2909 },
};

export const DEFAULT_CENTER: LatLng = CITY_CENTERS.asuncion;
export const DEFAULT_ZOOM = 11;

export function cityToCoordinates(city: string): LatLng {
  const normalized = city.toLowerCase().trim();
  return CITY_CENTERS[normalized] ?? DEFAULT_CENTER;
}

/**
 * Add slight jitter to coordinates to avoid pin stacking
 * when multiple listings fall back to the same city center.
 */
export function jitter(coord: LatLng, index: number): LatLng {
  const angle = (index * 137.508) * (Math.PI / 180); // golden angle
  const radius = 0.003 + (index % 5) * 0.001;
  return {
    lat: coord.lat + Math.sin(angle) * radius,
    lng: coord.lng + Math.cos(angle) * radius,
  };
}
