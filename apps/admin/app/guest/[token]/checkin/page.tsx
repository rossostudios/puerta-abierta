import type { Metadata } from "next";

import { CheckinInfo } from "./checkin-info";

export const metadata: Metadata = {
  title: "Check-in Info | Casaora",
  robots: { index: false, follow: false },
};

export default function GuestCheckinPage() {
  return <CheckinInfo />;
}
