import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Phone } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { BUSINESS_INFO } from "@/lib/constants";

const navLinks = [
  { label: "Menu", href: "/menu" },
  { label: "Location", href: "/location" },
  { label: "Reviews", href: "/reviews" },
  { label: "Order", href: "/order" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [location]);

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6 }}
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
      style={{
        background: scrolled ? "oklch(0.08 0.01 30 / 85%)" : "transparent",
        backdropFilter: scrolled ? "blur(20px) saturate(1.5)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(20px) saturate(1.5)" : "none",
        borderBottom: scrolled ? "1px solid oklch(1 0 0 / 8%)" : "1px solid transparent",
      }}
    >
      <div className="container flex items-center justify-between h-16 md:h-20">
        {/* Logo */}
        <Link href="/">
          <span className="font-display font-bold text-xl tracking-tight text-foreground select-none hover:opacity-80 transition-opacity">
            Pony Express
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8" aria-label="Main navigation">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              <span
                className={`text-sm font-medium transition-colors duration-200 ${
                  location === link.href
                    ? "text-[oklch(0.45_0.15_25)]"
                    : "text-foreground/60 hover:text-foreground"
                }`}
              >
                {link.label}
              </span>
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <a
            href={BUSINESS_INFO.phoneLink}
            aria-label="Call Pony Express Burritos"
            className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm hover:opacity-90 transition-opacity"
            style={{ background: "oklch(0.45 0.15 25)", color: "oklch(0.92 0.05 80)" }}
          >
            <Phone size={15} aria-hidden="true" />
            Call
          </a>

          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/10 transition-colors"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="md:hidden glass-card mx-4 mb-4 p-4"
            role="navigation"
            aria-label="Mobile navigation"
          >
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                <span className="block py-3 text-foreground/70 hover:text-foreground transition-colors border-b border-white/5 last:border-0">
                  {link.label}
                </span>
              </Link>
            ))}
            <a
              href={BUSINESS_INFO.phoneLink}
              className="mt-3 flex items-center gap-2 py-3 font-medium"
              style={{ color: "oklch(0.45 0.15 25)" }}
            >
              <Phone size={16} aria-hidden="true" />
              {BUSINESS_INFO.phone}
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
