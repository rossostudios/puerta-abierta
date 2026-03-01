"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { EASING } from "@/lib/module-helpers";

const CHIPS_EN = [
  "What should I focus on today?",
  "Compare my STR vs LTR performance",
  "Any risks I should know about?",
  "How are my vacancies trending?",
];

const CHIPS_ES = [
  "\u00bfEn qu\u00e9 deber\u00eda enfocarme hoy?",
  "Compara mi rendimiento STR vs LTR",
  "\u00bfHay riesgos que deba saber?",
  "\u00bfC\u00f3mo van mis vacantes?",
];

type PortfolioChipsProps = {
  isEn: boolean;
};

export function PortfolioChips({ isEn }: PortfolioChipsProps) {
  const chips = isEn ? CHIPS_EN : CHIPS_ES;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-wrap gap-2"
      initial={{ opacity: 0, y: 8 }}
      transition={{ delay: 0.3, duration: 0.4, ease: EASING }}
    >
      {chips.map((chip, i) => (
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          initial={{ opacity: 0, scale: 0.95 }}
          key={chip}
          transition={{
            delay: 0.35 + i * 0.04,
            duration: 0.25,
            ease: EASING,
          }}
        >
          <Link
            className="glass-inner inline-block rounded-full px-3.5 py-2 text-[12.5px] text-muted-foreground/70 transition-all hover:text-foreground hover:shadow-sm"
            href={`/app/agents?prompt=${encodeURIComponent(chip)}`}
          >
            {chip}
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
