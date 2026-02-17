import type { Metadata } from "next";

import { GuestMessages } from "./guest-messages";

export const metadata: Metadata = {
  title: "Mensajes | Casaora",
  robots: { index: false, follow: false },
};

export default function GuestMessagesPage() {
  return <GuestMessages />;
}
