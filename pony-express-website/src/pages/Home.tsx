import { motion } from "framer-motion";
import { ArrowUpRight, Star } from "lucide-react";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Hero from "@/components/Hero";
import FeaturedItems from "@/components/FeaturedItems";
import ReviewCard from "@/components/ReviewCard";
import OrderButtons from "@/components/OrderButtons";
import WesternDivider from "@/components/WesternDivider";
import { reviewsData, overallRating, totalReviews } from "@/lib/reviewsData";

export default function Home() {
  const topReviews = reviewsData.filter((r) => r.rating >= 4).slice(0, 3);

  return (
    <div className="min-h-screen">
      <Navbar />
      <Hero />

      <div className="border-t" style={{ borderColor: "oklch(1 0 0 / 6%)" }} />
      <FeaturedItems />

      {/* Reviews snapshot */}
      <div className="border-t" style={{ borderColor: "oklch(1 0 0 / 6%)" }} />
      <section className="py-20 md:py-28" aria-labelledby="reviews-home-heading">
        <div className="container">
          <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
            <div>
              <p className="section-label mb-3">What people say</p>
              <h2 id="reviews-home-heading" className="font-display font-bold text-4xl md:text-5xl">
                Guest <span style={{ color: "oklch(0.45 0.15 25)" }}>Reviews</span>
              </h2>
              <div className="flex items-center gap-2 mt-3">
                <Star size={16} style={{ fill: "oklch(0.68 0.08 60)", color: "oklch(0.68 0.08 60)" }} aria-hidden="true" />
                <span className="font-display font-bold">{overallRating}</span>
                <span className="text-sm" style={{ color: "oklch(1 0 0 / 40%)" }}>({totalReviews} reviews)</span>
              </div>
            </div>
            <Link href="/reviews">
              <motion.span
                className="flex items-center gap-2 text-sm font-medium"
                style={{ color: "oklch(1 0 0 / 50%)" }}
                whileHover={{ color: "oklch(1 0 0 / 90%)" }}
              >
                All Reviews <ArrowUpRight size={16} aria-hidden="true" />
              </motion.span>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {topReviews.map((review, i) => (
              <ReviewCard key={review.id} review={review} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* Order CTA */}
      <div className="border-t" style={{ borderColor: "oklch(1 0 0 / 6%)" }} />
      <section className="py-20 md:py-28" aria-labelledby="order-home-heading">
        <div className="container">
          <WesternDivider className="mb-12" />
          <div className="text-center mb-12">
            <p className="section-label mb-3">Skip the line</p>
            <h2 id="order-home-heading" className="font-display font-bold text-4xl md:text-5xl mb-4">
              Order <span style={{ color: "oklch(0.45 0.15 25)" }}>Online</span>
            </h2>
            <p className="text-sm max-w-sm mx-auto" style={{ color: "oklch(1 0 0 / 50%)" }}>
              Available on your favorite delivery platforms
            </p>
          </div>
          <div className="max-w-2xl mx-auto">
            <OrderButtons />
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
