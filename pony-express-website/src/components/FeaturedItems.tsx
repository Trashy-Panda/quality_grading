import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { menuData } from "@/lib/menuData";
import MenuCard from "./MenuCard";

export default function FeaturedItems() {
  const lunchCategory = menuData.find((c) => c.id === "lunch");
  const featuredItems = lunchCategory?.items.filter((item) => item.isSignature).slice(0, 3) ?? [];

  return (
    <section className="py-20 md:py-32" aria-labelledby="featured-heading">
      <div className="container">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
          <div>
            <p className="section-label mb-3">The classics</p>
            <h2 id="featured-heading" className="font-display font-bold text-4xl md:text-5xl">
              Signature{" "}
              <span style={{ color: "oklch(0.45 0.15 25)" }}>Burritos</span>
            </h2>
          </div>
          <Link href="/menu">
            <motion.span
              className="flex items-center gap-2 text-sm font-medium transition-colors"
              style={{ color: "oklch(1 0 0 / 50%)" }}
              whileHover={{ color: "oklch(1 0 0 / 90%)" }}
            >
              Full Menu
              <ArrowUpRight size={16} aria-hidden="true" />
            </motion.span>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {featuredItems.map((item, i) => (
            <MenuCard key={item.id} item={item} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
