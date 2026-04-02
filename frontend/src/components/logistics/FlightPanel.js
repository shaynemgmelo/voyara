import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { createFlight, updateFlight, deleteFlight } from "../../api/logistics";

const empty = {
  airline: "", flight_number: "", confirmation_number: "", total_cost: "",
  departure_date: "", arrival_date: "", departure_airport: "", arrival_airport: "",
  seats: "", notes: "", booked: false,
};

function FlightForm({ initial, onSave, onCancel, t }) {
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
          <label className="text-xs text-gray-500">{t("logistics.flights.airline")}</label>
          <input value={form.airline} onChange={(e) => set("airline", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" placeholder="e.g. LATAM" />
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("logistics.flights.flightNumber")}</label>
          <input value={form.flight_number} onChange={(e) => set("flight_number", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" placeholder="e.g. LA8040" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("logistics.flights.departureAirport")}</label>
          <input value={form.departure_airport} onChange={(e) => set("departure_airport", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" placeholder="e.g. GRU" />
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("logistics.flights.arrivalAirport")}</label>
          <input value={form.arrival_airport} onChange={(e) => set("arrival_airport", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" placeholder="e.g. NRT" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("logistics.flights.departureDate")}</label>
          <input type="datetime-local" value={form.departure_date} onChange={(e) => set("departure_date", e.target.value)}
            className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" />
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("logistics.flights.arrivalDate")}</label>
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
        <label className="text-xs text-gray-500">{t("logistics.flights.seats")}</label>
        <input value={form.seats} onChange={(e) => set("seats", e.target.value)}
          className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" placeholder="e.g. 14A, 14B" />
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

function FlightCard({ flight, onEdit, onDelete, t }) {
  const dep = flight.departure_date ? new Date(flight.departure_date) : null;
  const arr = flight.arrival_date ? new Date(flight.arrival_date) : null;
  const fmtTime = (d) => d?.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) || "--:--";
  const fmtDate = (d) => d?.toLocaleDateString(undefined, { month: "short", day: "numeric" }) || "";

  const durationMs = dep && arr ? arr - dep : null;
  const durationHrs = durationMs ? Math.floor(durationMs / 3600000) : null;
  const durationMin = durationMs ? Math.floor((durationMs % 3600000) / 60000) : null;
  const durationStr = durationHrs != null ? `${durationHrs}h ${durationMin}m` : null;

  return (
    <div className="bg-white shadow-sm rounded-xl border border-gray-200 hover:border-gray-400 transition-colors overflow-hidden">
      {/* Main flight route row */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          {/* Left: departure */}
          <div className="text-center min-w-[80px]">
            <div className="text-xl font-bold text-gray-900">{flight.departure_airport || "---"}</div>
            <div className="text-sm font-medium text-gray-700">{fmtTime(dep)}</div>
            <div className="text-xs text-gray-500">{fmtDate(dep)}</div>
          </div>

          {/* Center: duration + plane icon */}
          <div className="flex-1 flex flex-col items-center px-4">
            {durationStr && <div className="text-xs text-gray-500 mb-1">{durationStr}</div>}
            <div className="flex items-center w-full">
              <div className="flex-1 border-t border-gray-300 border-dashed"></div>
              <span className="mx-2 text-coral-600 text-lg">&#9992;</span>
              <div className="flex-1 border-t border-gray-300 border-dashed"></div>
            </div>
            {flight.airline && (
              <div className="text-xs text-gray-500 mt-1">
                {flight.airline} {flight.flight_number}
              </div>
            )}
          </div>

          {/* Right: arrival */}
          <div className="text-center min-w-[80px]">
            <div className="text-xl font-bold text-gray-900">{flight.arrival_airport || "---"}</div>
            <div className="text-sm font-medium text-gray-700">{fmtTime(arr)}</div>
            <div className="text-xs text-gray-500">{fmtDate(arr)}</div>
          </div>
        </div>
      </div>

      {/* Details row */}
      <div className="px-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-gray-500">
          {flight.seats && <span>{t("logistics.flights.seats")}: {flight.seats}</span>}
          {flight.confirmation_number && (
            <span className="font-mono text-gray-700">{t("logistics.common.confirmation")}: {flight.confirmation_number}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {flight.total_cost && (
            <span className="text-sm font-semibold text-gray-900">${flight.total_cost}</span>
          )}
          {flight.booked && (
            <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
              {t("logistics.common.booked")}
            </span>
          )}
        </div>
      </div>

      {flight.notes && <p className="text-xs text-gray-500 px-4 pb-3">{flight.notes}</p>}

      {/* Actions */}
      <div className="flex gap-2 px-4 py-2 border-t border-gray-200">
        <button onClick={() => onEdit(flight)} className="text-xs text-coral-600 hover:text-coral-500">
          {t("logistics.common.edit")}
        </button>
        <button onClick={() => onDelete(flight.id)} className="text-xs text-red-500 hover:text-red-400">
          {t("logistics.common.delete")}
        </button>
      </div>
    </div>
  );
}

export default function FlightPanel({ tripId, flights: initialFlights }) {
  const { t } = useLanguage();
  const [flights, setFlights] = useState(initialFlights || []);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleCreate = async (data) => {
    const res = await createFlight(tripId, data);
    setFlights((prev) => [...prev, res].sort((a, b) => (a.departure_date || "").localeCompare(b.departure_date || "")));
    setShowForm(false);
  };

  const handleUpdate = async (data) => {
    const res = await updateFlight(tripId, editing.id, data);
    setFlights((prev) => prev.map((f) => (f.id === res.id ? res : f)));
    setEditing(null);
  };

  const handleDelete = async (id) => {
    await deleteFlight(tripId, id);
    setFlights((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">{t("logistics.flights.title")}</h2>
        <button onClick={() => { setShowForm(true); setEditing(null); }}
          className="px-3 py-1.5 text-sm bg-coral-500 hover:bg-coral-400 rounded-lg font-medium text-white">
          + {t("logistics.common.add")}
        </button>
      </div>

      {showForm && !editing && (
        <FlightForm onSave={handleCreate} onCancel={() => setShowForm(false)} t={t} />
      )}

      {flights.length === 0 && !showForm && (
        <p className="text-gray-400 text-sm text-center py-8">{t("logistics.flights.empty")}</p>
      )}

      {flights.map((f) =>
        editing?.id === f.id ? (
          <FlightForm key={f.id} initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} t={t} />
        ) : (
          <FlightCard key={f.id} flight={f} onEdit={setEditing} onDelete={handleDelete} t={t} />
        )
      )}
    </div>
  );
}
