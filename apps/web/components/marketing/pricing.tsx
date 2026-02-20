"use client";

import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export function Pricing() {
  return (
    <section className="bg-background dark:bg-black py-24 md:py-32 relative overflow-hidden">
      {/* Massive radial brand glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-[#FF6A13]/10 blur-[150px] rounded-full pointer-events-none" />

      <div className="container relative z-10 mx-auto px-4 max-w-5xl text-center">
        <motion.div
          className="relative overflow-hidden rounded-[2.5rem] border border-border dark:border-white/10 bg-card/50 dark:bg-[#0a0a0a]/80 backdrop-blur-xl p-10 md:p-20 shadow-2xl flex flex-col items-center"
          initial={{ opacity: 0, y: 30 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          {/* Subtle inner top highlight */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-black/10 dark:via-white/20 to-transparent" />

          <h2 className="mb-6 font-medium text-4xl tracking-tight text-foreground dark:text-white md:text-6xl lg:text-7xl">
            Ready to <span className="font-serif text-[#FF6A13] italic">elevate</span> your rental business?
          </h2>

          <p className="mb-12 max-w-2xl text-muted-foreground dark:text-[#888] text-lg md:text-xl leading-relaxed">
            Join the fastest-growing network of hospitality professionals in Paraguay. Set up in minutes and watch your occupancy scale.
          </p>

          <div className="flex flex-col md:flex-row items-center gap-6 mb-12">
            {[
              "Multi-currency support",
              "2-way calendar sync",
              "Automated messaging",
            ].map((item, idx) => (
              <motion.div
                key={item}
                className="flex items-center gap-2 text-foreground/80 dark:text-[#ccc]"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + (idx * 0.1) }}
              >
                <CheckCircle2 className="h-5 w-5 text-[#FF6A13]" />
                <span className="font-medium">{item}</span>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            transition={{ delay: 0.6 }}
            viewport={{ once: true }}
            whileInView={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4"
          >
            <Link
              className="group relative flex items-center justify-center gap-3 rounded-full bg-[#FF6A13] px-10 py-5 font-medium text-lg text-white shadow-[0_0_40px_-10px_rgba(255,106,19,0.5)] transition-all hover:bg-[#ff7b2e] hover:shadow-[0_0_60px_-10px_rgba(255,106,19,0.7)]"
              href="/demo"
            >
              <span className="relative z-10">Request a Demo</span>
              <ArrowRight className="relative z-10 h-5 w-5 transition-transform group-hover:translate-x-1" />
              {/* Inner button glow */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/20 to-transparent opacity-0 mix-blend-overlay transition-opacity group-hover:opacity-100" />
            </Link>
            <p className="text-muted-foreground dark:text-[#666] text-sm font-medium tracking-wide">
              No credit card required. Cancel anytime.
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
