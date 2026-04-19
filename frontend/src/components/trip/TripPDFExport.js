import { useRef, useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/*
 * Generates a beautiful, designer-quality PDF of the full itinerary.
 * Uses browser print with a hidden formatted div for maximum quality.
 * Includes: cover page, day-by-day itinerary, flight info, lodging, notes.
 */

const DAY_COLORS = [
  "#F59E0B", "#8b5cf6", "#10b981", "#f59e0b", "#3b82f6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
  "#ef4444", "#06b6d4", "#a855f7", "#eab308",
];

function getCategoryEmoji(cat) {
  const map = {
    attraction: "📸", restaurant: "🍽️", hotel: "🏨", activity: "🎯",
    shopping: "🛍️", transport: "🚌", cafe: "☕", bar: "🍸",
    museum: "🏛️", park: "🌳", beach: "🏖️", viewpoint: "🌅", other: "📍",
  };
  return map[cat] || "📍";
}

function formatDuration(min) {
  if (!min) return "";
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `~${h}h${m}` : `~${h}h`;
}

export default function TripPDFExport({ trip, onClose }) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";
  const printRef = useRef(null);
  const [generating, setGenerating] = useState(false);

  if (!trip) return null;

  const dayPlans = (trip.day_plans || []).sort((a, b) => a.day_number - b.day_number);
  const flights = trip.flights || [];
  const lodgings = trip.lodgings || [];
  const notes = trip.trip_notes || [];
  const totalPlaces = dayPlans.reduce((sum, d) => sum + (d.itinerary_items || []).length, 0);

  const handleExport = () => {
    setGenerating(true);
    setTimeout(() => {
      const content = printRef.current;
      if (!content) return;

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        setGenerating(false);
        return;
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${trip.name} — Mapass</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');

            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Inter', -apple-system, sans-serif; color: #1f2937; background: white; }

            @page { margin: 0; size: A4; }
            @media print {
              .no-print { display: none !important; }
              .page-break { page-break-before: always; }
            }

            .cover {
              height: 100vh;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              background: linear-gradient(135deg, #F59E0B 0%, #D97706 50%, #7c3aed 100%);
              color: white;
              text-align: center;
              padding: 60px;
              position: relative;
              overflow: hidden;
            }
            .cover::before {
              content: '';
              position: absolute;
              top: -50%;
              right: -30%;
              width: 600px;
              height: 600px;
              border-radius: 50%;
              background: rgba(255,255,255,0.05);
            }
            .cover::after {
              content: '';
              position: absolute;
              bottom: -40%;
              left: -20%;
              width: 500px;
              height: 500px;
              border-radius: 50%;
              background: rgba(255,255,255,0.03);
            }
            .cover-content { position: relative; z-index: 1; }
            .cover h1 {
              font-size: 48px;
              font-weight: 900;
              letter-spacing: -1px;
              margin-bottom: 12px;
              line-height: 1.1;
            }
            .cover .destination {
              font-size: 22px;
              font-weight: 300;
              opacity: 0.8;
              margin-bottom: 40px;
            }
            .cover .stats {
              display: flex;
              gap: 32px;
              justify-content: center;
              margin-bottom: 50px;
            }
            .cover .stat {
              text-align: center;
            }
            .cover .stat-value {
              font-size: 36px;
              font-weight: 800;
            }
            .cover .stat-label {
              font-size: 12px;
              opacity: 0.7;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .cover .brand {
              font-size: 14px;
              opacity: 0.5;
              letter-spacing: 3px;
              text-transform: uppercase;
            }
            .cover .date {
              font-size: 12px;
              opacity: 0.4;
              margin-top: 8px;
            }

            .day-page {
              padding: 50px;
              min-height: 100vh;
            }
            .day-header {
              display: flex;
              align-items: center;
              gap: 16px;
              margin-bottom: 32px;
              padding-bottom: 16px;
              border-bottom: 3px solid;
            }
            .day-number {
              width: 56px;
              height: 56px;
              border-radius: 16px;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-weight: 900;
              font-size: 22px;
              flex-shrink: 0;
            }
            .day-title {
              font-size: 28px;
              font-weight: 800;
              color: #111827;
              line-height: 1.2;
            }
            .day-city {
              font-size: 14px;
              color: #6b7280;
              font-weight: 400;
            }

            .item {
              display: flex;
              gap: 16px;
              padding: 16px 0;
              border-bottom: 1px solid #f3f4f6;
              position: relative;
            }
            .item:last-child { border-bottom: none; }

            .item-duration {
              display: inline-block;
              background: #f3f4f6;
              color: #6b7280;
              font-size: 11px;
              font-weight: 600;
              padding: 2px 8px;
              border-radius: 10px;
              margin-left: 4px;
            }

            .item-dot {
              width: 36px;
              flex-shrink: 0;
              display: flex;
              flex-direction: column;
              align-items: center;
              padding-top: 4px;
            }
            .item-dot-circle {
              width: 12px;
              height: 12px;
              border-radius: 50%;
              border: 3px solid;
              background: white;
            }
            .item-dot-line {
              width: 2px;
              flex: 1;
              min-height: 20px;
              opacity: 0.2;
            }

            .item-content { flex: 1; min-width: 0; }
            .item-name {
              font-size: 17px;
              font-weight: 700;
              color: #111827;
              margin-bottom: 4px;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .item-emoji { font-size: 18px; }
            .item-desc {
              font-size: 14px;
              color: #374151;
              line-height: 1.65;
              margin-bottom: 8px;
              margin-top: 4px;
            }
            .item-tip {
              margin-top: 6px;
              margin-bottom: 8px;
              padding: 8px 12px;
              background: #f0fdf4;
              border-left: 3px solid #22c55e;
              border-radius: 0 8px 8px 0;
              font-size: 13px;
              color: #166534;
              line-height: 1.5;
            }
            .item-tip::before {
              content: '💡 ';
            }
            .item-meta {
              display: flex;
              flex-wrap: wrap;
              gap: 12px;
              font-size: 12px;
              color: #9ca3af;
            }
            .item-meta span {
              display: flex;
              align-items: center;
              gap: 4px;
            }
            .item-rating { color: #f59e0b; font-weight: 600; }
            .item-address { color: #6b7280; }
            .item-notes {
              margin-top: 8px;
              padding: 10px 14px;
              background: #fffbeb;
              border-left: 3px solid #f59e0b;
              border-radius: 0 8px 8px 0;
              font-size: 13px;
              color: #78350f;
              line-height: 1.5;
            }
            .item-notes::before {
              content: '✏️ ';
            }
            .item-pricing {
              display: inline-block;
              background: #ecfdf5;
              color: #065f46;
              font-size: 11px;
              font-weight: 600;
              padding: 2px 8px;
              border-radius: 12px;
            }

            .logistics-page {
              padding: 50px;
              min-height: 100vh;
            }
            .section-title {
              font-size: 24px;
              font-weight: 800;
              color: #111827;
              margin-bottom: 24px;
              padding-bottom: 12px;
              border-bottom: 2px solid #e5e7eb;
            }
            .flight-card {
              border: 1px solid #e5e7eb;
              border-radius: 16px;
              padding: 20px 24px;
              margin-bottom: 16px;
              display: flex;
              align-items: center;
              gap: 20px;
            }
            .flight-airport {
              text-align: center;
              min-width: 60px;
            }
            .flight-code {
              font-size: 24px;
              font-weight: 800;
              color: #111827;
            }
            .flight-time {
              font-size: 14px;
              color: #6b7280;
            }
            .flight-date {
              font-size: 11px;
              color: #9ca3af;
            }
            .flight-line {
              flex: 1;
              text-align: center;
              position: relative;
            }
            .flight-line::before {
              content: '';
              position: absolute;
              top: 50%;
              left: 0;
              right: 0;
              height: 1px;
              border-top: 2px dashed #d1d5db;
            }
            .flight-line span {
              position: relative;
              background: white;
              padding: 0 8px;
              font-size: 12px;
              color: #6b7280;
            }
            .flight-details {
              font-size: 12px;
              color: #9ca3af;
              text-align: center;
              margin-top: 4px;
            }

            .lodging-card {
              border: 1px solid #e5e7eb;
              border-radius: 16px;
              padding: 20px 24px;
              margin-bottom: 16px;
            }
            .lodging-name {
              font-size: 18px;
              font-weight: 700;
              color: #111827;
              margin-bottom: 4px;
            }
            .lodging-meta {
              font-size: 13px;
              color: #6b7280;
              display: flex;
              flex-wrap: wrap;
              gap: 16px;
            }

            .note-card {
              border-left: 3px solid #8b5cf6;
              padding: 12px 16px;
              margin-bottom: 12px;
              background: #f5f3ff;
              border-radius: 0 12px 12px 0;
            }
            .note-title {
              font-size: 15px;
              font-weight: 700;
              color: #4c1d95;
              margin-bottom: 4px;
            }
            .note-content {
              font-size: 13px;
              color: #6b7280;
              line-height: 1.6;
              white-space: pre-wrap;
            }

            .footer {
              text-align: center;
              padding: 40px;
              color: #9ca3af;
              font-size: 12px;
            }
            .footer .brand-logo {
              font-size: 18px;
              font-weight: 800;
              color: #F59E0B;
              margin-bottom: 4px;
            }

            .print-btn {
              position: fixed;
              bottom: 24px;
              right: 24px;
              background: #F59E0B;
              color: white;
              border: none;
              padding: 14px 28px;
              border-radius: 12px;
              font-size: 15px;
              font-weight: 700;
              cursor: pointer;
              box-shadow: 0 4px 12px rgba(232,101,74,0.4);
              z-index: 100;
              font-family: inherit;
            }
            .print-btn:hover { background: #d55a3f; }
          </style>
        </head>
        <body>
          ${content.innerHTML}
          <button class="print-btn no-print" onclick="window.print()">
            ${pt ? "Salvar como PDF" : "Save as PDF"}
          </button>
        </body>
        </html>
      `);
      printWindow.document.close();
      setGenerating(false);
      onClose();
    }, 100);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {pt ? "Exportar Roteiro em PDF" : "Export Itinerary as PDF"}
            </h2>
            <p className="text-sm text-gray-500">
              {pt ? "Versão completa pronta para imprimir" : "Full version ready to print"}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl p-1">✕</button>
        </div>

        {/* Preview */}
        <div className="p-6">
          <div className="bg-gradient-to-br from-coral-50 to-violet-50 rounded-xl p-5 mb-5">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-coral-500 to-violet-500 flex items-center justify-center text-white text-xl font-black shadow-lg">
                V
              </div>
              <div>
                <h3 className="font-bold text-gray-900">{trip.name}</h3>
                <p className="text-sm text-gray-500">{trip.destination}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-white/80 rounded-lg py-2.5 px-2">
                <div className="text-lg font-black text-coral-500">{dayPlans.length}</div>
                <div className="text-[10px] text-gray-500 font-medium uppercase">{pt ? "Dias" : "Days"}</div>
              </div>
              <div className="bg-white/80 rounded-lg py-2.5 px-2">
                <div className="text-lg font-black text-violet-500">{totalPlaces}</div>
                <div className="text-[10px] text-gray-500 font-medium uppercase">{pt ? "Lugares" : "Places"}</div>
              </div>
              <div className="bg-white/80 rounded-lg py-2.5 px-2">
                <div className="text-lg font-black text-emerald-500">{flights.length}</div>
                <div className="text-[10px] text-gray-500 font-medium uppercase">{pt ? "Voos" : "Flights"}</div>
              </div>
            </div>
          </div>

          <div className="space-y-2 mb-5 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">✓</span>
              {pt ? "Roteiro dia a dia com descrições e dicas úteis" : "Day-by-day itinerary with descriptions and useful tips"}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">✓</span>
              {pt ? "Avaliações, endereços e tempo estimado em cada lugar" : "Ratings, addresses and estimated time at each place"}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">✓</span>
              {pt ? "Informações de voos e hospedagem" : "Flight and lodging information"}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">✓</span>
              {pt ? "Suas notas pessoais incluídas" : "Your personal notes included"}
            </div>
          </div>

          <button
            onClick={handleExport}
            disabled={generating}
            className="w-full bg-coral-500 hover:bg-coral-600 disabled:bg-coral-300 text-white font-bold py-3.5 rounded-xl transition-colors text-sm"
          >
            {generating
              ? (pt ? "Gerando..." : "Generating...")
              : (pt ? "Gerar PDF" : "Generate PDF")}
          </button>
        </div>
      </div>

      {/* Hidden printable content */}
      <div ref={printRef} style={{ position: "absolute", left: "-9999px", top: 0 }}>
        {/* ═══ COVER PAGE ═══ */}
        <div className="cover">
          <div className="cover-content">
            <h1>{trip.name}</h1>
            <div className="destination">{trip.destination}</div>
            <div className="stats">
              <div className="stat">
                <div className="stat-value">{dayPlans.length}</div>
                <div className="stat-label">{pt ? "Dias" : "Days"}</div>
              </div>
              <div className="stat">
                <div className="stat-value">{totalPlaces}</div>
                <div className="stat-label">{pt ? "Lugares" : "Places"}</div>
              </div>
              {flights.length > 0 && (
                <div className="stat">
                  <div className="stat-value">{flights.length}</div>
                  <div className="stat-label">{pt ? "Voos" : "Flights"}</div>
                </div>
              )}
            </div>
            <div className="brand">MAPASS</div>
            <div className="date">
              {pt ? "Gerado em" : "Generated on"} {new Date().toLocaleDateString(pt ? "pt-BR" : "en-US", { year: "numeric", month: "long", day: "numeric" })}
            </div>
          </div>
        </div>

        {/* ═══ DAY PAGES ═══ */}
        {dayPlans.map((day, dayIdx) => {
          const items = (day.itinerary_items || []).sort((a, b) => (a.position || 0) - (b.position || 0));
          const color = DAY_COLORS[dayIdx % DAY_COLORS.length];

          return (
            <div key={day.id} className="day-page page-break">
              <div className="day-header" style={{ borderColor: color }}>
                <div className="day-number" style={{ backgroundColor: color }}>
                  {day.day_number}
                </div>
                <div>
                  <div className="day-title">
                    {pt ? "Dia" : "Day"} {day.day_number}
                    {day.city && ` — ${day.city}`}
                  </div>
                  {day.date && (
                    <div className="day-city">
                      {new Date(day.date + "T12:00:00").toLocaleDateString(pt ? "pt-BR" : "en-US", { weekday: "long", month: "long", day: "numeric" })}
                    </div>
                  )}
                </div>
              </div>

              {items.map((item, itemIdx) => (
                <div key={item.id} className="item">
                  <div className="item-dot">
                    <div className="item-dot-circle" style={{ borderColor: color }} />
                    {itemIdx < items.length - 1 && <div className="item-dot-line" style={{ backgroundColor: color }} />}
                  </div>
                  <div className="item-content">
                    <div className="item-name">
                      <span className="item-emoji">{getCategoryEmoji(item.category)}</span>
                      {item.name}
                      {item.duration_minutes && <span className="item-duration">{formatDuration(item.duration_minutes)}</span>}
                    </div>
                    {item.description && <div className="item-desc">{item.description}</div>}
                    {item.tip && <div className="item-tip">{item.tip}</div>}
                    <div className="item-meta">
                      {item.google_rating && (
                        <span className="item-rating">
                          ★ {item.google_rating}
                          {item.google_reviews_count && ` (${item.google_reviews_count.toLocaleString()})`}
                        </span>
                      )}
                      {item.pricing_info && <span className="item-pricing">{item.pricing_info}</span>}
                    </div>
                    {item.address && <div className="item-address" style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>📍 {item.address}</div>}
                    {(item.personal_notes || item.notes) && (
                      <div className="item-notes">
                        {item.personal_notes || item.notes}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {items.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
                  {pt ? "Nenhum lugar adicionado neste dia" : "No places added for this day"}
                </div>
              )}
            </div>
          );
        })}

        {/* ═══ FLIGHTS & LODGING PAGE ═══ */}
        {(flights.length > 0 || lodgings.length > 0) && (
          <div className="logistics-page page-break">
            {flights.length > 0 && (
              <>
                <div className="section-title">✈️ {pt ? "Voos" : "Flights"}</div>
                {flights.map((f, i) => (
                  <div key={i} className="flight-card">
                    <div className="flight-airport">
                      <div className="flight-code">{f.departure_airport || "---"}</div>
                      <div className="flight-time">{f.departure_time || ""}</div>
                      <div className="flight-date">{f.departure_date ? new Date(f.departure_date + "T12:00:00").toLocaleDateString(pt ? "pt-BR" : "en-US", { month: "short", day: "numeric" }) : ""}</div>
                    </div>
                    <div className="flight-line">
                      <span>✈ {f.airline || ""} {f.flight_number || ""}</span>
                    </div>
                    <div className="flight-airport">
                      <div className="flight-code">{f.arrival_airport || "---"}</div>
                      <div className="flight-time">{f.arrival_time || ""}</div>
                      <div className="flight-date">{f.arrival_date ? new Date(f.arrival_date + "T12:00:00").toLocaleDateString(pt ? "pt-BR" : "en-US", { month: "short", day: "numeric" }) : ""}</div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {lodgings.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: flights.length > 0 ? 40 : 0 }}>🏨 {pt ? "Hospedagem" : "Lodging"}</div>
                {lodgings.map((l, i) => (
                  <div key={i} className="lodging-card">
                    <div className="lodging-name">{l.name || (pt ? "Hospedagem" : "Lodging")}</div>
                    <div className="lodging-meta">
                      {l.address && <span>📍 {l.address}</span>}
                      {l.check_in_date && <span>{pt ? "Check-in:" : "Check-in:"} {new Date(l.check_in_date + "T12:00:00").toLocaleDateString(pt ? "pt-BR" : "en-US", { month: "short", day: "numeric" })}</span>}
                      {l.check_out_date && <span>{pt ? "Check-out:" : "Check-out:"} {new Date(l.check_out_date + "T12:00:00").toLocaleDateString(pt ? "pt-BR" : "en-US", { month: "short", day: "numeric" })}</span>}
                      {l.phone && <span>📞 {l.phone}</span>}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ═══ NOTES PAGE ═══ */}
        {notes.length > 0 && (
          <div className="logistics-page page-break">
            <div className="section-title">📝 {pt ? "Notas da Viagem" : "Trip Notes"}</div>
            {notes.map((n, i) => (
              <div key={i} className="note-card">
                {n.title && <div className="note-title">{n.title}</div>}
                <div className="note-content">{n.content}</div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ FOOTER ═══ */}
        <div className="footer">
          <div className="brand-logo">Mapass</div>
          <div>{pt ? "Planeje com inteligência" : "Plan intelligently"} · mapass.app</div>
        </div>
      </div>
    </div>
  );
}
