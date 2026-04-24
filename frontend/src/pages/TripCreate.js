import { useNavigate } from "react-router-dom";
import TripForm from "../components/trips/TripForm";
import { createTrip, getTrips, triggerBuild } from "../api/trips";
import { useLanguage } from "../i18n/LanguageContext";

export default function TripCreate() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  // The new flow does everything in two API calls:
  //   1. POST /trips           — create the trip with name + num_days + ai_mode
  //   2. POST /trips/:id/build — Rails inserts the links via insert_all
  //                              (bypassing the legacy callback) and triggers
  //                              the AI service's combined extract → profile →
  //                              build pipeline as ONE background task.
  //
  // The frontend then navigates to /trips/:id where the GenerationProgressModal
  // polls until items appear (or build_error fires the failure modal).
  const handleSubmit = async ({ name, num_days, ai_mode, destination, traveler_profile, links }) => {
    let isFirstTrip = false;
    try {
      const existing = await getTrips();
      isFirstTrip = !existing || existing.length === 0;
    } catch {
      // ignore; default = no onboarding
    }

    const trip = await createTrip({
      name,
      num_days,
      ai_mode,
      destination,
      traveler_profile,
    });

    // Trigger the combined pipeline. Rails persists the links + fires
    // /api/extract-and-build on the AI service. We don't loop createLink
    // because that fires the legacy after_create_commit extraction
    // callback which would race with the new pipeline.
    try {
      await triggerBuild(trip.id, links || []);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[trip-create] build trigger failed:", e);
      // Still navigate — the user lands on the trip page where they can
      // retry from the failure modal.
    }

    const onboarding = isFirstTrip ? "?onboarding=true" : "";
    navigate(`/trips/${trip.id}${onboarding}`);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-2">{t("tripCreate.title")}</h1>
      <p className="text-sm text-gray-500 mb-8">
        {t("tripCreate.subtitle") || "Cole seus links, escolha como quer montar, e a gente faz o resto."}
      </p>
      <TripForm onSubmit={handleSubmit} />
    </div>
  );
}
