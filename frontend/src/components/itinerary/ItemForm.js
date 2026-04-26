import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { buildItineraryItemPayload } from "../../utils/itineraryItemPayload";

export default function ItemForm({ onSubmit, onCancel, initial }) {
  const { t } = useLanguage();

  const CATEGORIES = [
    { value: "attraction", label: t("itemForm.categories.attraction") },
    { value: "restaurant", label: t("itemForm.categories.restaurant") },
    { value: "hotel", label: t("itemForm.categories.hotel") },
    { value: "activity", label: t("itemForm.categories.activity") },
    { value: "shopping", label: t("itemForm.categories.shopping") },
    { value: "transport", label: t("itemForm.categories.transport") },
    { value: "other", label: t("itemForm.categories.other") },
  ];

  const [form, setForm] = useState({
    name: initial?.name || "",
    description: initial?.description || "",
    category: initial?.category || "attraction",
    time_slot: initial?.time_slot || "",
    duration_minutes: initial?.duration_minutes || "",
    address: initial?.address || "",
    latitude: initial?.latitude || "",
    longitude: initial?.longitude || "",
    pricing_info: initial?.pricing_info || "",
    notes: initial?.notes || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Parse numeric fields from their string form-state values, then
      // run through the canonical builder so category is validated,
      // origin is set, and any unknown keys are stripped before Rails sees them.
      const parsed = {
        ...form,
        duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
      };
      // Preserve manual-entry fields that buildItineraryItemPayload doesn't
      // pull from the place dict (description, time_slot, duration_minutes,
      // notes, pricing_info) — they are already in RAILS_PERMITTED_FIELDS
      // so the builder passes them through when supplied as overrides.
      const payload = buildItineraryItemPayload(parsed, {
        origin: "user_added",
        description: parsed.description || null,
        time_slot: parsed.time_slot || null,
        duration_minutes: parsed.duration_minutes,
        notes: parsed.notes || null,
        pricing_info: parsed.pricing_info || null,
      });
      await onSubmit(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-900/50 text-red-300 text-sm p-3 rounded-lg">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t("itemForm.name")}</label>
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          required
          placeholder={t("itemForm.namePlaceholder")}
          className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t("itemForm.category")}</label>
        <select
          name="category"
          value={form.category}
          onChange={handleChange}
          className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-coral-500"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t("itemForm.description")}</label>
        <textarea
          name="description"
          value={form.description}
          onChange={handleChange}
          rows={2}
          placeholder={t("itemForm.descriptionPlaceholder")}
          className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("itemForm.timeSlot")}</label>
          <input
            type="time"
            name="time_slot"
            value={form.time_slot}
            onChange={handleChange}
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-coral-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("itemForm.duration")}</label>
          <input
            type="number"
            name="duration_minutes"
            value={form.duration_minutes}
            onChange={handleChange}
            placeholder="90"
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t("itemForm.address")}</label>
        <input
          name="address"
          value={form.address}
          onChange={handleChange}
          placeholder={t("itemForm.addressPlaceholder")}
          className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("itemForm.latitude")}</label>
          <input
            name="latitude"
            value={form.latitude}
            onChange={handleChange}
            placeholder="35.7148"
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("itemForm.longitude")}</label>
          <input
            name="longitude"
            value={form.longitude}
            onChange={handleChange}
            placeholder="139.7967"
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t("itemForm.pricing")}</label>
        <input
          name="pricing_info"
          value={form.pricing_info}
          onChange={handleChange}
          placeholder={t("itemForm.pricingPlaceholder")}
          className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t("itemForm.notes")}</label>
        <textarea
          name="notes"
          value={form.notes}
          onChange={handleChange}
          rows={2}
          placeholder={t("itemForm.notesPlaceholder")}
          className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500 resize-none"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          {t("itemForm.cancel")}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 bg-coral-500 hover:bg-coral-600 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          {submitting ? t("itemForm.saving") : t("itemForm.save")}
        </button>
      </div>
    </form>
  );
}
