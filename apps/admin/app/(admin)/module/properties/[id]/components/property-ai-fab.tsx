"use client";

import { SparklesIcon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { PropertyAiChatSheet } from "./property-ai-chat-sheet";

type PropertyAiFabProps = {
  orgId: string;
  propertyId: string;
  propertyName: string;
  propertyCode?: string;
  propertyAddress?: string;
  occupancyRate?: number | null;
  unitCount?: number;
  isEn: boolean;
};

export function PropertyAiFab({
  orgId,
  propertyId,
  propertyName,
  propertyCode,
  propertyAddress,
  occupancyRate,
  unitCount,
  isEn,
}: PropertyAiFabProps) {
  const [open, setOpen] = useState(false);

  const toggleOpen = useCallback(() => setOpen((prev) => !prev), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "a"
      ) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        aria-label={isEn ? "Ask AI" : "Preguntar a IA"}
        className={cn(
          "fixed right-6 bottom-6 z-40 flex h-14 w-14 items-center justify-center rounded-full",
          "bg-casaora-gradient text-white shadow-casaora",
          "transition-all duration-200 hover:scale-105 hover:shadow-lg",
          "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2"
        )}
        onClick={toggleOpen}
        title={isEn ? "Ask AI (⌘⇧A)" : "Preguntar a IA (⌘⇧A)"}
        type="button"
      >
        <Icon className="h-6 w-6" icon={SparklesIcon} />
      </button>

      <PropertyAiChatSheet
        isEn={isEn}
        occupancyRate={occupancyRate}
        onOpenChange={setOpen}
        open={open}
        orgId={orgId}
        propertyAddress={propertyAddress}
        propertyCode={propertyCode}
        propertyId={propertyId}
        propertyName={propertyName}
        unitCount={unitCount}
      />
    </>
  );
}
