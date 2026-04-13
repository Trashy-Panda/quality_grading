import { motion } from "framer-motion";
import { Star } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ReviewCard from "@/components/ReviewCard";
import WesternDivider from "@/components/WesternDivider";
import { reviewsData, overallRating, totalReviews } from "@/lib/reviewsData";

export default function Reviews() {
  return (
    <div className="min-h-screen">
      <Navbar />

      <main className="pt-28 pb-20" aria-label="Customer reviews">
        <div className="container">
          {/* Heading */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-12"
          >
            <p className="section-label mb-4">What people say</p>
            <h1 className="font-display font-black text-5xl md:text-7xl leading-tight" style={{ letterSpacing: "-0.03em" }}>
              Guest <span style={{ color: "oklch(0.45 0.15 25)" }}>Reviews</span>
            </h1>
          </motion.div>

          {/* Rating summary */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="glass-card p-6 md:p-8 mb-12 flex flex-col sm:flex-row items-start sm:items-center gap-6"
          >
            <div className="text-center sm:text-left">
              <p
                className="font-display font-black text-6xl"
                style={{ color: "oklch(0.45 0.15 25)" }}
                aria-label={`Overall rating: ${overallRating} out of 5`}
              >
                {overallRating}
              </p>
              <div className="flex gap-1 mt-2 justify-center sm:justify-start" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    size={18}
                    style={{
                      fill: i < Math.round(overallRating) ? "oklch(0.68 0.08 60)" : "transparent",
                      color: i < Math.round(overallRating) ? "oklch(0.68 0.08 60)" : "oklch(1 0 0 / 20%)",
                    }}
                  />
                ))}
              </div>
              <p className="text-sm mt-1" style={{ color: "oklch(1 0 0 / 40%)" }}>
                Based on {totalReviews} reviews
              </p>
            </div>
            <div
              className="hidden sm:block w-px self-stretch"
              style={{ background: "oklch(1 0 0 / 8%)" }}
              aria-hidden="true"
            />
            <div>
              <p className="font-display font-bold text-lg mb-1">Our guests love us</p>
              <p className="text-sm" style={{ color: "oklch(1 0 0 / 50%)" }}>
                We take pride in every burrito we make. Fresh ingredients, fast service, and friendly faces — every time.
              </p>
            </div>
          </motion.div>

          {/* Reviews grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {reviewsData.map((review, i) => (
              <ReviewCard key={review.id} review={review} index={i} />
            ))}
          </div>

          <WesternDivider className="mt-20" />
        </div>
      </main>

      <Footer />
    </div>
  );
}
