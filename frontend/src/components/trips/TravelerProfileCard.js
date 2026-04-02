import { useState, useMemo } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

const CATEGORY_PREFS = [
  { key: "restaurants", icon: "🍽️", default: true },
  { key: "attractions", icon: "🏛️", default: true },
  { key: "museums", icon: "🎨", default: true },
  { key: "shopping", icon: "🛍️", default: false },
  { key: "nightlife", icon: "🌙", default: false },
  { key: "cafes", icon: "☕", default: true },
  { key: "nature", icon: "🌿", default: true },
  { key: "viewpoints", icon: "📸", default: true },
];

export default function TravelerProfileCard({ profile, numDays, onConfirm, onReject }) {
  const { t, lang } = useLanguage();
  const isEn = lang === "en";

  const localizedField = (obj, field) => {
    if (isEn) return obj?.[`${field}_en`] || obj?.[field] || "";
    return obj?.[field] || "";
  };
  const localizedList = (obj, field) => {
    if (isEn) return obj?.[`${field}_en`] || obj?.[field] || [];
    return obj?.[field] || [];
  };

  const [step, setStep] = useState(0); // 0: profile overview, 1: category prefs, 2: pace + city
  const [editedProfile, setEditedProfile] = useState({ ...profile });
  const [categoryPrefs, setCategoryPrefs] = useState(() => {
    const saved = profile.category_preferences || {};
    const prefs = {};
    CATEGORY_PREFS.forEach((c) => {
      prefs[c.key] = saved[c.key] !== undefined ? saved[c.key] : c.default;
    });
    return prefs;
  });

  const cities = profile.cities_detected || [];

  const defaultDistribution = useMemo(() => {
    if (cities.length < 2) return {};
    const dist = {};
    const perCity = Math.floor(numDays / cities.length);
    let remaining = numDays - perCity * cities.length;
    cities.forEach((city) => {
      dist[city] = perCity + (remaining > 0 ? 1 : 0);
      if (remaining > 0) remaining--;
    });
    return dist;
  }, [cities, numDays]);

  const [dayDistribution, setDayDistribution] = useState(defaultDistribution);
  const totalAssigned = Object.values(dayDistribution).reduce((a, b) => a + b, 0);
  const isValidDistribution = cities.length < 2 || totalAssigned === numDays;

  const handleDayChange = (city, value) => {
    const num = Math.max(0, Math.min(numDays, parseInt(value) || 0));
    setDayDistribution((prev) => ({ ...prev, [city]: num }));
  };

  const handleConfirm = () => {
    const finalProfile = { ...editedProfile, category_preferences: categoryPrefs };
    if (cities.length >= 2) {
      finalProfile.day_distribution = dayDistribution;
    }
    onConfirm(finalProfile);
  };

  const totalSteps = cities.length >= 2 ? 3 : 2;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        {/* Progress */}
        <div className="flex justify-center gap-2 pt-5 px-6">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-8 bg-coral-500" : i < step ? "w-4 bg-coral-300" : "w-4 bg-gray-200"
              }`}
            />
          ))}
        </div>

        {/* Step 0: Profile overview */}
        {step === 0 && (
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="text-center mb-5">
              <span className="text-3xl mb-2 block">✨</span>
              <h2 className="text-lg font-bold text-gray-900">{t("profile.title")}</h2>
              <p className="text-xs text-gray-400 mt-1">{t("profile.modalSubtitle")}</p>
            </div>

            {/* Description */}
            {localizedField(editedProfile, "profile_description") ? (
              <p className="text-gray-600 text-sm leading-relaxed text-center mb-5">
                {localizedField(editedProfile, "profile_description")}
              </p>
            ) : (
              <p className="text-gray-400 text-sm italic text-center mb-5">
                {t("profile.emptyFallback")}
              </p>
            )}

            {/* Style */}
            {localizedField(editedProfile, "travel_style") && (
              <div className="text-center mb-4">
                <span className="text-xs text-gray-400">{t("profile.style")}</span>
                <p className="text-sm font-medium text-coral-600">{localizedField(editedProfile, "travel_style")}</p>
              </div>
            )}

            {/* Interests */}
            {localizedList(editedProfile, "interests").length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {localizedList(editedProfile, "interests").map((interest) => (
                  <span
                    key={interest}
                    className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200"
                  >
                    {interest}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 1: Category preferences */}
        {step === 1 && (
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="text-center mb-5">
              <span className="text-3xl mb-2 block">🎯</span>
              <h2 className="text-lg font-bold text-gray-900">{t("profile.whatYouWant")}</h2>
              <p className="text-xs text-gray-400 mt-1">{t("profile.whatYouWantDesc")}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {CATEGORY_PREFS.map((cat) => {
                const active = categoryPrefs[cat.key];
                return (
                  <button
                    key={cat.key}
                    onClick={() =>
                      setCategoryPrefs((prev) => ({ ...prev, [cat.key]: !prev[cat.key] }))
                    }
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                      active
                        ? "border-coral-400 bg-coral-50"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <span className="text-xl">{cat.icon}</span>
                    <span className={`text-sm font-medium ${active ? "text-gray-900" : "text-gray-400"}`}>
                      {t(`profile.cat_${cat.key}`)}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Pace selection */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3 text-center">{t("profile.selectPace")}</h3>
              <div className="flex gap-2">
                {["relaxed", "moderate", "intense"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setEditedProfile((prev) => ({ ...prev, pace: p }))}
                    className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                      editedProfile.pace === p
                        ? "border-coral-400 bg-coral-50 text-gray-900"
                        : "border-gray-200 text-gray-400 hover:border-gray-300"
                    }`}
                  >
                    {p === "relaxed" && "🧘"} {p === "moderate" && "🚶"} {p === "intense" && "🏃"}
                    <br />
                    <span className="text-xs">{t(`profile.${p}`)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: City distribution (only for multi-city) */}
        {step === 2 && cities.length >= 2 && (
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="text-center mb-5">
              <span className="text-3xl mb-2 block">🗺️</span>
              <h2 className="text-lg font-bold text-gray-900">{t("profile.howSplit", { days: numDays })}</h2>
            </div>

            <div className="space-y-3">
              {cities.map((city) => (
                <div key={city} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-36 truncate" title={city}>
                    📍 {city}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={numDays}
                    value={dayDistribution[city] || 0}
                    onChange={(e) => handleDayChange(city, e.target.value)}
                    className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-coral-500"
                  />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDayChange(city, (dayDistribution[city] || 0) - 1)}
                      className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs flex items-center justify-center"
                    >
                      -
                    </button>
                    <span className="text-sm font-mono text-coral-600 w-6 text-center">
                      {dayDistribution[city] || 0}
                    </span>
                    <button
                      onClick={() => handleDayChange(city, (dayDistribution[city] || 0) + 1)}
                      className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 text-center">
              <span className={`text-xs ${isValidDistribution ? "text-emerald-600" : "text-red-500"}`}>
                {totalAssigned}/{numDays} {t("profile.daysLabel")} {isValidDistribution && "✓"}
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-6 pb-5 pt-3 flex items-center gap-3 border-t border-gray-100">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="px-4 py-2 text-gray-400 hover:text-gray-600 text-sm font-medium transition-colors"
            >
              {t("onboarding.back")}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onReject}
            className="px-3 py-2 text-gray-400 hover:text-gray-600 text-sm transition-colors"
          >
            {t("profile.skip")}
          </button>
          {step < totalSteps - 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="px-6 py-2.5 bg-coral-500 hover:bg-coral-400 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {t("onboarding.next")}
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={!isValidDistribution}
              className={`px-6 py-2.5 text-white text-sm font-semibold rounded-lg transition-colors ${
                isValidDistribution
                  ? "bg-coral-500 hover:bg-coral-400"
                  : "bg-gray-300 cursor-not-allowed"
              }`}
            >
              {t("profile.confirm")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
