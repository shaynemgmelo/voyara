import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useLanguage } from "../../i18n/LanguageContext";
import PlaceInfoCard from "./PlaceInfoCard";
import QuickTripForm from "./QuickTripForm";
import OnboardingModal from "../trips/OnboardingModal";

export default function AnalyzeResultModal({ data, onClose }) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState("choice"); // "choice" | "places" | "itinerary"
  const [showOnboarding, setShowOnboarding] = useState(false);
  const pt = lang === "pt-BR";

  if (!data) return null;

  const { places = [], destination, summary, urls = [] } = data;

  // Show onboarding once per user (stored in localStorage)
  const shouldShowOnboarding = () => {
    const seen = localStorage.getItem("mapass_onboarding_seen");
    return !seen;
  };

  const markOnboardingSeen = () => {
    localStorage.setItem("mapass_onboarding_seen", "true");
    setShowOnboarding(false);
  };

  const handleViewPlaces = () => {
    if (shouldShowOnboarding()) {
      setShowOnboarding(true);
    }
    setView("places");
  };

  const handleCreateItinerary = () => {
    if (!user) {
      // Save URLs in sessionStorage and redirect to login
      sessionStorage.setItem("mapass_pending_urls", JSON.stringify(urls));
      sessionStorage.setItem("mapass_pending_destination", destination || "");
      if (shouldShowOnboarding()) {
        localStorage.setItem("mapass_onboarding_seen", "true");
      }
      navigate("/login");
      return;
    }
    if (shouldShowOnboarding()) {
      setShowOnboarding(true);
    }
    setView("itinerary");
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {places.length > 0
                  ? pt
                    ? `Encontramos ${places.length} lugar${places.length > 1 ? "es" : ""}`
                    : `We found ${places.length} place${places.length > 1 ? "s" : ""}`
                  : pt ? "Analise concluida" : "Analysis complete"
                }
                {destination && (
                  <span className="text-gray-400 font-normal text-base"> {pt ? "em" : "in"} {destination}</span>
                )}
              </h2>
              {summary && <p className="text-sm text-gray-500 mt-0.5">{summary}</p>}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Choice view — two option cards */}
          {view === "choice" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Option 1: Learn more */}
              <button
                onClick={handleViewPlaces}
                className="text-left p-5 rounded-xl border-2 border-gray-200 hover:border-coral-300 hover:bg-coral-50/50 transition-all group"
              >
                <div className="text-3xl mb-3">📍</div>
                <h3 className="font-semibold text-gray-900 mb-1">
                  {t("analyzeResult.learnMore")}
                </h3>
                <p className="text-sm text-gray-500">
                  {t("analyzeResult.learnMoreDesc")}
                </p>
              </button>

              {/* Option 2: Create itinerary */}
              <button
                onClick={handleCreateItinerary}
                className="text-left p-5 rounded-xl border-2 border-gray-200 hover:border-coral-300 hover:bg-coral-50/50 transition-all group"
              >
                <div className="text-3xl mb-3">🗺️</div>
                <h3 className="font-semibold text-gray-900 mb-1">
                  {t("analyzeResult.createItinerary")}
                </h3>
                <p className="text-sm text-gray-500">
                  {t("analyzeResult.createItineraryDesc")}
                </p>
              </button>
            </div>
          )}

          {/* Places view — show place cards */}
          {view === "places" && (
            <div>
              <button
                onClick={() => setView("choice")}
                className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1"
              >
                ← {pt ? "Voltar" : "Back"}
              </button>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {places.map((place, idx) => (
                  <PlaceInfoCard key={idx} place={place} />
                ))}
              </div>
              {places.length > 0 && (
                <div className="mt-6 text-center">
                  <button
                    onClick={handleCreateItinerary}
                    className="bg-coral-500 hover:bg-coral-600 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
                  >
                    {t("analyzeResult.createItinerary")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Itinerary creation view — quick form */}
          {view === "itinerary" && (
            <div>
              <button
                onClick={() => setView("choice")}
                className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1"
              >
                ← {pt ? "Voltar" : "Back"}
              </button>
              <QuickTripForm
                urls={urls}
                destination={destination}
                onClose={onClose}
              />
            </div>
          )}
        </div>

        {/* Onboarding modal — shown once after first choice */}
        {showOnboarding && (
          <OnboardingModal onClose={markOnboardingSeen} />
        )}
      </div>
    </div>
  );
}
