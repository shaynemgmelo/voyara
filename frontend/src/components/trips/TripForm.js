import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

export default function TripForm({ onSubmit, initial }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    name: initial?.name || "",
    destination: initial?.destination || "",
    num_days: initial?.num_days || 5,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const value = e.target.type === "number" ? parseInt(e.target.value) || 1 : e.target.value;
    setForm((prev) => ({ ...prev, [e.target.name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("tripForm.name")}
        </label>
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          required
          placeholder={t("tripForm.namePlaceholder")}
          className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("tripForm.destination")}
        </label>
        <input
          name="destination"
          value={form.destination}
          onChange={handleChange}
          placeholder={t("tripForm.destinationPlaceholder")}
          className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("tripForm.numDays")}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            name="num_days"
            min="1"
            max="14"
            value={form.num_days}
            onChange={handleChange}
            className="flex-1 accent-coral-500"
          />
          <span className="text-gray-900 font-bold text-lg w-8 text-center">
            {form.num_days}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          {t("tripForm.numDaysHint")}
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-coral-500 hover:bg-coral-600 disabled:bg-coral-700 disabled:opacity-50 text-white font-medium py-3 rounded-lg transition-colors"
      >
        {submitting ? t("tripForm.submitting") : t("tripForm.submit")}
      </button>
    </form>
  );
}
