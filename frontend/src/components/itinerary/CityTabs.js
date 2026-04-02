import { useMemo } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

export default function CityTabs({ dayPlans, activeCity, onCityChange }) {
  const { t } = useLanguage();

  const cities = useMemo(() => {
    const unique = [...new Set(dayPlans.map((dp) => dp.city).filter(Boolean))];
    return unique;
  }, [dayPlans]);

  // Don't render tabs if 0 or 1 cities
  if (cities.length < 2) return null;

  return (
    <div className="flex items-center gap-1 mb-4 bg-gray-100 rounded-lg p-1">
      <button
        onClick={() => onCityChange(null)}
        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
          activeCity === null
            ? "bg-coral-500 text-white"
            : "text-gray-500 hover:text-gray-900"
        }`}
      >
        {t("cityTabs.all")}
      </button>
      {cities.map((city) => (
        <button
          key={city}
          onClick={() => onCityChange(city)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeCity === city
              ? "bg-coral-500 text-white"
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          📍 {city}
        </button>
      ))}
    </div>
  );
}
