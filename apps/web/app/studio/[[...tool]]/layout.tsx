import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Casaora Studio",
  description: "Content management studio for the Casaora website.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen">{children}</div>;
}
