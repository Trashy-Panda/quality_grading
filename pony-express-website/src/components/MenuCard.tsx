import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import type { MenuItem } from "@/lib/menuData";
import { Link } from "wouter";

interface MenuCardProps {
  item: MenuItem;
  index?: number;
}

export default function MenuCard({ item, index = 0 }: MenuCardProps) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, delay: index * 0.07 }}
      className="glass-card p-6 flex flex-col h-full"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-base leading-snug mb-1 truncate">
            {item.name}
          </h3>
          {item.isSignature && (
            <span
              className="inline-block px-2 py-0.5 text-xs rounded-full font-medium"
              style={{ background: "oklch(0.45 0.15 25 / 20%)", color: "oklch(0.7 0.15 25)" }}
            >
              Signature
            </span>
          )}
        </div>
        <span className="font-display font-bold text-lg whitespace-nowrap shrink-0" style={{ color: "oklch(0.45 0.15 25)" }}>
          ${item.price.toFixed(2)}
        </span>
      </div>

      <p className="text-sm leading-relaxed flex-1 mb-4" style={{ color: "oklch(1 0 0 / 55%)" }}>
        {item.description}
      </p>

      {item.proteins && item.proteins.length > 0 && (
        <div className="mb-4">
          <p className="section-label mb-2">Protein Options</p>
          <div className="flex flex-wrap gap-1">
            {item.proteins.map((p) => (
              <span
                key={p}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "oklch(1 0 0 / 8%)", color: "oklch(1 0 0 / 60%)" }}
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      <Link href="/order">
        <motion.span
          className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-full text-sm font-medium transition-opacity hover:opacity-90"
          style={{ background: "oklch(0.45 0.15 25)", color: "oklch(0.92 0.05 80)" }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          <ExternalLink size={14} aria-hidden="true" />
          Order Now
        </motion.span>
      </Link>
    </motion.article>
  );
}
