import { motion } from "framer-motion";
import { MapPin, Phone, Clock, Navigation } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import HoursTable from "@/components/HoursTable";
import { BUSINESS_INFO } from "@/lib/constants";

export default function Location() {
  return (
    <div className="min-h-screen">
      <Navbar />

      <main className="pt-28 pb-20" aria-label="Location and hours">
        <div className="container">
          {/* Heading */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-12"
          >
            <p className="section-label mb-4">Find us</p>
            <h1 className="font-display font-black text-5xl md:text-7xl leading-tight" style={{ letterSpacing: "-0.03em" }}>
              Location &amp;{" "}
              <span style={{ color: "oklch(0.45 0.15 25)" }}>Hours</span>
            </h1>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: info + hours */}
            <div className="space-y-6">
              {/* Address card */}
              <motion.div
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="glass-card p-6 md:p-8"
              >
                <h2 className="font-display font-bold text-xl mb-6">Address</h2>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <MapPin size={18} style={{ color: "oklch(0.45 0.15 25)" }} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-medium">{BUSINESS_INFO.address}</p>
                      <a
                        href={`https://maps.google.com/?q=${encodeURIComponent(BUSINESS_INFO.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm mt-1 hover:opacity-80 transition-opacity"
                        style={{ color: "oklch(0.45 0.15 25)" }}
                      >
                        <Navigation size={12} aria-hidden="true" />
                        Get directions
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Phone size={18} style={{ color: "oklch(0.45 0.15 25)" }} className="shrink-0" aria-hidden="true" />
                    <a href={BUSINESS_INFO.phoneLink} className="font-medium hover:opacity-80 transition-opacity">
                      {BUSINESS_INFO.phone}
                    </a>
                  </div>
                  <div className="flex items-start gap-3">
                    <Clock size={18} style={{ color: "oklch(0.45 0.15 25)" }} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-medium">Closed Sunday</p>
                      <p className="text-sm mt-0.5" style={{ color: "oklch(1 0 0 / 50%)" }}>Mon–Sat open for breakfast &amp; lunch/dinner</p>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Hours table */}
              <motion.div
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <HoursTable />
              </motion.div>
            </div>

            {/* Right: map embed */}
            <motion.div
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="glass-card overflow-hidden"
              style={{ minHeight: "400px" }}
            >
              <iframe
                title="Pony Express Burritos on Google Maps"
                src={BUSINESS_INFO.googleMaps.embedUrl}
                width="100%"
                height="100%"
                style={{ border: 0, minHeight: "400px", display: "block", filter: "invert(90%) hue-rotate(180deg)" }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </motion.div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
