import { categoryIcon } from "../../utils/formatters";
import { useLanguage } from "../../i18n/LanguageContext";

export default function AlternativeGroup({
  items,
  dayColor,
  selectedItemId,
  selectedAlt,
  onSelect,
  onItemClick,
}) {
  const { t } = useLanguage();

  return (
    <div className="bg-gray-100 rounded-lg border border-dashed border-gray-300 p-2">
      <div className="flex items-center gap-1.5 mb-2 px-1">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-gray-400">
          <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 01.75.75v3.182a.75.75 0 01-.75.75h-3.182a.75.75 0 010-1.5h1.37l-.84-.841a4.5 4.5 0 00-7.08.681.75.75 0 01-1.3-.75 6 6 0 019.44-.908l.987.987V3.227a.75.75 0 01.75-.75zm-.911 7.5A.75.75 0 0113.199 11a6 6 0 01-9.44.908l-.987-.987v1.584a.75.75 0 01-1.5 0V9.323a.75.75 0 01.75-.75h3.182a.75.75 0 010 1.5H3.834l.84.841a4.5 4.5 0 007.08-.681.75.75 0 011.17-.256z" clipRule="evenodd" />
        </svg>
        <span className="text-[10px] text-gray-400 uppercase font-medium">{t("alternatives.chooseOne")}</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => {
          const isSelected = selectedAlt === item.id || (!selectedAlt && items[0].id === item.id);
          return (
            <button
              key={item.id}
              onClick={() => {
                onSelect(item.id);
                onItemClick(item);
              }}
              className={`w-full text-left rounded-md p-2 transition-all ${
                isSelected
                  ? "bg-white shadow-sm ring-1 ring-gray-300"
                  : "bg-gray-100 opacity-50 hover:opacity-75"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-0.5 h-6 rounded-full" style={{ backgroundColor: dayColor }} />
                <span className="text-xs">{categoryIcon(item.category)}</span>
                <span className={`text-sm font-medium truncate ${isSelected ? "text-gray-900" : "text-gray-500"}`}>
                  {item.name}
                </span>
                {item.google_rating && (
                  <span className="text-xs text-yellow-400 ml-auto">{item.google_rating}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
