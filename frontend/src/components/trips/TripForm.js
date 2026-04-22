import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

// Frontend-only URL validation. We don't fire any backend call here —
// extraction is deferred until the user clicks "Generate" (the new
// single-pipeline flow). This regex check just gives instant
// green/red feedback so broken or malformed URLs get caught before
// commitment.
const URL_PLATFORM = [
  { name: "tiktok",    test: /(?:^|\/\/)(?:vt\.|vm\.|www\.)?tiktok\.com\//i },
  { name: "instagram", test: /(?:^|\/\/)(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\//i },
  { name: "youtube",   test: /(?:^|\/\/)(?:www\.|m\.)?(?:youtube\.com\/(?:watch|shorts|live)|youtu\.be\/)/i },
  { name: "web",       test: /^https?:\/\/[^\s/]+\.[a-z]{2,}/i }, // generic fallback
];

function classifyUrl(url) {
  const trimmed = (url || "").trim();
  if (!trimmed) return { valid: false, platform: null };
  for (const p of URL_PLATFORM) {
    if (p.test.test(trimmed)) return { valid: true, platform: p.name };
  }
  return { valid: false, platform: null };
}

export default function TripForm({ onSubmit, initial }) {
  const { t, lang } = useLanguage();
  const pt = lang === "pt-BR";

  const [name, setName] = useState(initial?.name || "");
  const [numDays, setNumDays] = useState(initial?.num_days || 5);
  const [aiMode, setAiMode] = useState(initial?.ai_mode || "eco");
  const [linkText, setLinkText] = useState("");
  const [links, setLinks] = useState([]); // [{url, platform, valid}]
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const addLink = () => {
    const trimmed = linkText.trim();
    if (!trimmed) return;
    // Allow pasting multiple at once (one per line or whitespace-separated).
    const candidates = trimmed.split(/[\s,]+/).filter(Boolean);
    const next = [...links];
    for (const candidate of candidates) {
      const { valid, platform } = classifyUrl(candidate);
      // Skip duplicates by URL.
      if (next.some((l) => l.url === candidate)) continue;
      next.push({ url: candidate, platform, valid });
    }
    setLinks(next);
    setLinkText("");
  };

  const removeLink = (idx) => {
    setLinks((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleLinkKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addLink();
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(pt ? "Dá um nome pra viagem." : "Give the trip a name.");
      return;
    }
    if (aiMode !== "manual" && links.length === 0) {
      setError(pt ? "Cola pelo menos um link, ou escolha o modo manual." : "Paste at least one link, or pick manual mode.");
      return;
    }
    if (links.some((l) => !l.valid)) {
      setError(pt ? "Tem link inválido na lista — remove antes de continuar." : "There's an invalid link — remove it first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        num_days: numDays,
        ai_mode: aiMode,
        links: links.map((l) => l.url),
      });
    } catch (err) {
      setError(err.message || (pt ? "Algo deu errado." : "Something went wrong."));
      setSubmitting(false);
    }
  };

  const hasInvalid = links.some((l) => !l.valid);
  const generateLabel = aiMode === "manual"
    ? (pt ? "Criar viagem" : "Create trip")
    : (pt ? "Gerar roteiro" : "Generate itinerary");

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 text-sm p-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Trip name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {pt ? "Nome da viagem" : "Trip name"}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder={pt ? "Ex: Lua de mel em Buenos Aires" : "e.g. Honeymoon in Buenos Aires"}
          className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
        />
      </div>

      {/* Duration */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {pt ? "Quantos dias?" : "How many days?"}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="1"
            max="15"
            value={numDays}
            onChange={(e) => setNumDays(parseInt(e.target.value) || 1)}
            className="flex-1 accent-coral-500"
          />
          <span className="text-gray-900 font-bold text-lg w-8 text-center tabular-nums">
            {numDays}
          </span>
        </div>
      </div>

      {/* AI vs manual */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {pt ? "Como você quer montar?" : "How do you want to build it?"}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setAiMode("eco")}
            className={`text-left rounded-xl border-2 p-4 transition ${
              aiMode === "eco"
                ? "border-coral-500 bg-coral-50"
                : "border-gray-200 hover:border-gray-300 bg-white"
            }`}
          >
            <div className="text-2xl mb-1">✨</div>
            <div className="font-bold text-gray-900 text-sm">
              {pt ? "IA monta pra mim" : "AI builds it"}
            </div>
            <div className="text-xs text-gray-500 mt-1 leading-snug">
              {pt
                ? "A gente lê os vídeos, identifica os lugares e monta os dias."
                : "We read the videos, identify places, and build the days."}
            </div>
          </button>
          <button
            type="button"
            onClick={() => setAiMode("manual")}
            className={`text-left rounded-xl border-2 p-4 transition ${
              aiMode === "manual"
                ? "border-coral-500 bg-coral-50"
                : "border-gray-200 hover:border-gray-300 bg-white"
            }`}
          >
            <div className="text-2xl mb-1">✏️</div>
            <div className="font-bold text-gray-900 text-sm">
              {pt ? "Eu monto manual" : "I'll build manually"}
            </div>
            <div className="text-xs text-gray-500 mt-1 leading-snug">
              {pt
                ? "Extraímos os lugares dos vídeos, você arrasta nos dias."
                : "We extract places from videos, you drag them into days."}
            </div>
          </button>
        </div>
      </div>

      {/* Links */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {pt ? "Links (TikTok, Instagram, YouTube ou blog)" : "Links (TikTok, Instagram, YouTube or blog)"}
          {aiMode === "manual" && (
            <span className="text-gray-400 font-normal text-xs ml-2">
              {pt ? "(opcional no manual)" : "(optional in manual)"}
            </span>
          )}
        </label>
        <div className="flex gap-2">
          <input
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            onKeyDown={handleLinkKey}
            placeholder={pt ? "Cola aqui e Enter" : "Paste here and press Enter"}
            className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
          />
          <button
            type="button"
            onClick={addLink}
            disabled={!linkText.trim()}
            className="bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 font-medium px-4 py-2.5 rounded-lg text-sm transition"
          >
            {pt ? "Adicionar" : "Add"}
          </button>
        </div>
        {links.length > 0 && (
          <ul className="mt-3 space-y-2">
            {links.map((l, i) => (
              <li
                key={`${l.url}-${i}`}
                className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
                  l.valid
                    ? "bg-emerald-50 border border-emerald-100"
                    : "bg-red-50 border border-red-100"
                }`}
              >
                <span className={l.valid ? "text-emerald-600" : "text-red-600"}>
                  {l.valid ? "✓" : "✗"}
                </span>
                {l.platform && (
                  <span className="text-[10px] uppercase font-semibold text-gray-500 tracking-wide">
                    {l.platform}
                  </span>
                )}
                <span className="truncate text-gray-700 flex-1">{l.url}</span>
                <button
                  type="button"
                  onClick={() => removeLink(i)}
                  className="text-gray-400 hover:text-red-600 text-xs"
                  aria-label="remove"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {hasInvalid && (
          <p className="text-xs text-red-600 mt-2">
            {pt
              ? "Algum link não é uma URL válida — remove antes de continuar."
              : "One or more links isn't a valid URL — remove it first."}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-coral-500 hover:bg-coral-600 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition"
      >
        {submitting
          ? (pt ? "Criando..." : "Creating...")
          : generateLabel}
      </button>
    </form>
  );
}
