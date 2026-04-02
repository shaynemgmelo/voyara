import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { createTripNote, updateTripNote, deleteTripNote } from "../../api/logistics";

const empty = { title: "", content: "", category: "general" };

const CATEGORIES = ["general", "packing", "documents", "budget", "emergency", "tips"];
const CAT_ICONS = {
  general: "\uD83D\uDCDD", packing: "\uD83E\uDDF3", documents: "\uD83D\uDCC4", budget: "\uD83D\uDCB0", emergency: "\uD83D\uDEA8", tips: "\uD83D\uDCA1",
};

function NoteForm({ initial, onSave, onCancel, t }) {
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
        <label className="text-xs text-gray-500">{t("logistics.notes.noteTitle")}</label>
        <input value={form.title} onChange={(e) => set("title", e.target.value)}
          className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" placeholder={t("logistics.notes.titlePlaceholder")} />
      </div>
      <div>
        <label className="text-xs text-gray-500">{t("logistics.notes.category")}</label>
        <select value={form.category} onChange={(e) => set("category", e.target.value)}
          className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{t(`logistics.notes.categories.${c}`)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-gray-500">{t("logistics.notes.content")}</label>
        <textarea value={form.content} onChange={(e) => set("content", e.target.value)} rows={5}
          className="w-full bg-gray-50 rounded px-3 py-2 text-sm text-gray-900" placeholder={t("logistics.notes.contentPlaceholder")} />
      </div>
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

function NoteCard({ note, onEdit, onDelete, t }) {
  const icon = CAT_ICONS[note.category] || "\uD83D\uDCDD";
  const created = new Date(note.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="bg-white shadow-sm rounded-xl p-4 border border-gray-200 hover:border-gray-400 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="text-xl mt-0.5">{icon}</div>
          <div className="flex-1">
            <div className="font-semibold text-sm text-gray-900">{note.title || t("logistics.notes.untitled")}</div>
            <span className="text-xs text-gray-400">
              {t(`logistics.notes.categories.${note.category || "general"}`)} \u00B7 {created}
            </span>
          </div>
        </div>
      </div>
      {note.content && (
        <p className="text-sm text-gray-700 mt-3 whitespace-pre-wrap">{note.content}</p>
      )}
      <div className="flex gap-2 mt-3 pt-2 border-t border-gray-200">
        <button onClick={() => onEdit(note)} className="text-xs text-coral-600 hover:text-coral-500">
          {t("logistics.common.edit")}
        </button>
        <button onClick={() => onDelete(note.id)} className="text-xs text-red-500 hover:text-red-400">
          {t("logistics.common.delete")}
        </button>
      </div>
    </div>
  );
}

export default function NotePanel({ tripId, notes: initialNotes }) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState(initialNotes || []);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleCreate = async (data) => {
    const res = await createTripNote(tripId, data);
    setNotes((prev) => [...prev, res]);
    setShowForm(false);
  };

  const handleUpdate = async (data) => {
    const res = await updateTripNote(tripId, editing.id, data);
    setNotes((prev) => prev.map((n) => (n.id === res.id ? res : n)));
    setEditing(null);
  };

  const handleDelete = async (id) => {
    await deleteTripNote(tripId, id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">{t("logistics.notes.title")}</h2>
        <button onClick={() => { setShowForm(true); setEditing(null); }}
          className="px-3 py-1.5 text-sm bg-coral-500 hover:bg-coral-400 rounded-lg font-medium text-white">
          + {t("logistics.common.add")}
        </button>
      </div>

      {showForm && !editing && (
        <NoteForm onSave={handleCreate} onCancel={() => setShowForm(false)} t={t} />
      )}

      {notes.length === 0 && !showForm && (
        <p className="text-gray-400 text-sm text-center py-8">{t("logistics.notes.empty")}</p>
      )}

      {notes.map((n) =>
        editing?.id === n.id ? (
          <NoteForm key={n.id} initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} t={t} />
        ) : (
          <NoteCard key={n.id} note={n} onEdit={setEditing} onDelete={handleDelete} t={t} />
        )
      )}
    </div>
  );
}
