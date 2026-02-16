import { redirect } from "next/navigation";

export default function CalendarModulePage() {
  redirect("/module/reservations?view=calendar");
}
