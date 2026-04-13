import { motion } from "framer-motion";
import { Star } from "lucide-react";
import type { Review } from "@/lib/reviewsData";

interface ReviewCardProps {
  review: Review;
  index?: number;
}

const sourceLabel: Record<Review["source"], string> = {
  google: "Google",
  yelp: "Yelp",
  facebook: "Facebook",
};

export default function ReviewCard({ review, index = 0 }: ReviewCardProps) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, delay: index * 0.08 }}
      className="glass-card p-6 flex flex-col gap-4"
    >
      {/* Stars */}
      <div className="flex gap-1" aria-label={`${review.rating} out of 5 stars`}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            size={16}
            aria-hidden="true"
            style={{
              fill: i < review.rating ? "oklch(0.68 0.08 60)" : "transparent",
              color: i < review.rating ? "oklch(0.68 0.08 60)" : "oklch(1 0 0 / 20%)",
            }}
          />
        ))}
      </div>

      {/* Text */}
      <blockquote>
        <p className="text-sm leading-relaxed" style={{ color: "oklch(1 0 0 / 70%)" }}>
          "{review.text}"
        </p>
      </blockquote>

      {/* Author + source */}
      <footer className="flex items-center justify-between mt-auto">
        <p className="font-display font-bold text-sm">{review.author}</p>
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: "oklch(1 0 0 / 8%)", color: "oklch(1 0 0 / 40%)" }}
        >
          {sourceLabel[review.source]}
        </span>
      </footer>
    </motion.article>
  );
}
