import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { createTransport, updateTransport, deleteTransport } from "../../api/logistics";

const empty = {
  transport_type: "car_rental", company: "", confirmation_number: "", total_cost: "",
  departure_date: "", arrival_date: "", pickup_location: "", dropoff_location: "",
  vehicle_info: "", notes: "", booked: false,
};

const TYPES = ["car_rental", "train", "bus", "ferry", "taxi", "rideshare", "other"];
const TYPE_ICONS = {
  car_rental: "\uD83D\uDE97", train: "\uD83D\uDE86", bus: "\uD83D\uDE8C", ferry: "\u26F4\uFE0F", taxi: "\uD83D\uDE95", rideshare: "\uD83D\uDE99", other: "\uD83D\uDE90",
};

function TransportForm({ initial, onSave, onCancel, t }) {
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("logistics.transport.type")}</label>
          <select value={form.transport_type} onChange={(e) => set("transport_type", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900">
            {TYPES.map((tp) => (
              <option key={tp} value={tp}>{t(`logistics.transport.types.${tp}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("logistics.transport.company")}</label>
          <input value={form.company} onChange={(e) => set("company", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("logistics.transport.pickup")}</label>
          <input value={form.pickup_location} onChange={(e) => set("pickup_location", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("logistics.transport.dropoff")}</label>
          <input value={form.dropoff_location} onChange={(e) => set("dropoff_location", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("logistics.transport.departureDate")}</label>
          <input type="datetime-local" value={form.departure_date} onChange={(e) => set("departure_date", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("logistics.transport.arrivalDate")}</label>
          <input type="datetime-local" value={form.arrival_date} onChange={(e) => set("arrival_date", e.target.value)}
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
      <div>
        <label className="text-xs text-gray-500">{t("logistics.transport.vehicleInfo")}</label>
        <input value={form.vehicle_info} onChange={(e) => set("vehicle_info", e.target.value)}
          className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" placeholder={t("logistics.transport.vehiclePlaceholder")} />
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

function TransportCard({ transport, onEdit, onDelete, t }) {
  const icon = TYPE_ICONS[transport.transport_type] || "\uD83D\uDE90";
  const dep = transport.departure_date ? new Date(transport.departure_date) : null;
  const fmt = (d) => d?.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) || "--";

  return (
    <div className="bg-white shadow-sm rounded-xl p-4 border border-gray-200 hover:border-gray-400 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="text-2xl">{icon}</div>
          <div>
            <div className="font-semibold text-sm text-gray-900">
              {t(`logistics.transport.types.${transport.transport_type}`)}
              {transport.company && ` \u2014 ${transport.company}`}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {transport.pickup_location || "?"} \u2192 {transport.dropoff_location || "?"}
            </div>
          </div>
        </div>
        {transport.booked && (
          <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
            {t("logistics.common.booked")}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-gray-700">
        <div><span className="text-gray-400">{t("logistics.transport.departureDate")}:</span> {fmt(dep)}</div>
        {transport.confirmation_number && (
          <div><span className="text-gray-400">{t("logistics.common.confirmation")}:</span> {transport.confirmation_number}</div>
        )}
        {transport.total_cost && (
          <div><span className="text-gray-400">{t("logistics.common.totalCost")}:</span> ${transport.total_cost}</div>
        )}
        {transport.vehicle_info && (
          <div><span className="text-gray-400">{t("logistics.transport.vehicleInfo")}:</span> {transport.vehicle_info}</div>
        )}
      </div>
      {transport.notes && <p className="text-xs text-gray-500 mt-2">{transport.notes}</p>}
      <div className="flex gap-2 mt-3 pt-2 border-t border-gray-200">
        <button onClick={() => onEdit(transport)} className="text-xs text-coral-600 hover:text-coral-500">
          {t("logistics.common.edit")}
        </button>
        <button onClick={() => onDelete(transport.id)} className="text-xs text-red-500 hover:text-red-400">
          {t("logistics.common.delete")}
        </button>
      </div>
    </div>
  );
}

export default function TransportPanel({ tripId, transports: initialTransports }) {
  const { t } = useLanguage();
  const [transports, setTransports] = useState(initialTransports || []);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleCreate = async (data) => {
    const res = await createTransport(tripId, data);
    setTransports((prev) => [...prev, res].sort((a, b) => (a.departure_date || "").localeCompare(b.departure_date || "")));
    setShowForm(false);
  };

  const handleUpdate = async (data) => {
    const res = await updateTransport(tripId, editing.id, data);
    setTransports((prev) => prev.map((t) => (t.id === res.id ? res : t)));
    setEditing(null);
  };

  const handleDelete = async (id) => {
    await deleteTransport(tripId, id);
    setTransports((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">{t("logistics.transport.title")}</h2>
        <button onClick={() => { setShowForm(true); setEditing(null); }}
          className="px-3 py-1.5 text-sm bg-coral-500 hover:bg-coral-400 rounded-lg font-medium text-white">
          + {t("logistics.common.add")}
        </button>
      </div>

      {showForm && !editing && (
        <TransportForm onSave={handleCreate} onCancel={() => setShowForm(false)} t={t} />
      )}

      {transports.length === 0 && !showForm && (
        <p className="text-gray-400 text-sm text-center py-8">{t("logistics.transport.empty")}</p>
      )}

      {transports.map((tr) =>
        editing?.id === tr.id ? (
          <TransportForm key={tr.id} initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} t={t} />
        ) : (
          <TransportCard key={tr.id} transport={tr} onEdit={setEditing} onDelete={handleDelete} t={t} />
        )
      )}
    </div>
  );
}
