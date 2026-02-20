"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

const steps = [
  {
    number: "01",
    title: "Connect channels",
    description: "Import listings from Airbnb, Booking.com, and VRBO.",
  },
  {
    number: "02",
    title: "Automate operations",
    description: "Auto-messaging and cleaning dispatch.",
  },
  {
    number: "03",
    title: "Delight owners",
    description: "Rise in occupancy and transparent statements.",
  },
];

export function Stepper() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  const y = useTransform(scrollYProgress, [0, 1], [50, -50]);
  const opacity = useTransform(scrollYProgress, [0, 0.3, 0.7, 1], [0, 1, 1, 0]);

  return (
    <section ref={containerRef} className="relative bg-background dark:bg-black py-24 md:py-32 overflow-hidden">
      <div className="container mx-auto max-w-[1400px] px-4 md:px-8">

        {/* Header - Split Layout */}
        <div className="mb-20 flex flex-col md:flex-row md:items-end md:justify-between gap-8">
          <motion.div
            className="max-w-2xl"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-medium tracking-tight text-foreground dark:text-white mb-6">
              From chaotic to <span className="italic font-serif text-[#FF6A13]">seamless</span> in three steps.
            </h2>
          </motion.div>
          <motion.div
            className="max-w-md"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.1 }}
          >
            <p className="text-muted-foreground dark:text-[#888] text-lg md:text-xl leading-relaxed">
              We've distilled property management into a streamlined workflow. Set up once, and let Casaora handle the heavy lifting while you scale.
            </p>
          </motion.div>
        </div>

        {/* Big Product Window Mockup */}
        <motion.div
          className="relative w-full rounded-[2rem] border border-border dark:border-white/10 bg-card dark:bg-[#0a0a0a] shadow-2xl dark:shadow-none overflow-hidden"
          style={{ y, opacity }}
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          {/* Subtle top glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-[#FF6A13]/50 to-transparent" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-24 bg-[#FF6A13]/10 blur-[80px] rounded-full pointer-events-none" />

          {/* Window Header (Browser/App bar) */}
          <div className="flex items-center px-6 py-4 border-b border-border dark:border-white/5 bg-muted/30 dark:bg-white/[0.02]">
            <div className="flex gap-2">
              <div className="w-3 h-3 rounded-full bg-black/10 dark:bg-white/10" />
              <div className="w-3 h-3 rounded-full bg-black/10 dark:bg-white/10" />
              <div className="w-3 h-3 rounded-full bg-black/10 dark:bg-white/10" />
            </div>
            <div className="mx-auto px-4 py-1.5 rounded-md bg-background dark:bg-white/5 border border-border dark:border-white/5 text-[10px] text-muted-foreground dark:text-white/40 font-mono tracking-wider">
              CASAORA.APP / DASHBOARD
            </div>
          </div>

          {/* Abstract UI Inside Window */}
          <div className="p-8 md:p-12 lg:p-16 relative aspect-auto min-h-[500px] flex flex-col items-center justify-center">

            {/* Dynamic background grid or lines */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />

            {/* UI Elements representation */}
            <div className="relative z-10 w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6">
              {steps.map((step, idx) => (
                <motion.div
                  key={step.number}
                  className="flex flex-col p-6 rounded-xl border border-border dark:border-white/10 bg-background/80 dark:bg-[#111]/80 backdrop-blur-sm shadow-sm dark:shadow-none"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + (idx * 0.15), duration: 0.5 }}
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6A13]/20 to-transparent flex items-center justify-center mb-6 border border-[#FF6A13]/20">
                    <span className="text-[#FF6A13] font-mono text-sm">{step.number}</span>
                  </div>
                  <h4 className="text-foreground dark:text-white font-medium mb-2">{step.title}</h4>
                  <p className="text-muted-foreground dark:text-[#666] text-sm leading-relaxed">{step.description}</p>

                  {/* Mock progress/data bar */}
                  <div className="mt-6 w-full h-1.5 rounded-full bg-muted dark:bg-white/5 overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-[#FF6A13]/50 to-[#FF6A13]"
                      initial={{ width: "0%" }}
                      whileInView={{ width: idx === 0 ? "100%" : idx === 1 ? "60%" : "30%" }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.8 + (idx * 0.2), duration: 1.5, ease: "easeOut" }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Central floating abstract elements to simulate data/charts */}
            <div className="mt-12 w-full max-w-4xl relative h-48 rounded-xl border border-border dark:border-white/5 bg-muted/10 dark:bg-white/[0.01] flex items-end justify-between p-6 gap-2 overflow-hidden shadow-inner dark:shadow-none">
              <div className="absolute inset-0 bg-gradient-to-t from-[#FF6A13]/5 to-transparent mix-blend-overlay" />
              {Array.from({ length: 12 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-full bg-foreground/10 dark:bg-white/10 rounded-t-sm"
                  initial={{ height: 0 }}
                  whileInView={{ height: `${30 + Math.random() * 60}%` }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.5 + (i * 0.05), duration: 0.8, ease: "easeOut" }}
                />
              ))}
            </div>

          </div>
        </motion.div>

      </div>
    </section>
  );
}
