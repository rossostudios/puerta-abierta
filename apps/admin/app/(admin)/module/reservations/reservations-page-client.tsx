"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export function ReservationHeaderButtons({ isEn }: { isEn: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        href="/module/calendar"
      >
        {isEn ? "Calendar" : "Calendario"}
      </Link>
      <Link
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        href="/module/tasks"
      >
        {isEn ? "Tasks" : "Tareas"}
      </Link>
      <Button
        onClick={() =>
          window.dispatchEvent(new CustomEvent("open-reservation-sheet"))
        }
        size="sm"
        type="button"
        variant="secondary"
      >
        <Icon icon={PlusSignIcon} size={14} />
        {isEn ? "New reservation" : "Nueva reserva"}
      </Button>
    </div>
  );
}

