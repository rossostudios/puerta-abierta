"use client";

import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  PencilEdit02Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { ReadinessRing } from "./readiness-ring";

/* ---------- dimension metadata ---------- */

type ReadinessDimension = {
  field: string;
  label: string;
  labelEs: string;
  weight: number;
  critical: boolean;
  /** true = AI can auto-fill this, false = user must fix manually */
  aiGeneratable: boolean;
  aiLabelEn: string;
  aiLabelEs: string;
};

const READINESS_DIMENSIONS: ReadinessDimension[] = [
  {
    field: "cover_image",
    label: "Cover Image",
    labelEs: "Imagen de portada",
    weight: 25,
    critical: true,
    aiGeneratable: false,
    aiLabelEn: "Upload image",
    aiLabelEs: "Subir imagen",
  },
  {
    field: "fee_lines",
    label: "Fee Breakdown",
    labelEs: "Desglose de cuotas",
    weight: 25,
    critical: true,
    aiGeneratable: false,
    aiLabelEn: "Set up fees",
    aiLabelEs: "Configurar cuotas",
  },
  {
    field: "amenities",
    label: "Amenities",
    labelEs: "Amenidades",
    weight: 15,
    critical: false,
    aiGeneratable: true,
    aiLabelEn: "Auto-detect amenities",
    aiLabelEs: "Detectar amenidades",
  },
  {
    field: "bedrooms",
    label: "Bedrooms",
    labelEs: "Habitaciones",
    weight: 10,
    critical: false,
    aiGeneratable: false,
    aiLabelEn: "Set bedrooms",
    aiLabelEs: "Indicar habitaciones",
  },
  {
    field: "square_meters",
    label: "Area (m²)",
    labelEs: "Área (m²)",
    weight: 10,
    critical: false,
    aiGeneratable: false,
    aiLabelEn: "Set area",
    aiLabelEs: "Indicar área",
  },
  {
    field: "available_from",
    label: "Available From",
    labelEs: "Disponible desde",
    weight: 5,
    critical: false,
    aiGeneratable: false,
    aiLabelEn: "Set date",
    aiLabelEs: "Indicar fecha",
  },
  {
    field: "minimum_lease",
    label: "Minimum Lease",
    labelEs: "Contrato mínimo",
    weight: 5,
    critical: false,
    aiGeneratable: false,
    aiLabelEn: "Set minimum",
    aiLabelEs: "Indicar mínimo",
  },
  {
    field: "description",
    label: "Description",
    labelEs: "Descripción",
    weight: 5,
    critical: false,
    aiGeneratable: true,
    aiLabelEn: "Auto-generate",
    aiLabelEs: "Auto-generar",
  },
];

/* ---------- types ---------- */

type ReadinessPopoverProps = {
  listingId: string;
  readinessScore: number;
  readinessBlocking: string[];
  isEn: boolean;
  onFixField: (field: string) => void;
  onAiGenerate?: (listingId: string, field: string) => Promise<void>;
};

/* ---------- component ---------- */

export function ReadinessPopover({
  listingId,
  readinessScore,
  readinessBlocking,
  isEn,
  onFixField,
  onAiGenerate,
}: ReadinessPopoverProps) {
  const [generatingField, setGeneratingField] = useState<string | null>(null);
  const blockingSet = useMemo(
    () => new Set(readinessBlocking),
    [readinessBlocking]
  );
  const missingDims = useMemo(
    () => READINESS_DIMENSIONS.filter((d) => blockingSet.has(d.field)),
    [blockingSet]
  );
  const satisfiedDims = useMemo(
    () => READINESS_DIMENSIONS.filter((d) => !blockingSet.has(d.field)),
    [blockingSet]
  );

  async function handleAiGenerate(field: string) {
    if (!onAiGenerate) return;
    setGeneratingField(field);
    try {
      await onAiGenerate(listingId, field);
    } finally {
      setGeneratingField(null);
    }
  }

  return (
    <PopoverRoot>
      <PopoverTrigger>
        <button
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/50"
          type="button"
        >
          <ReadinessRing score={readinessScore} />
          <span className="font-medium text-xs tabular-nums">
            {readinessScore}%
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[280px] p-0"
        side="left"
        sideOffset={12}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-border/30 border-b px-3.5 py-3">
          <ReadinessRing score={readinessScore} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground text-xs">
              {readinessScore}%{" "}
              {isEn ? "Listing Readiness" : "Preparación del anuncio"}
            </p>
            {missingDims.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {missingDims.length}{" "}
                {isEn
                  ? `item${missingDims.length > 1 ? "s" : ""} to complete`
                  : `elemento${missingDims.length > 1 ? "s" : ""} pendiente${missingDims.length > 1 ? "s" : ""}`}
              </p>
            )}
          </div>
        </div>

        {/* Missing dimensions */}
        {missingDims.length > 0 && (
          <div className="px-2 py-2">
            <p className="px-1.5 pb-1.5 font-medium text-[10px] text-muted-foreground/70 uppercase tracking-widest">
              {isEn ? "Missing" : "Faltante"}
            </p>
            <ul className="space-y-0.5">
              {missingDims.map((dim) => {
                const isGenerating = generatingField === dim.field;
                return (
                  <li
                    className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/40"
                    key={dim.field}
                  >
                    <Icon
                      className="shrink-0 text-muted-foreground/40"
                      icon={Cancel01Icon}
                      size={12}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                      {isEn ? dim.label : dim.labelEs}
                      {dim.critical && (
                        <span className="ml-1 font-semibold text-[9px] text-red-500 uppercase">
                          {isEn ? "required" : "requerido"}
                        </span>
                      )}
                    </span>
                    {dim.aiGeneratable && onAiGenerate ? (
                      <Button
                        className={cn(
                          "h-auto gap-1 rounded-md px-1.5 py-0.5 text-[10px]",
                          "bg-primary/8 text-primary hover:bg-primary/15",
                          "opacity-0 transition-opacity group-hover:opacity-100",
                          isGenerating && "opacity-100"
                        )}
                        disabled={isGenerating}
                        onClick={() => handleAiGenerate(dim.field)}
                        size="xs"
                        type="button"
                        variant="ghost"
                      >
                        <Icon
                          className={cn(
                            "shrink-0",
                            isGenerating ? "animate-spin" : "ai-sparkle"
                          )}
                          icon={isGenerating ? Loading03Icon : SparklesIcon}
                          size={10}
                        />
                        {isEn ? dim.aiLabelEn : dim.aiLabelEs}
                      </Button>
                    ) : (
                      <button
                        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100"
                        onClick={() => onFixField(dim.field)}
                        type="button"
                      >
                        <Icon icon={PencilEdit02Icon} size={9} />
                        {isEn ? "Fix now" : "Corregir"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Satisfied dimensions */}
        {satisfiedDims.length > 0 && (
          <div className="border-border/20 border-t px-2 py-2">
            <p className="px-1.5 pb-1.5 font-medium text-[10px] text-muted-foreground/70 uppercase tracking-widest">
              {isEn ? "Complete" : "Completo"}
            </p>
            <ul className="space-y-0.5">
              {satisfiedDims.map((dim) => (
                <li
                  className="flex items-center gap-2 px-1.5 py-1"
                  key={dim.field}
                >
                  <Icon
                    className="shrink-0 text-emerald-500"
                    icon={CheckmarkCircle02Icon}
                    size={12}
                  />
                  <span className="text-[11px] text-foreground/70">
                    {isEn ? dim.label : dim.labelEs}
                  </span>
                  <span className="ml-auto text-[9px] text-muted-foreground/50">
                    {dim.weight}pt
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* AI bulk generate CTA */}
        {missingDims.some((d) => d.aiGeneratable) && onAiGenerate && (
          <div className="border-border/20 border-t px-3 py-2.5">
            <Button
              className="h-7 w-full gap-1.5 rounded-lg text-[11px]"
              onClick={() => handleAiGenerate("all")}
              size="xs"
              type="button"
              variant="default"
            >
              <Icon className="ai-sparkle-fast" icon={SparklesIcon} size={12} />
              {isEn ? "Auto-fill all with AI" : "Auto-completar todo con IA"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}
