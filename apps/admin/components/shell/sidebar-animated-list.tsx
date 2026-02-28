"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const EASING = [0.22, 1, 0.36, 1] as const;

export function AnimatedNavList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      animate="visible"
      className={cn("space-y-0.5", className)}
      initial="hidden"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.03 } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedNavItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, x: -6 },
        visible: {
          opacity: 1,
          x: 0,
          transition: { duration: 0.2, ease: EASING },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
