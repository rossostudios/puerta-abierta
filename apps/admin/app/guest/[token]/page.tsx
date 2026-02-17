import { redirect } from "next/navigation";

export default async function GuestTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/guest/${token}/itinerary`);
}
