import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 flex items-center justify-center px-6 py-20" aria-label="Page not found">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="glass-card p-10 md:p-16 text-center max-w-lg w-full"
        >
          <p className="font-display font-black text-8xl mb-4" style={{ color: "oklch(0.45 0.15 25 / 30%)" }} aria-hidden="true">
            404
          </p>
          <h1 className="font-display font-bold text-3xl mb-3">Lost on the trail?</h1>
          <p className="text-sm mb-8" style={{ color: "oklch(1 0 0 / 50%)" }}>
            This page doesn't exist. Head back to the ranch.
          </p>
          <Link href="/">
            <motion.span
              className="inline-flex items-center gap-2 px-8 py-3 rounded-full font-display font-bold text-sm"
              style={{ background: "oklch(0.45 0.15 25)", color: "oklch(0.92 0.05 80)" }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              Back to Home
              <ArrowUpRight size={16} aria-hidden="true" />
            </motion.span>
          </Link>
        </motion.div>
      </main>

      <Footer />
    </div>
  );
}
