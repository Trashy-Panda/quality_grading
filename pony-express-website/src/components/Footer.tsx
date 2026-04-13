import { Link } from "wouter";
import { Facebook, Instagram, Phone, MapPin } from "lucide-react";
import { BUSINESS_INFO } from "@/lib/constants";

export default function Footer() {
  return (
    <footer
      className="border-t py-12 mt-0"
      style={{ borderColor: "oklch(1 0 0 / 8%)" }}
    >
      <div className="container">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Brand */}
          <div>
            <h3 className="font-display font-bold text-xl mb-2">{BUSINESS_INFO.name}</h3>
            <p className="tagline text-base mb-4">The fastest burrito in the west!</p>
            <div className="flex gap-3">
              <a
                href={BUSINESS_INFO.socialMedia.facebook}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Pony Express Burritos on Facebook"
                className="flex items-center justify-center w-9 h-9 rounded-full hover:opacity-80 transition-opacity"
                style={{ background: "oklch(1 0 0 / 8%)" }}
              >
                <Facebook size={16} aria-hidden="true" />
              </a>
              <a
                href={BUSINESS_INFO.socialMedia.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Pony Express Burritos on Instagram"
                className="flex items-center justify-center w-9 h-9 rounded-full hover:opacity-80 transition-opacity"
                style={{ background: "oklch(1 0 0 / 8%)" }}
              >
                <Instagram size={16} aria-hidden="true" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <nav aria-label="Footer navigation">
            <h4 className="section-label mb-4">Quick Links</h4>
            <ul className="space-y-2">
              {[
                { label: "Menu", href: "/menu" },
                { label: "Location & Hours", href: "/location" },
                { label: "Reviews", href: "/reviews" },
                { label: "Order Online", href: "/order" },
              ].map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>
                    <span className="text-foreground/50 hover:text-foreground text-sm transition-colors">
                      {link.label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Contact */}
          <div>
            <h4 className="section-label mb-4">Contact</h4>
            <ul className="space-y-3">
              <li>
                <a href={BUSINESS_INFO.phoneLink} className="flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors">
                  <Phone size={14} aria-hidden="true" />
                  {BUSINESS_INFO.phone}
                </a>
              </li>
              <li>
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(BUSINESS_INFO.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors"
                >
                  <MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {BUSINESS_INFO.address}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div
          className="pt-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs"
          style={{ borderTop: "1px solid oklch(1 0 0 / 8%)", color: "oklch(1 0 0 / 30%)" }}
        >
          <p>© {new Date().getFullYear()} Pony Express Burritos. Canyon, TX.</p>
          <p>2808 4th Ave Ste C, Canyon, TX 79015</p>
        </div>
      </div>
    </footer>
  );
}
