import { motion } from "framer-motion";
import { ArrowUpRight, MapPin, Clock } from "lucide-react";
import { Link } from "wouter";
import { BUSINESS_INFO } from "@/lib/constants";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col justify-center px-6 md:px-16 pt-24 pb-16" aria-label="Welcome hero">
      {/* Background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% 0%, oklch(0.45 0.15 25 / 15%) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 container">
        {/* Top: eyebrow + headline */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mb-8 md:mb-12"
        >
          <p className="section-label mb-4">Canyon, TX — Est. 2021</p>
          <h1 className="font-display font-black text-5xl sm:text-7xl md:text-8xl leading-tight mb-4"
            style={{ letterSpacing: "-0.03em" }}>
            Pony Express{" "}
            <span style={{ color: "oklch(0.45 0.15 25)" }}>Burritos</span>
          </h1>
          <p className="tagline text-2xl">{BUSINESS_INFO.tagline}</p>
        </motion.div>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="flex flex-col sm:flex-row gap-4 mb-16"
        >
          <Link href="/menu">
            <motion.span
              className="group flex items-center gap-3 px-8 py-4 rounded-full font-display font-bold text-sm tracking-wide hover:opacity-90 transition-opacity"
              style={{ background: "oklch(0.45 0.15 25)", color: "oklch(0.92 0.05 80)" }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              View Menu
              <ArrowUpRight size={16} className="group-hover:rotate-45 transition-transform" aria-hidden="true" />
            </motion.span>
          </Link>
          <Link href="/order">
            <motion.span
              className="group flex items-center gap-3 px-8 py-4 rounded-full font-display font-bold text-sm tracking-wide transition-colors"
              style={{ border: "2px solid oklch(0.45 0.15 25)", color: "oklch(0.45 0.15 25)" }}
              whileHover={{ scale: 1.02, background: "oklch(0.45 0.15 25 / 10%)" }}
              whileTap={{ scale: 0.98 }}
            >
              Order Now
              <ArrowUpRight size={16} className="group-hover:rotate-45 transition-transform" aria-hidden="true" />
            </motion.span>
          </Link>
        </motion.div>

        {/* Info cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.55 }}
            className="glass-card p-6"
          >
            <div className="flex items-start gap-3">
              <Clock size={20} style={{ color: "oklch(0.45 0.15 25)" }} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="section-label mb-1">Hours</p>
                <p className="font-display font-bold text-base">Mon–Sat</p>
                <p className="text-sm mt-0.5" style={{ color: "oklch(1 0 0 / 50%)" }}>
                  Breakfast 7am • Lunch 11am–8pm
                </p>
                <p className="text-xs mt-1" style={{ color: "oklch(1 0 0 / 35%)" }}>Closed Sunday</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.7 }}
            className="glass-card p-6"
          >
            <div className="flex items-start gap-3">
              <MapPin size={20} style={{ color: "oklch(0.45 0.15 25)" }} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="section-label mb-1">Location</p>
                <p className="font-display font-bold text-base">2808 4th Ave Ste C</p>
                <p className="text-sm mt-0.5" style={{ color: "oklch(1 0 0 / 50%)" }}>Canyon, TX 79015</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
