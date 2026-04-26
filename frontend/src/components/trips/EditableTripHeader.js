import { useState, useRef, useEffect } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * Inline-editable trip title + day count. Drops into the TripDetail
 * page header. Click the name (or pencil) to rename; click the day
 * count (or pencil) to change duration. Both fields commit on Enter
 * or blur, cancel on Escape.
 *
 * Why inline instead of a modal: the user explicitly asked to edit
 * "with the project already created" — keeping it in the same spot
 * they're already looking at means one click instead of opening a
 * settings dialog.
 *
 * Backend semantics:
 *   - name: free text, validated by Rails (presence).
 *   - num_days: 1..30. Increasing appends empty days at the end.
 *     Shrinking is REJECTED by Rails if any chopped day still has
 *     itinerary_items — the error message comes back in the JSON
 *     response and we surface it in red so the user knows to clear
 *     those days first instead of silently destroying their work.
 *
 * Props:
 *   name           — current trip.name
 *   numDays        — current trip.num_days
 *   onSave({name?, num_days?}) — async; rethrows backend errors so
 *                                we can show the validation message.
 */
export default function EditableTripHeader({ name, numDays, onSave, isStaging }) {
  const { t, lang } = useLanguage();
  const pt = lang === "pt-BR";

  const [editingName, setEditingName] = useState(false);
  const [editingDays, setEditingDays] = useState(false);
  const [draftName, setDraftName] = useState(name || "");
  const [draftDays, setDraftDays] = useState(numDays || 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const nameInputRef = useRef(null);
  const daysInputRef = useRef(null);

  // Reset drafts whenever the underlying trip changes (polling refresh).
  useEffect(() => {
    if (!editingName) setDraftName(name || "");
  }, [name, editingName]);
  useEffect(() => {
    if (!editingDays) setDraftDays(numDays || 1);
  }, [numDays, editingDays]);

  // Auto-focus + select on entering edit mode.
  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);
  useEffect(() => {
    if (editingDays && daysInputRef.current) {
      daysInputRef.current.focus();
      daysInputRef.current.select();
    }
  }, [editingDays]);

  const commitName = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setError(pt ? "Nome não pode ficar vazio" : "Name cannot be empty");
      return;
    }
    if (trimmed === (name || "").trim()) {
      setEditingName(false);
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: trimmed });
      setEditingName(false);
    } catch (e) {
      setError(extractMessage(e, pt));
    } finally {
      setSaving(false);
    }
  };

  const commitDays = async () => {
    const n = parseInt(draftDays, 10);
    if (Number.isNaN(n) || n < 1 || n > 30) {
      setError(pt ? "Use um número entre 1 e 30" : "Use a number between 1 and 30");
      return;
    }
    if (n === numDays) {
      setEditingDays(false);
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ num_days: n });
      setEditingDays(false);
    } catch (e) {
      setError(extractMessage(e, pt));
    } finally {
      setSaving(false);
    }
  };

  const cancelName = () => {
    setDraftName(name || "");
    setEditingName(false);
    setError(null);
  };
  const cancelDays = () => {
    setDraftDays(numDays || 1);
    setEditingDays(false);
    setError(null);
  };

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        {editingName ? (
          <input
            ref={nameInputRef}
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitName();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelName();
              }
            }}
            disabled={saving}
            maxLength={120}
            className="text-xl font-bold text-gray-900 bg-white border-2 border-coral-400 rounded-md px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-coral-300 min-w-0 max-w-full"
            aria-label={pt ? "Editar nome do projeto" : "Edit project name"}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="group flex items-center gap-1.5 text-left hover:text-coral-600 transition-colors min-w-0"
            title={pt ? "Clique para editar" : "Click to edit"}
          >
            <h1 className="text-xl font-bold text-gray-900 group-hover:text-coral-600 truncate">
              {name}
            </h1>
            <PencilIcon className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 group-hover:text-coral-500 flex-shrink-0" />
          </button>
        )}
        {isStaging && (
          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200">
            🧪 {pt ? "Teste" : "Staging"}
          </span>
        )}
      </div>

      {/* The destination text lives in the parent header so we don't
          duplicate it here — only the editable day count. */}
      <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
        {editingDays ? (
          <span className="inline-flex items-center gap-1">
            <input
              ref={daysInputRef}
              type="number"
              min="1"
              max="30"
              value={draftDays}
              onChange={(e) => setDraftDays(e.target.value)}
              onBlur={commitDays}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitDays();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelDays();
                }
              }}
              disabled={saving}
              className="w-16 text-sm font-semibold text-gray-900 bg-white border-2 border-coral-400 rounded-md px-2 py-0.5 text-center focus:outline-none focus:ring-2 focus:ring-coral-300"
              aria-label={pt ? "Editar quantidade de dias" : "Edit number of days"}
            />
            <span className="text-gray-500">{t("tripDetail.days")}</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setEditingDays(true)}
            className="group inline-flex items-center gap-1 hover:text-coral-600 transition-colors"
            title={pt ? "Clique para editar" : "Click to edit"}
          >
            <span className="font-semibold">
              {numDays} {t("tripDetail.days")}
            </span>
            <PencilIcon className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 group-hover:text-coral-500" />
          </button>
        )}
        {saving && (
          <span className="text-[11px] text-coral-500 italic animate-pulse">
            {pt ? "Salvando..." : "Saving..."}
          </span>
        )}
      </div>

      {error && (
        <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-1">
          <span>⚠️</span>
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600 font-bold"
            aria-label={pt ? "Fechar" : "Dismiss"}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function PencilIcon({ className = "" }) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

// The API client (api/client.js) already joins Rails `errors` into the
// Error message, so this is mostly cosmetic — clamp very long messages
// and provide a localized fallback if .message is empty.
function extractMessage(err, pt) {
  if (!err) return pt ? "Erro desconhecido" : "Unknown error";
  const raw = err?.message || String(err);
  if (!raw) return pt ? "Erro desconhecido" : "Unknown error";
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}
