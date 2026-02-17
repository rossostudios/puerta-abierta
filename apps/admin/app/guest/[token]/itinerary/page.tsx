import type { Metadata } from "next";

import { GuestItinerary } from "./guest-itinerary";

export const metadata: Metadata = {
  title: "Itinerario | Casaora",
  robots: { index: false, follow: false },
};

export default function GuestItineraryPage() {
  return <GuestItinerary />;
}
