import { useNavigate } from "react-router-dom";
import TripForm from "../components/trips/TripForm";
import { createTrip, getTrips } from "../api/trips";
import { useLanguage } from "../i18n/LanguageContext";

export default function TripCreate() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleSubmit = async (data) => {
    // Check if this is the user's first trip (for onboarding)
    let isFirstTrip = false;
    try {
      const existing = await getTrips();
      isFirstTrip = !existing || existing.length === 0;
    } catch {
      // Ignore — default to no onboarding
    }

    const trip = await createTrip(data);
    const onboarding = isFirstTrip ? "?onboarding=true" : "";
    navigate(`/trips/${trip.id}${onboarding}`);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-8">{t("tripCreate.title")}</h1>
      <TripForm onSubmit={handleSubmit} />
    </div>
  );
}
