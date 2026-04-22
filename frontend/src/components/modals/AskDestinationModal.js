import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * Fallback modal that fires when the build pipeline detected no
 * `cities_detected` from the user's videos AND the trip has no
 * `destination` set. Without a destination the build can't pick
 * landmarks or validate places on Google Maps, so the build is
 * paused server-side (status="needs_destination") and the UI lands
 * here instead of the progress modal.
 *
 * On submit:
 *   1. PATCH the trip with the new destination + clear the flag
 *   2. Call onRetry() — TripDetail wires this to retryBuild()
 *
 * Props:
 *   onSubmit(destination)  — async; persists destination + retries build
 *   onCancel               — optional escape hatch
 */
export default function AskDestinationModal({ onSubmit, onCancel }) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";

  const [destination, setDestination] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = destination.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 space-y-5 border-2 border-amber-200">
        <div className="text-center">
          <div className="text-4xl mb-2">🌍</div>
          <h3 className="text-xl font-bold text-gray-900">
            {pt ? "Onde é a viagem?" : "Where is this trip?"}
          </h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            {pt
              ? "Os vídeos não deixaram claro o destino. Digita a cidade pra gente continuar montando o roteiro."
              : "The videos didn't make the destination clear. Type the city so we can finish building the trip."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            autoFocus
            required
            placeholder={pt ? "Ex: Buenos Aires, Argentina" : "e.g. Buenos Aires, Argentina"}
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || !destination.trim()}
              className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold shadow-md transition"
            >
              {submitting
                ? (pt ? "Continuando..." : "Continuing...")
                : (pt ? "Continuar" : "Continue")}
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                className="px-4 py-2.5 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold transition"
              >
                {pt ? "Voltar" : "Back"}
              </button>
            )}
          </div>
        </form>

        <p className="text-[11px] text-gray-400 text-center leading-relaxed">
          {pt
            ? "A IA usa isso pra encontrar os marcos icônicos, validar lugares no Google Maps e respeitar a geografia."
            : "The AI uses this to pick iconic landmarks, validate places on Google Maps, and respect geography."}
        </p>
      </div>
    </div>
  );
}
