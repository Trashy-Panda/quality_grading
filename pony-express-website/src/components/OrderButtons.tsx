import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { BUSINESS_INFO } from "@/lib/constants";

const platforms = [
  { id: "doordash", label: "DoorDash", url: BUSINESS_INFO.orderingPlatforms.doordash },
  { id: "ubereats", label: "Uber Eats", url: BUSINESS_INFO.orderingPlatforms.ubereats },
  { id: "grubhub", label: "Grubhub", url: BUSINESS_INFO.orderingPlatforms.grubhub },
  { id: "seamless", label: "Seamless", url: BUSINESS_INFO.orderingPlatforms.seamless },
];

interface OrderButtonsProps {
  compact?: boolean;
}

export default function OrderButtons({ compact = false }: OrderButtonsProps) {
  return (
    <div className={`grid grid-cols-2 ${compact ? "gap-3" : "md:grid-cols-4 gap-4"}`}>
      {platforms.map((p, i) => (
        <motion.a
          key={p.id}
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: i * 0.07 }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="glass-card p-4 flex items-center justify-between gap-2 rounded-xl"
          aria-label={`Order on ${p.label}`}
        >
          <span className="font-display font-bold text-sm">{p.label}</span>
          <ExternalLink size={14} style={{ color: "oklch(1 0 0 / 40%)" }} aria-hidden="true" />
        </motion.a>
      ))}
    </div>
  );
}
