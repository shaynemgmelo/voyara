import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { createLodging, updateLodging, deleteLodging } from "../../api/logistics";

const empty = {
  name: "", address: "", check_in_date: "", check_in_time: "", check_out_date: "",
  check_out_time: "", confirmation_number: "", total_cost: "", phone: "", website: "",
  email: "", notes: "", booked: false,
};

function LodgingForm({ initial, onSave, onCancel, t }) {
  const [form, setForm] = useState(initial || empty);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white shadow-sm rounded-xl p-5 space-y-4">
      <div>
        <label className="text-xs text-gray-500">{t("logistics.lodging.name")}</label>
        <input value={form.name} onChange={(e) => set("name", e.target.value)}
          className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" placeholder={t("logistics.lodging.namePlaceholder")} />
      </div>
      <div>
        <label className="text-xs text-gray-500">{t("logistics.lodging.address")}</label>
        <input value={form.address} onChange={(e) => set("address", e.target.value)}
          className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("logistics.lodging.checkIn")}</label>
          <input type="date" value={form.check_in_date} onChange={(e) => set("check_in_date", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("logistics.lodging.checkInTime")}</label>
          <input type="time" value={form.check_in_time} onChange={(e) => set("check_in_time", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("logistics.lodging.checkOut")}</label>
          <input type="date" value={form.check_out_date} onChange={(e) => set("check_out_date", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("logistics.lodging.checkOutTime")}</label>
          <input type="time" value={form.check_out_time} onChange={(e) => set("check_out_time", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("logistics.common.confirmation")}</label>
          <input value={form.confirmation_number} onChange={(e) => set("confirmation_number", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("logistics.common.totalCost")}</label>
          <input type="number" step="0.01" value={form.total_cost} onChange={(e) => set("total_cost", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" placeholder="0.00" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("logistics.lodging.phone")}</label>
          <input value={form.phone} onChange={(e) => set("phone", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("logistics.lodging.website")}</label>
          <input value={form.website} onChange={(e) => set("website", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("logistics.lodging.email")}</label>
          <input value={form.email} onChange={(e) => set("email", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500">{t("logistics.common.notes")}</label>
        <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2}
          className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-900">
        <input type="checkbox" checked={form.booked} onChange={(e) => set("booked", e.target.checked)}
          className="rounded bg-gray-50" />
        {t("logistics.common.booked")}
      </label>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900">
          {t("logistics.common.cancel")}
        </button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm bg-coral-500 hover:bg-coral-400 rounded-lg font-medium text-white disabled:opacity-50">
          {saving ? t("logistics.common.saving") : t("logistics.common.save")}
        </button>
      </div>
    </form>
  );
}

function LodgingCard({ lodging, onEdit, onDelete, t }) {
  const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "--";
  const nights = lodging.check_in_date && lodging.check_out_date
    ? Math.ceil((new Date(lodging.check_out_date) - new Date(lodging.check_in_date)) / 86400000)
    : null;

  return (
    <div className="bg-white shadow-sm rounded-xl p-4 border border-gray-200 hover:border-gray-400 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="text-2xl">&#127976;</div>
          <div>
            <div className="font-semibold text-sm text-gray-900">{lodging.name || t("logistics.lodging.unnamed")}</div>
            {lodging.address && <div className="text-xs text-gray-500 mt-0.5">{lodging.address}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {nights && <span className="text-xs text-gray-500">{nights} {t("logistics.lodging.nights")}</span>}
          {lodging.booked && (
            <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
              {t("logistics.common.booked")}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-gray-700">
        <div>
          <span className="text-gray-400">{t("logistics.lodging.checkIn")}:</span> {fmtDate(lodging.check_in_date)} {lodging.check_in_time || ""}
        </div>
        <div>
          <span className="text-gray-400">{t("logistics.lodging.checkOut")}:</span> {fmtDate(lodging.check_out_date)} {lodging.check_out_time || ""}
        </div>
        {lodging.confirmation_number && (
          <div><span className="text-gray-400">{t("logistics.common.confirmation")}:</span> {lodging.confirmation_number}</div>
        )}
        {lodging.total_cost && (
          <div><span className="text-gray-400">{t("logistics.common.totalCost")}:</span> ${lodging.total_cost}</div>
        )}
      </div>
      {lodging.notes && <p className="text-xs text-gray-500 mt-2">{lodging.notes}</p>}
      <div className="flex gap-2 mt-3 pt-2 border-t border-gray-200">
        <button onClick={() => onEdit(lodging)} className="text-xs text-coral-600 hover:text-coral-500">
          {t("logistics.common.edit")}
        </button>
        <button onClick={() => onDelete(lodging.id)} className="text-xs text-red-500 hover:text-red-400">
          {t("logistics.common.delete")}
        </button>
      </div>
    </div>
  );
}

export default function LodgingPanel({ tripId, lodgings: initialLodgings }) {
  const { t } = useLanguage();
  const [lodgings, setLodgings] = useState(initialLodgings || []);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleCreate = async (data) => {
    const res = await createLodging(tripId, data);
    setLodgings((prev) => [...prev, res].sort((a, b) => (a.check_in_date || "").localeCompare(b.check_in_date || "")));
    setShowForm(false);
  };

  const handleUpdate = async (data) => {
    const res = await updateLodging(tripId, editing.id, data);
    setLodgings((prev) => prev.map((l) => (l.id === res.id ? res : l)));
    setEditing(null);
  };

  const handleDelete = async (id) => {
    await deleteLodging(tripId, id);
    setLodgings((prev) => prev.filter((l) => l.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">{t("logistics.lodging.title")}</h2>
        <button onClick={() => { setShowForm(true); setEditing(null); }}
          className="px-3 py-1.5 text-sm bg-coral-500 hover:bg-coral-400 rounded-lg font-medium text-white">
          + {t("logistics.common.add")}
        </button>
      </div>

      {showForm && !editing && (
        <LodgingForm onSave={handleCreate} onCancel={() => setShowForm(false)} t={t} />
      )}

      {lodgings.length === 0 && !showForm && (
        <p className="text-gray-400 text-sm text-center py-8">{t("logistics.lodging.empty")}</p>
      )}

      {lodgings.map((l) =>
        editing?.id === l.id ? (
          <LodgingForm key={l.id} initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} t={t} />
        ) : (
          <LodgingCard key={l.id} lodging={l} onEdit={setEditing} onDelete={handleDelete} t={t} />
        )
      )}
    </div>
  );
}
