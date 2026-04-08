import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/*
 * Share trip via link or email.
 * Generates a shareable URL and allows sending invite emails.
 */

export default function TripShareModal({ trip, onClose }) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";
  const [emails, setEmails] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!trip) return null;

  const shareUrl = `${window.location.origin}/trips/${trip.id}`;

  const dayPlans = trip.day_plans || [];
  const totalPlaces = dayPlans.reduce((sum, d) => sum + (d.itinerary_items || []).length, 0);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
      const input = document.createElement("input");
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleSendEmail = async () => {
    const emailList = emails
      .split(/[,;\s]+/)
      .map(e => e.trim())
      .filter(e => e.includes("@"));

    if (emailList.length === 0) return;

    setSending(true);

    // Build mailto link with pre-filled content
    const subject = encodeURIComponent(
      pt
        ? `Confira meu roteiro: ${trip.name}`
        : `Check out my itinerary: ${trip.name}`
    );

    const bodyText = pt
      ? `Olá!\n\nQuero compartilhar com você meu roteiro de viagem para ${trip.destination || trip.name}.\n\n` +
        `📍 ${totalPlaces} lugares incríveis em ${dayPlans.length} dias\n` +
        (message ? `\n💬 "${message}"\n` : "") +
        `\nVeja o roteiro completo aqui:\n${shareUrl}\n\n` +
        `Feito com Mapass — mapass.app`
      : `Hi!\n\nI'd like to share my travel itinerary for ${trip.destination || trip.name}.\n\n` +
        `📍 ${totalPlaces} amazing places in ${dayPlans.length} days\n` +
        (message ? `\n💬 "${message}"\n` : "") +
        `\nSee the full itinerary here:\n${shareUrl}\n\n` +
        `Made with Mapass — mapass.app`;

    const body = encodeURIComponent(bodyText);
    const mailto = `mailto:${emailList.join(",")}?subject=${subject}&body=${body}`;

    window.open(mailto, "_blank");

    setSending(false);
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: trip.name,
          text: pt
            ? `Confira meu roteiro para ${trip.destination || trip.name} — ${totalPlaces} lugares em ${dayPlans.length} dias!`
            : `Check out my itinerary for ${trip.destination || trip.name} — ${totalPlaces} places in ${dayPlans.length} days!`,
          url: shareUrl,
        });
      } catch {
        // User cancelled
      }
    }
  };

  const handleWhatsApp = () => {
    const text = encodeURIComponent(
      pt
        ? `Olha o roteiro que montei para ${trip.destination || trip.name}! 🗺️✨\n${totalPlaces} lugares em ${dayPlans.length} dias.\n\n${shareUrl}`
        : `Check out the itinerary I made for ${trip.destination || trip.name}! 🗺️✨\n${totalPlaces} places in ${dayPlans.length} days.\n\n${shareUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scaleIn" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {pt ? "Compartilhar Roteiro" : "Share Itinerary"}
            </h2>
            <p className="text-sm text-gray-500">{trip.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl p-1">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* ═══ Share Link ═══ */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {pt ? "Link do roteiro" : "Itinerary link"}
            </label>
            <div className="flex gap-2">
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-600 truncate font-mono">
                {shareUrl}
              </div>
              <button
                onClick={handleCopy}
                className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all flex-shrink-0 ${
                  copied
                    ? "bg-emerald-500 text-white"
                    : "bg-gray-900 text-white hover:bg-gray-800"
                }`}
              >
                {copied ? "✓" : (pt ? "Copiar" : "Copy")}
              </button>
            </div>
          </div>

          {/* ═══ Quick Share Buttons ═══ */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {pt ? "Compartilhar via" : "Share via"}
            </label>
            <div className="flex gap-2">
              {/* WhatsApp */}
              <button
                onClick={handleWhatsApp}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                WhatsApp
              </button>

              {/* Native share (mobile) */}
              {typeof navigator !== "undefined" && navigator.share && (
                <button
                  onClick={handleNativeShare}
                  className="flex-1 flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition-colors text-sm"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                  </svg>
                  {pt ? "Mais" : "More"}
                </button>
              )}
            </div>
          </div>

          {/* ═══ Divider ═══ */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 font-medium">{pt ? "ou envie por email" : "or send by email"}</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* ═══ Email Invite ═══ */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {pt ? "Emails dos amigos" : "Friends' emails"}
            </label>
            <input
              type="text"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder={pt ? "email1@exemplo.com, email2@exemplo.com" : "email1@example.com, email2@example.com"}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500/20 focus:border-coral-500 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {pt ? "Mensagem (opcional)" : "Message (optional)"}
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={pt ? "Olha o roteiro que montei pra nossa viagem!" : "Check out the itinerary I made for our trip!"}
              rows={2}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500/20 focus:border-coral-500 transition-all resize-none"
            />
          </div>

          <button
            onClick={handleSendEmail}
            disabled={sending || !emails.trim()}
            className={`w-full font-bold py-3 rounded-xl transition-all text-sm ${
              sent
                ? "bg-emerald-500 text-white"
                : "bg-coral-500 hover:bg-coral-600 disabled:bg-gray-200 disabled:text-gray-400 text-white"
            }`}
          >
            {sent
              ? (pt ? "✓ Email aberto!" : "✓ Email opened!")
              : sending
                ? (pt ? "Abrindo..." : "Opening...")
                : (pt ? "Enviar por email" : "Send by email")}
          </button>
        </div>
      </div>
    </div>
  );
}
