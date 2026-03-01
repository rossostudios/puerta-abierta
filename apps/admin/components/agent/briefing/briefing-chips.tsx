"use client";

import { motion } from "motion/react";
import { EASING } from "./helpers";

const CHIPS_EN = [
  "What should I focus on today?",
  "Compare my STR vs LTR performance",
  "Any risks I should know about?",
  "Draft an owner update for Whitfield",
  "What did you handle on your own this week?",
  "How's March looking?",
];

const CHIPS_ES = [
  "\u00bfEn qu\u00e9 deber\u00eda enfocarme hoy?",
  "Compara mi rendimiento STR vs LTR",
  "\u00bfHay riesgos que deba saber?",
  "Redacta un informe para propietarios",
  "\u00bfQu\u00e9 manejaste por tu cuenta esta semana?",
  "\u00bfC\u00f3mo se ve marzo?",
];

export function BriefingChips({
  isEn,
  onSend,
  disabled,
}: {
  isEn: boolean;
  onSend: (message: string) => void;
  disabled?: boolean;
}) {
  const chips = isEn ? CHIPS_EN : CHIPS_ES;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-wrap gap-2 pt-2"
      initial={{ opacity: 0, y: 8 }}
      transition={{ delay: 0.45, duration: 0.4, ease: EASING }}
    >
      {chips.map((chip, i) => (
        <motion.button
          animate={{ opacity: 1, scale: 1 }}
          className="glass-inner rounded-full px-3.5 py-2 text-[12.5px] text-muted-foreground/70 transition-all hover:text-foreground hover:shadow-sm disabled:pointer-events-none disabled:opacity-40"
          disabled={disabled}
          initial={{ opacity: 0, scale: 0.95 }}
          key={chip}
          onClick={() => onSend(chip)}
          transition={{
            delay: 0.5 + i * 0.04,
            duration: 0.25,
            ease: EASING,
          }}
          type="button"
        >
          {chip}
        </motion.button>
      ))}
    </motion.div>
  );
}
