import { motion } from "framer-motion";
import { Phone } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import OrderButtons from "@/components/OrderButtons";
import WesternDivider from "@/components/WesternDivider";
import { BUSINESS_INFO } from "@/lib/constants";

export default function Order() {
  return (
    <div className="min-h-screen">
      <Navbar />

      <main className="pt-28 pb-20" aria-label="Order online">
        <div className="container">
          {/* Heading */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-12"
          >
            <p className="section-label mb-4">Skip the line</p>
            <h1 className="font-display font-black text-5xl md:text-7xl leading-tight" style={{ letterSpacing: "-0.03em" }}>
              Order <span style={{ color: "oklch(0.45 0.15 25)" }}>Online</span>
            </h1>
          </motion.div>

          {/* Delivery platforms */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mb-16"
          >
            <p className="section-label mb-6">Delivery platforms</p>
            <OrderButtons />
          </motion.div>

          <WesternDivider className="mb-16" />

          {/* Call to order */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="glass-card p-8 md:p-12 text-center max-w-xl mx-auto"
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
              style={{ background: "oklch(0.45 0.15 25 / 15%)" }}
            >
              <Phone size={28} style={{ color: "oklch(0.45 0.15 25)" }} aria-hidden="true" />
            </div>
            <h2 className="font-display font-bold text-2xl mb-3">Prefer to call?</h2>
            <p className="text-sm mb-6" style={{ color: "oklch(1 0 0 / 50%)" }}>
              Give us a call and we'll have your order ready for pickup.
            </p>
            <motion.a
              href={BUSINESS_INFO.phoneLink}
              className="inline-flex items-center gap-3 px-8 py-4 rounded-full font-display font-bold"
              style={{ background: "oklch(0.45 0.15 25)", color: "oklch(0.92 0.05 80)" }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              aria-label={`Call Pony Express Burritos at ${BUSINESS_INFO.phone}`}
            >
              <Phone size={18} aria-hidden="true" />
              {BUSINESS_INFO.phone}
            </motion.a>
          </motion.div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
