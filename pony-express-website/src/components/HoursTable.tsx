import { BUSINESS_INFO } from "@/lib/constants";

export default function HoursTable() {
  return (
    <div className="glass-card p-6 md:p-8">
      <h3 className="font-display font-bold text-xl mb-6">Hours</h3>
      <table className="w-full" aria-label="Business hours">
        <thead>
          <tr>
            <th className="section-label text-left pb-3">Day</th>
            <th className="section-label text-left pb-3">Breakfast</th>
            <th className="section-label text-left pb-3">Lunch</th>
          </tr>
        </thead>
        <tbody>
          {BUSINESS_INFO.hours.weekdays.map((row) => (
            <tr
              key={row.day}
              className="border-t"
              style={{ borderColor: "oklch(1 0 0 / 6%)" }}
            >
              <td className="py-3 font-medium text-sm">{row.day}</td>
              <td className="py-3 text-sm" style={{ color: "oklch(1 0 0 / 55%)" }}>{row.breakfast}</td>
              <td className="py-3 text-sm" style={{ color: "oklch(1 0 0 / 55%)" }}>{row.lunch}</td>
            </tr>
          ))}
          <tr className="border-t" style={{ borderColor: "oklch(1 0 0 / 6%)" }}>
            <td className="py-3 font-medium text-sm">Sunday</td>
            <td className="py-3 text-sm col-span-2" style={{ color: "oklch(1 0 0 / 35%)" }}>Closed</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
