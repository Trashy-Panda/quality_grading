import { useState } from "react";
import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import MenuCard from "@/components/MenuCard";
import WesternDivider from "@/components/WesternDivider";
import { menuData } from "@/lib/menuData";

export default function Menu() {
  const [activeCategory, setActiveCategory] = useState("lunch");
  const currentCategory = menuData.find((c) => c.id === activeCategory);

  return (
    <div className="min-h-screen">
      <Navbar />

      <main className="pt-28 pb-20" aria-label="Full menu">
        <div className="container">
          {/* Heading */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-12"
          >
            <p className="section-label mb-4">What we serve</p>
            <h1 className="font-display font-black text-5xl md:text-7xl leading-tight" style={{ letterSpacing: "-0.03em" }}>
              Our <span style={{ color: "oklch(0.45 0.15 25)" }}>Menu</span>
            </h1>
          </motion.div>

          {/* Category tabs */}
          <div
            className="flex flex-wrap gap-3 mb-12 pb-6 border-b"
            role="tablist"
            aria-label="Menu categories"
            style={{ borderColor: "oklch(1 0 0 / 6%)" }}
          >
            {menuData.map((category) => (
              <button
                key={category.id}
                role="tab"
                aria-selected={activeCategory === category.id}
                aria-controls={`panel-${category.id}`}
                onClick={() => setActiveCategory(category.id)}
                className="px-5 py-2 rounded-full font-display font-bold text-sm transition-all"
                style={
                  activeCategory === category.id
                    ? { background: "oklch(0.45 0.15 25)", color: "oklch(0.92 0.05 80)" }
                    : { background: "oklch(1 0 0 / 6%)", color: "oklch(1 0 0 / 60%)" }
                }
              >
                {category.name}
              </button>
            ))}
          </div>

          {/* Items panel */}
          {currentCategory && (
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              id={`panel-${activeCategory}`}
              role="tabpanel"
              aria-label={currentCategory.name}
            >
              <div className="mb-8">
                <p className="section-label mb-1">{currentCategory.label}</p>
                {currentCategory.description && (
                  <p className="text-sm" style={{ color: "oklch(1 0 0 / 50%)" }}>{currentCategory.description}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {currentCategory.items.map((item, i) => (
                  <MenuCard key={item.id} item={item} index={i} />
                ))}
              </div>
            </motion.div>
          )}

          <WesternDivider className="mt-20" />
        </div>
      </main>

      <Footer />
    </div>
  );
}
