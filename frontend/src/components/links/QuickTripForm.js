import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTrip } from "../../api/trips";
import { createLink } from "../../api/links";
import { useLanguage } from "../../i18n/LanguageContext";

export default function QuickTripForm({ urls, destination, onClose }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [name, setName] = useState(destination ? `${destination} Trip` : "");
  const [numDays, setNumDays] = useState(5);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);

    try {
      const trip = await createTrip({ name: name.trim(), num_days: numDays, destination: destination || "" });

      // Add all URLs as links
      for (const url of urls) {
        try {
          await createLink(trip.id, url);
        } catch (err) {
          console.error("Failed to add link:", err);
        }
      }

      navigate(`/trips/${trip.id}`);
    } catch (err) {
      console.error("Failed to create trip:", err);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Trip Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          {t("quickTrip.name")}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("quickTrip.namePlaceholder")}
          className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-coral-500 focus:border-transparent"
          required
          autoFocus
        />
      </div>

      {/* Days Slider */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          {t("tripForm.numDays")}
        </label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={14}
            value={numDays}
            onChange={(e) => setNumDays(Number(e.target.value))}
            className="flex-1 accent-coral-500"
          />
          <span className="text-2xl font-bold text-coral-500 w-10 text-center">{numDays}</span>
        </div>
        <p className="text-xs text-gray-400 mt-1">{t("tripForm.numDaysHint")}</p>
      </div>

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          {t("itemForm.cancel")}
        </button>
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="flex-1 bg-coral-500 hover:bg-coral-600 disabled:opacity-50 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors"
        >
          {loading ? t("quickTrip.creating") : t("quickTrip.create")}
        </button>
      </div>
    </form>
  );
}
