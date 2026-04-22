import { useState, useMemo } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * Editable inline profile card. Phase 3 of the deferred-extraction redesign
 * removed the blocking "confirm or reject this profile" modal — instead the
 * profile is auto-confirmed by the backend and shown here as a normal
 * collapsible section the user can edit at any time.
 *
 * Props:
 *   profile  — trip.traveler_profile JSON blob
 *   numDays  — trip duration (used for the multi-city distribution slider)
 *   onSave   — async (updatedProfile) => void; PATCHes the trip
 */

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

export default function TravelerProfileCard({ profile, numDays, onSave }) {
  const { t, lang } = useLanguage();
  const isEn = lang === "en";
  const pt = lang === "pt-BR";

  const localizedField = (obj, field) => {
    if (isEn) return obj?.[`${field}_en`] || obj?.[field] || "";
    return obj?.[field] || "";
  };
  const localizedList = (obj, field) => {
    if (isEn) return obj?.[`${field}_en`] || obj?.[field] || [];
    return obj?.[field] || [];
  };

  const [collapsed, setCollapsed] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedProfile, setEditedProfile] = useState({ ...profile });
  const [categoryPrefs, setCategoryPrefs] = useState(() => {
    const saved = profile?.category_preferences || {};
    const prefs = {};
    CATEGORY_PREFS.forEach((c) => {
      prefs[c.key] = saved[c.key] !== undefined ? saved[c.key] : c.default;
    });
    return prefs;
  });

  const cities = profile?.cities_detected || [];

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

  const [dayDistribution, setDayDistribution] = useState(
    profile?.day_distribution || defaultDistribution
  );
  const totalAssigned = Object.values(dayDistribution).reduce((a, b) => a + b, 0);
  const isValidDistribution = cities.length < 2 || totalAssigned === numDays;

  // No profile yet → don't render. Happens briefly during the early
  // extracting/analyzing phases of the build.
  if (!profile || (!editedProfile.travel_style && !editedProfile.interests?.length)) {
    return null;
  }

  const handleDayChange = (city, value) => {
    const num = Math.max(0, Math.min(numDays, parseInt(value) || 0));
    setDayDistribution((prev) => ({ ...prev, [city]: num }));
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      const finalProfile = { ...editedProfile, category_preferences: categoryPrefs };
      if (cities.length >= 2) {
        finalProfile.day_distribution = dayDistribution;
      }
      await onSave(finalProfile);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const interestPills = localizedList(editedProfile, "interests");
  const style = localizedField(editedProfile, "travel_style");
  const description = localizedField(editedProfile, "profile_description");

  // ── Read-only collapsed summary (default state) ──────────────────
  if (!editing) {
    return (
      <div className="mb-4 rounded-2xl bg-white border border-gray-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
        >
          <span className="text-xl">✨</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">
              {style || (pt ? "Seu perfil de viagem" : "Your traveler profile")}
            </div>
            {!collapsed ? null : (
              <div className="text-xs text-gray-500 truncate">
                {interestPills.slice(0, 3).join(" · ") || (pt ? "toque pra ver detalhes" : "tap to see details")}
              </div>
            )}
          </div>
          <span className="text-gray-400 text-xs">{collapsed ? "▾" : "▴"}</span>
        </button>

        {!collapsed && (
          <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
            {description && (
              <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
            )}
            {interestPills.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {interestPills.map((interest) => (
                  <span
                    key={interest}
                    className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
                  >
                    {interest}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>
                {pt ? "Ritmo:" : "Pace:"}{" "}
                <strong className="text-coral-600">{editedProfile.pace || "moderate"}</strong>
              </span>
              {cities.length > 0 && (
                <span>
                  {pt ? "Cidades:" : "Cities:"}{" "}
                  <strong className="text-gray-700">{cities.join(", ")}</strong>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-semibold text-coral-600 hover:text-coral-700"
            >
              {pt ? "Editar perfil →" : "Edit profile →"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Edit mode ────────────────────────────────────────────────────
  return (
    <div className="mb-4 rounded-2xl bg-white border-2 border-coral-300 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">✏️</span>
          <span className="text-sm font-semibold text-gray-900">
            {pt ? "Editando perfil" : "Editing profile"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setEditedProfile({ ...profile });
          }}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          {pt ? "Cancelar" : "Cancel"}
        </button>
      </div>

      <div className="px-4 py-4 space-y-5">
        {/* Categories */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {pt ? "Categorias" : "Categories"}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORY_PREFS.map((cat) => {
              const active = categoryPrefs[cat.key];
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() =>
                    setCategoryPrefs((prev) => ({ ...prev, [cat.key]: !prev[cat.key] }))
                  }
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition text-left text-xs ${
                    active
                      ? "border-coral-400 bg-coral-50 text-gray-900"
                      : "border-gray-200 bg-white text-gray-400 hover:border-gray-300"
                  }`}
                >
                  <span className="text-base">{cat.icon}</span>
                  <span className="font-medium truncate">{t(`profile.cat_${cat.key}`)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Pace */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {pt ? "Ritmo" : "Pace"}
          </h3>
          <div className="flex gap-2">
            {["relaxed", "moderate", "intense"].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setEditedProfile((prev) => ({ ...prev, pace: p }))}
                className={`flex-1 py-2 rounded-lg border-2 text-xs font-medium transition ${
                  editedProfile.pace === p
                    ? "border-coral-400 bg-coral-50 text-gray-900"
                    : "border-gray-200 text-gray-400 hover:border-gray-300"
                }`}
              >
                {p === "relaxed" && "🧘 "}
                {p === "moderate" && "🚶 "}
                {p === "intense" && "🏃 "}
                {t(`profile.${p}`)}
              </button>
            ))}
          </div>
        </div>

        {/* City distribution (only when ≥2 cities) */}
        {cities.length >= 2 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {pt ? `Dias por cidade (${numDays} no total)` : `Days per city (${numDays} total)`}
            </h3>
            <div className="space-y-2">
              {cities.map((city) => (
                <div key={city} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-32 truncate" title={city}>
                    📍 {city}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={numDays}
                    value={dayDistribution[city] || 0}
                    onChange={(e) => handleDayChange(city, e.target.value)}
                    className="flex-1 accent-coral-500"
                  />
                  <span className="text-xs font-mono text-coral-600 w-8 text-right">
                    {dayDistribution[city] || 0}
                  </span>
                </div>
              ))}
            </div>
            <p className={`text-xs text-right mt-1 ${isValidDistribution ? "text-emerald-600" : "text-red-500"}`}>
              {totalAssigned}/{numDays} {isValidDistribution ? "✓" : ""}
            </p>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setEditedProfile({ ...profile });
          }}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
        >
          {pt ? "Descartar" : "Discard"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isValidDistribution}
          className="px-5 py-2 bg-coral-500 hover:bg-coral-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
        >
          {saving ? (pt ? "Salvando..." : "Saving...") : (pt ? "Salvar" : "Save")}
        </button>
      </div>
    </div>
  );
}
