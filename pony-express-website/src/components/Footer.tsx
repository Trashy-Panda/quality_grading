import { Link } from "wouter";
import { Phone, MapPin } from "lucide-react";
import { BUSINESS_INFO } from "@/lib/constants";

function FacebookIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function InstagramIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

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
                <FacebookIcon size={16} />
              </a>
              <a
                href={BUSINESS_INFO.socialMedia.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Pony Express Burritos on Instagram"
                className="flex items-center justify-center w-9 h-9 rounded-full hover:opacity-80 transition-opacity"
                style={{ background: "oklch(1 0 0 / 8%)" }}
              >
                <InstagramIcon size={16} />
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
