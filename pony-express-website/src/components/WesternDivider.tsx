export default function WesternDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 ${className}`} aria-hidden="true">
      <div className="flex-1 h-px" style={{ background: "oklch(1 0 0 / 8%)" }} />
      <span className="section-label px-3" style={{ color: "oklch(0.45 0.15 25)" }}>✦</span>
      <div className="flex-1 h-px" style={{ background: "oklch(1 0 0 / 8%)" }} />
    </div>
  );
}
