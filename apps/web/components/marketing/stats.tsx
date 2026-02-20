"use client";

import { motion } from "framer-motion";

const stats = [
  { value: "15h+", label: "Saved per week on admin workflows" },
  { value: "0%", label: "Double bookings across all channel sources" },
  { value: "40%", label: "Average revenue increase for owners" },
];

export function Stats() {
  return (
    <section className="bg-background dark:bg-black py-24 md:py-32 relative overflow-hidden text-center">
      {/* Background glow behind text */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[300px] bg-[#FF6A13]/20 blur-[120px] rounded-full pointer-events-none" />

      <div className="container relative z-10 mx-auto max-w-6xl px-4">
        <div className="mb-20">
          <motion.h2
            className="mb-4 font-bold text-4xl text-foreground dark:text-white tracking-tight md:text-5xl lg:text-6xl"
            initial={{ opacity: 0, y: 20 }}
            viewport={{ once: true }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            Real results for{" "}
            <span className="font-serif text-[#FF6A13] italic">
              real managers.
            </span>
          </motion.h2>
        </div>

        <div className="grid gap-px bg-border dark:bg-white/10 md:grid-cols-3 border-y border-border dark:border-white/10 relative overflow-hidden">
          {/* Shimmer effect over borders */}
          <motion.div
            className="absolute top-0 left-0 w-[50%] h-[1px] bg-gradient-to-r from-transparent via-[#FF6A13] to-transparent z-10"
            animate={{ x: ["-100%", "200%"] }}
            transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
          />

          {stats.map((stat, idx) => (
            <motion.div
              className="flex flex-col items-center justify-center bg-background dark:bg-black px-6 py-12 md:py-16"
              initial={{ opacity: 0, y: 20 }}
              key={stat.label}
              transition={{ delay: idx * 0.15, duration: 0.6 }}
              viewport={{ once: true }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <div className="mb-4 font-medium text-6xl tracking-tighter drop-shadow-md md:text-7xl lg:text-8xl">
                <span className="bg-gradient-to-b from-foreground to-foreground/40 dark:from-white dark:to-white/40 bg-clip-text text-transparent">
                  {stat.value}
                </span>
              </div>
              <p className="max-w-[200px] font-medium text-muted-foreground dark:text-[#888] leading-relaxed">
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
