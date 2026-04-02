import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s,;)<>]+/g) || [];
  // Clean trailing punctuation that may have been captured
  const cleaned = matches.map((u) => u.replace(/[.)]+$/, ""));
  // Deduplicate
  return [...new Set(cleaned)];
}

export default function LinkInput({ onSubmit }) {
  const { t } = useLanguage();
  const [text, setText] = useState("");
  const [status, setStatus] = useState(null); // "saving" | "saved" | "error"
  const [savedCount, setSavedCount] = useState(0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;

    const urls = extractUrls(text);
    if (urls.length === 0) return;

    setStatus("saving");
    setSavedCount(0);

    try {
      let count = 0;
      for (const url of urls) {
        await onSubmit(url);
        count++;
      }
      setText("");
      setSavedCount(count);
      setStatus("saved");
      setTimeout(() => setStatus(null), 2500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus(null), 3000);
    }
  };

  const detectedCount = text.trim() ? extractUrls(text).length : 0;

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <div className="flex-1 relative">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("linkInput.placeholder")}
          className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
        />
        {detectedCount > 1 && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-coral-500 font-medium">
            {detectedCount} links
          </span>
        )}
      </div>
      <button
        type="submit"
        disabled={status === "saving" || detectedCount === 0}
        className="bg-coral-500 hover:bg-coral-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
      >
        {status === "saving"
          ? "..."
          : status === "saved"
          ? savedCount > 1
            ? t("linkInput.savedMultiple", { count: savedCount })
            : t("linkInput.saved")
          : t("linkInput.add")}
      </button>
    </form>
  );
}
