import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import useTripDetail from "../hooks/useTripDetail";
import DayPlanColumn from "../components/itinerary/DayPlanColumn";
import TripTimeline from "../components/itinerary/TripTimeline";
import GeoReviewModal, { collectFlaggedItems } from "../components/itinerary/GeoReviewModal";
import ItemDetail from "../components/itinerary/ItemDetail";
import ItemForm from "../components/itinerary/ItemForm";
import LinkInput from "../components/links/LinkInput";
import AiAssistBanner from "../components/trips/AiAssistBanner";
import LinkList from "../components/links/LinkList";
import TripMap from "../components/map/TripMap";
import HotelMapInput from "../components/map/HotelMapInput";
import VibeTagFilter from "../components/itinerary/VibeTagFilter";
import SchedulePreview from "../components/itinerary/SchedulePreview";
import TravelerProfileCard from "../components/trips/TravelerProfileCard";
import CityTabs from "../components/itinerary/CityTabs";
import ProcessingStatus, { detectPhase } from "../components/trips/ProcessingStatus";
import GenerationProgressModal from "../components/modals/GenerationProgressModal";
import AskDestinationModal from "../components/modals/AskDestinationModal";
import CityDistributionModal from "../components/modals/CityDistributionModal";
import AddDayTripModal from "../components/modals/AddDayTripModal";
import ExtractedPlacesPanel from "../components/trips/ExtractedPlacesPanel";
import EditableTripHeader from "../components/trips/EditableTripHeader";
import PlaceDetailModal from "../components/modals/PlaceDetailModal";
import { updateTrip, triggerBuild, confirmCityDistribution, addDayTrip, manualAssist, reenrichTripPlaces } from "../api/trips";
import PlaceSuggestions from "../components/itinerary/PlaceSuggestions";
import FeedbackBox from "../components/itinerary/FeedbackBox";
import ConflictsBanner from "../components/itinerary/ConflictsBanner";
import ValidationReportBanner from "../components/itinerary/ValidationReportBanner";
import FlightPanel from "../components/logistics/FlightPanel";
import NotePanel from "../components/logistics/NotePanel";
import TripPDFExport from "../components/trip/TripPDFExport";
import TripShareModal from "../components/trip/TripShareModal";
import { getTravelTimes, recalculateSchedule } from "../api/dayPlans";
import { optimizeTripRouting, enrichTripExperiences } from "../api/optimize";
import { useLanguage } from "../i18n/LanguageContext";
import { buildItineraryItemPayload } from "../utils/itineraryItemPayload";

export default function TripDetail() {
  const { id } = useParams();
  const { t, lang } = useLanguage();
  const {
    trip,
    loading,
    error,
    addItem,
    reorderDays,
    updateItem,
    removeItem,
    reorderItems,
    moveItemBetweenDays,
    addLink,
    removeLink,
    updateAiMode,
    updateProfile,
    refineItinerary,
    refining,
    retryBuild,
    addLodging,
    removeLodging,
    fetchTrip,
    clientForcedFailure,
  } = useTripDetail(id);

  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedDayNumber, setSelectedDayNumber] = useState(null);
  const [hoveredItemId, setHoveredItemId] = useState(null);
  const [geoModalDismissed, setGeoModalDismissed] = useState(false);
  // Tracks whether we've already run silent auto-enrichment on this trip
  // in this browser session, so navigating away and back doesn't re-run it.
  const autoEnrichedRef = useRef(false);
  // Same idea for the places re-enrichment (editorial_summary + top_reviews
  // backfill) — fires once per session per trip when we detect old-schema
  // places. The endpoint itself is idempotent, but skipping the network
  // round-trip when nothing's missing keeps things snappy.
  const autoReenrichedRef = useRef(false);
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === "undefined") return "list";
    return localStorage.getItem("mapass.viewMode") || "timeline";
  });

  const switchView = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("mapass.viewMode", mode);
    } catch {}
  };
  const [showItemForm, setShowItemForm] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(null); // dayPlanId
  const [expandedItem, setExpandedItem] = useState(null);
  const [vibeFilters, setVibeFilters] = useState([]);
  const [travelTimes, setTravelTimes] = useState({});
  const [schedulePreview, setSchedulePreview] = useState(null);
  const [activeCity, setActiveCity] = useState(null);
  const [activeTab, setActiveTab] = useState("itinerary");
  const [showPDFExport, setShowPDFExport] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  // Loading state for the "Assistência IA" button (only used in manual mode).
  const [aiAssistRunning, setAiAssistRunning] = useState(false);
  const [showAddDayTrip, setShowAddDayTrip] = useState(false);
  // Place detail modal state — lifted out of ExtractedPlacesPanel so the
  // SAME modal opens whether the user clicks a card in the panel or a pin
  // on the map. `detailPlace` is the full place dict; `highlightedKey` is
  // the place's google_place_id|name and is forwarded to TripMap +
  // ExtractedPlacesPanel so they highlight + scroll the matching surface.
  const [detailPlace, setDetailPlace] = useState(null);
  const [highlightedPlaceKey, setHighlightedPlaceKey] = useState(null);
  const [hoveredPlaceKey, setHoveredPlaceKey] = useState(null);

  // Build a fingerprint of all item IDs to detect changes (adds, deletes, reorders)
  const itemsFingerprint = useMemo(() => {
    if (!trip?.day_plans) return "";
    return trip.day_plans
      .map((dp) => `${dp.id}:${(dp.itinerary_items || []).map((i) => i.id).join(",")}`)
      .join("|");
  }, [trip?.day_plans]);

  // Fetch travel times for all days with 2+ items
  const fetchAllTravelTimes = useCallback(async () => {
    if (!trip?.day_plans) return;
    for (const dp of trip.day_plans) {
      const itemsWithCoords = dp.itinerary_items?.filter((i) => i.latitude) || [];
      if (itemsWithCoords.length >= 2) {
        try {
          const data = await getTravelTimes(trip.id, dp.id);
          setTravelTimes((prev) => ({ ...prev, [dp.id]: data.segments || [] }));
        } catch {
          // Silently skip
        }
      } else {
        // Clear travel times for days with 0-1 items
        setTravelTimes((prev) => ({ ...prev, [dp.id]: [] }));
      }
    }
  }, [trip?.day_plans, trip?.id, itemsFingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchAllTravelTimes();
  }, [fetchAllTravelTimes]);

  // Collect all unique vibe tags across all items
  const availableVibeTags = useMemo(() => {
    if (!trip?.day_plans) return [];
    const tags = new Set();
    trip.day_plans.forEach((dp) =>
      dp.itinerary_items?.forEach((item) =>
        item.vibe_tags?.forEach((tag) => tags.add(tag))
      )
    );
    return [...tags].sort();
  }, [trip]);

  // Compute pipeline phase here (before any early return) so the silent
  // auto-enrich effect below can use it as a dependency without breaking
  // Rules of Hooks.
  const pipelinePhase = detectPhase(trip).phase;

  // Silent auto-enrichment for trips built BEFORE the experience feature
  // existed. If the trip has items but none are tagged "experiencia", we
  // fire a background enrich + optimize once per session.
  //
  // CRITICAL: this NEVER runs in manual mode. Trip 44 surfaced a real
  // bug here — the user dragged ONE card ("Woolfox") to Day 1 and the
  // auto-enrich saw "trip has items, none have the 'experiencia' tag",
  // then silently added 4 AI-generated activities (Harry Potter Studio
  // Tour in Watford, Thames cruise, etc.) the user never asked for.
  // The whole point of manual mode is "the user organizes; the AI shuts
  // up unless explicitly summoned". Auto-enrich + auto-optimize would
  // also rewrite time slots and reorder items the user just placed.
  useEffect(() => {
    if (!trip || !id) return;
    if (autoEnrichedRef.current) return;
    if (pipelinePhase === "generating" || pipelinePhase === "analyzing") return;
    // Manual mode is a TERMINAL "user owns it" state — no AI may touch
    // the itinerary unless the user clicks "Assistência IA" explicitly.
    if (trip.ai_mode === "manual") return;

    const items = (trip.day_plans || []).flatMap(
      (dp) => dp.itinerary_items || []
    );
    if (items.length === 0) return;
    const hasExperience = items.some((i) =>
      Array.isArray(i.vibe_tags) && i.vibe_tags.includes("experiencia")
    );
    if (hasExperience) return;

    autoEnrichedRef.current = true;
    (async () => {
      try { await enrichTripExperiences(id); } catch {}
      try { await optimizeTripRouting(id); } catch {}
      try { await fetchTrip(); } catch {}
    })();
  }, [trip, id, pipelinePhase, fetchTrip]);

  // Auto-backfill rich place details (editorial_summary + top_reviews +
  // opening hours) for trips built BEFORE those fields were added. We
  // detect "old schema" places by checking for entries that have a
  // google_place_id (so they WERE enriched) but no editorial_summary
  // AND no top_reviews. The endpoint itself is idempotent — this guard
  // just avoids the network round-trip when nothing needs backfill.
  useEffect(() => {
    if (!trip || !id) return;
    if (autoReenrichedRef.current) return;
    if (pipelinePhase === "generating" || pipelinePhase === "analyzing") return;

    const places = trip?.traveler_profile?.places_mentioned || [];
    if (places.length === 0) return;
    // Two reasons to reenrich:
    //   a) Place has google_place_id but no editorial_summary/reviews
    //      (cheap Google Places details fetch, cached 24h)
    //   b) Place lacks both editorial_summary AND creator_note AND
    //      rich_description — Haiku will generate a guide-style blurb
    //      + practical tips so the modal stops looking bare.
    const needsBackfill = places.some(
      (p) =>
        (p?.google_place_id
          && !p?.editorial_summary
          && !(Array.isArray(p?.top_reviews) && p.top_reviews.length > 0))
        || (
          (p?.name || "").trim()
          && !(p?.editorial_summary || "").trim()
          && !(p?.creator_note || "").trim()
          && !(p?.rich_description || "").trim()
        ),
    );
    if (!needsBackfill) return;

    autoReenrichedRef.current = true;
    (async () => {
      try {
        const result = await reenrichTripPlaces(id);
        if (result?.backfilled > 0) {
          await fetchTrip();
        }
      } catch {
        // Silent — the cards already render fine without the new fields,
        // they just look a bit bare. We'll try again next session.
      }
    })();
  }, [trip, id, pipelinePhase, fetchTrip]);

  // Place-detail modal handlers — declared at the top level (not inside
  // any conditional) so React's hook ordering rule is respected even
  // when the early returns below short-circuit the render. They each
  // rely only on stable setters + addItem so the dependency lists stay
  // tight.
  // placeKey is the stable pool-index string emitted by ExtractedPlacesPanel
  // and TripMap ("String(globalIndex)" / "String(poolIndex)"). It's the same
  // key the panel stores in cardRefs and compares against highlightedPlaceKey.
  // Falling back to google_place_id || name only for map-pin clicks that
  // predate the dual-arg signature — those places carry poolIndex directly on
  // the object so we use that first.
  const handlePlaceClick = useCallback((place, placeKey) => {
    if (!place) return;
    setDetailPlace(place);
    const key = placeKey
      ?? (place.poolIndex != null ? String(place.poolIndex) : null)
      ?? place.google_place_id
      ?? place.name
      ?? null;
    setHighlightedPlaceKey(key);
  }, []);

  const closePlaceDetail = useCallback(() => {
    setDetailPlace(null);
    // Keep highlightedPlaceKey set briefly so a reopen of the same
    // place doesn't lose its scroll-into-view animation. The next
    // hover/click will overwrite it.
  }, []);

  const handleAddPlaceToDay = useCallback(
    async (place, dayPlanId) => {
      if (!place || !dayPlanId) return;
      await addItem(dayPlanId, buildItineraryItemPayload(place, {
        origin: "extracted_from_video",
      }));
      // Brief visual confirmation in the modal before it closes.
      setTimeout(() => closePlaceDetail(), 600);
    },
    [addItem, closePlaceDetail],
  );

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center text-gray-500">
        {t("tripDetail.loading")}
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center text-red-400">
        {error || t("tripDetail.notFound")}
      </div>
    );
  }

  const handleItemClick = (item) => {
    setSelectedItemId(item.id);
    setExpandedItem(item);
  };

  const handleMarkerClick = (item) => {
    setSelectedItemId(item.id);
    setExpandedItem(item);
    const el = document.getElementById(`item-${item.id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleAddItem = async (dayPlanId, data) => {
    await addItem(dayPlanId, data);
    setShowItemForm(null);
  };

  const handleSwapItem = async (itemId, swapData) => {
    // Find which day plan this item belongs to
    const dayPlan = trip.day_plans.find((dp) =>
      dp.itinerary_items?.some((i) => i.id === itemId)
    );
    if (dayPlan) {
      await updateItem(dayPlan.id, itemId, swapData);
    }
  };

  const handleDragEnd = (result) => {
    const { source, destination, draggableId, type } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // DAY-LEVEL DRAG: user reordered entire day blocks. The Droppable
    // wrapping the day list uses type="day"; each DayPlanColumn wrapper
    // is a Draggable with the same type. Build the new ordered list of
    // day_plan IDs and persist via reorderDays.
    if (type === "day") {
      const currentDays = activeCity
        ? trip.day_plans?.filter((dp) => dp.city === activeCity)
        : trip.day_plans;
      if (!currentDays) return;
      const ids = currentDays.map((dp) => dp.id);
      const [moved] = ids.splice(source.index, 1);
      ids.splice(destination.index, 0, moved);
      reorderDays(ids);
      return;
    }

    // Drag FROM the manual-mode extracted-places panel TO a day → create a
    // new itinerary_item on that day. The draggableId encodes the place name
    // ("extracted::<name>::<index>") since extracted places have no DB id yet.
    if (source.droppableId === ExtractedPlacesPanel.DROPPABLE_ID) {
      const destDayId = parseInt(destination.droppableId);
      if (Number.isNaN(destDayId)) return;
      // Format: "extracted::<name>::<index>::<globalIndex?>". We prefer
      // the index when present so duplicate names don't collide on lookup.
      const parts = draggableId.split("::");
      const name = parts[1] || "";
      const idxFromDrag = parts[2] != null ? Number(parts[2]) : NaN;
      if (!name) return;
      // Pull the FULL enriched place from the profile so we propagate
      // lat/lng + google_place_id + photos + address to Rails. Trip 44
      // surfaced a real bug here: the previous version of this handler
      // sent only {name, category, source, origin, source_url}, which
      // meant the new itinerary_item had no coordinates and so the map
      // pin silently disappeared. Match by globalIndex when it lines
      // up; fall back to the first name match.
      const candidates = (trip?.traveler_profile?.places_mentioned || []);
      const place =
        (!Number.isNaN(idxFromDrag) && candidates[idxFromDrag])
        || candidates.find((p) => (p?.name || "") === name);
      // Use the place dict if found; otherwise fall back to bare name so
      // the item is created even when the enriched entry is missing.
      addItem(destDayId, buildItineraryItemPayload(place || { name }, {
        origin: "extracted_from_video",
      }));
      return;
    }

    const sourceDayId = parseInt(source.droppableId);
    const destDayId = parseInt(destination.droppableId);
    const itemId = parseInt(draggableId);

    if (sourceDayId === destDayId) {
      // Reorder within same day
      const dayPlan = trip.day_plans.find((dp) => dp.id === sourceDayId);
      const newItems = [...dayPlan.itinerary_items];
      const [moved] = newItems.splice(source.index, 1);
      newItems.splice(destination.index, 0, moved);
      reorderItems(sourceDayId, newItems.map((i) => i.id));
    } else {
      // Move between days
      moveItemBetweenDays(sourceDayId, destDayId, itemId, destination.index);
    }
  };

  // Phase 4 — destination fallback. Persists the user-typed city to the
  // trip, clears the needs_destination flag, then re-triggers the build
  // so the AI can finally pick landmarks / validate places.
  const handleDestinationSubmit = async (city) => {
    try {
      const updatedProfile = {
        ...(trip?.traveler_profile || {}),
      };
      delete updatedProfile.needs_destination;
      await updateTrip(trip.id, {
        destination: city,
        traveler_profile: updatedProfile,
      });
      await fetchTrip();
      // Re-fire the combined pipeline. Extraction will skip cached links;
      // profile + build run again with the destination this time.
      await triggerBuild(trip.id);
      await fetchTrip();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[trip] destination fallback failed:", e);
    }
  };

  const handleCityDistributionSubmit = async (selectedCities, dayDistribution) => {
    try {
      await confirmCityDistribution(trip.id, selectedCities, dayDistribution);
      // Backend flips city_distribution.status to "confirmed" and resumes
      // extract_profile_and_build. Polling will pick up the phase change.
      await fetchTrip();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[trip] city distribution confirmation failed:", e);
    }
  };

  // Day-trip add via /add-day-trip — direct, deterministic, no Sonnet
  // refine. Modes:
  //   - extend:  bumps trip.num_days +1, drops the new day-trip on the
  //              new last day. Original days untouched.
  //   - replace: clears items on a specific day, drops the day-trip
  //              there. Refuses if the day has video-anchored items
  //              (modal surfaces the error so the user can drag/keep
  //              them manually first).
  const mainCityFromProfile = trip?.traveler_profile?.main_destination?.city || "";
  const mainCountryFromProfile = trip?.traveler_profile?.main_destination?.country || "";
  const handleAddDayTrip = async (cityName, options = {}) => {
    if (!cityName) return;
    await addDayTrip(trip.id, cityName, {
      country: mainCountryFromProfile,
      mode: options.mode || "extend",
      targetDayNumber: options.targetDayNumber,
    });
    await fetchTrip();
  };
  const handleRemoveDayTrip = async (cityName) => {
    if (!cityName) return;
    const ok = window.confirm(
      lang === "pt-BR"
        ? `Remover o day-trip a ${cityName}? O dia vira flexível na cidade principal.`
        : `Remove the day-trip to ${cityName}? That day becomes flexible in the main city.`,
    );
    if (!ok) return;
    const feedback = lang === "pt-BR"
      ? `Remova o day-trip a ${cityName} e troque por um dia flexível em ${mainCityFromProfile || "minha cidade base"}.`
      : `Remove the day-trip to ${cityName} and replace it with a flexible day in ${mainCityFromProfile || "my base city"}.`;
    await refineItinerary(feedback, "trip");
    await fetchTrip();
  };

  // Phase 5.5 — heavy pipeline phases open a full-screen progress modal
  // instead of a tiny inline pulse. Shared phase detection with
  // ProcessingStatus so extracting stays inline and the modal only covers
  // analyzing + generating. "failed" gets a red error card instead.
  //
  // `clientForcedFailure` is the 180 s ceiling from useTripDetail — it
  // flips the UI into the failure card even when the backend hasn't yet
  // acknowledged the problem, so the user is NEVER stranded on 95 %.
  const effectivePhase = clientForcedFailure ? "failed" : pipelinePhase;
  const showProgressModal =
    effectivePhase === "analyzing" || effectivePhase === "generating";
  const buildErrorMsg =
    effectivePhase === "failed"
      ? (trip?.traveler_profile?.build_error?.message
         || (clientForcedFailure
             ? "A geração está demorando mais do que o normal. Pode ter sido instabilidade temporária — tentar de novo costuma funcionar."
             : "Falha desconhecida"))
      : null;

  // Phase 4 — destination fallback. Fires when extraction completed but
  // no city was inferred AND the trip has no destination set. Pauses
  // everything until the user types a city.
  const needsDestination = effectivePhase === "needs_destination";
  // Multi-base pause — classifier detected 2+ base cities, build is paused
  // server-side until the user confirms day distribution via the modal.
  const awaitingCityDistribution =
    effectivePhase === "awaiting_city_distribution";
  const cityDistribution = trip?.traveler_profile?.city_distribution;
  const isManualMode = trip?.ai_mode === "manual";
  // Manual trips never auto-build. The "Assistência IA" button is the
  // only way the user can ask the AI to organize their extracted places
  // into days. Only offer it when there's nothing in the itinerary yet —
  // re-triggering after items exist would duplicate everything.
  const hasItemsForAssist = trip?.day_plans?.some(
    (dp) => (dp.itinerary_items || []).length > 0,
  );
  const showAiAssistButton = isManualMode && !hasItemsForAssist;
  // Stats fed to the AI Assist banner so the explanation feels grounded
  // in the user's data (X placed by you, Y empty days, etc.).
  const placedCount = (trip?.day_plans || []).reduce(
    (sum, dp) => sum + ((dp.itinerary_items || []).length),
    0,
  );
  const emptyDayCount = (trip?.day_plans || []).filter(
    (dp) => (dp.itinerary_items || []).length === 0,
  ).length;
  // Manual-mode: places extracted from videos that haven't been dragged
  // onto a day yet. Each one already has lat/lng (geocoded by the backend
  // during extract-and-build) so the map can drop a gray pin for it.
  // Filtered against current itinerary item names so a place that was
  // dragged disappears from the gray-pin pool and reappears as a colored
  // day-pin instantly.
  //
  // poolIndex is attached BEFORE filtering so the number on each card
  // stays stable as items are dragged out — card #5 stays #5 even after
  // cards #1-4 disappear, matching what the user sees on the map.
  const unassignedPlaces = (() => {
    if (!isManualMode) return [];
    const placesMentioned = trip?.traveler_profile?.places_mentioned || [];
    if (placesMentioned.length === 0) return [];
    const usedNames = new Set();
    (trip?.day_plans || []).forEach((dp) => {
      (dp.itinerary_items || []).forEach((it) => {
        usedNames.add((it.name || "").trim().toLowerCase());
      });
    });
    return placesMentioned
      .map((p, idx) => ({ ...p, poolIndex: idx }))
      .filter((p) => !usedNames.has((p.name || "").trim().toLowerCase()));
  })();
  const handleAiAssist = async () => {
    if (aiAssistRunning) return;
    setAiAssistRunning(true);
    try {
      // New manual-aware endpoint — respects user-placed items, fills
      // populated days from same-source video, fills empty days from the
      // leftover pool clustered by proximity. Returns synchronously.
      await manualAssist(trip.id);
      await fetchTrip();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[ai-assist] failed:", e);
    } finally {
      setAiAssistRunning(false);
    }
  };

  // Inline header edits: name + num_days. updateTrip throws on Rails
  // validation failure (e.g. trying to shrink num_days when day 7 still
  // has items) — we let the error bubble so EditableTripHeader can show
  // it inline instead of swallowing it. fetchTrip after success refreshes
  // day_plans to reflect any added/removed days from the model callback.
  const handleSaveTripMeta = async (changes) => {
    await updateTrip(trip.id, changes);
    await fetchTrip();
  };

  return (
    <div className="max-w-[1600px] mx-auto pb-16">
      {showProgressModal && (
        <GenerationProgressModal
          phase={pipelinePhase}
          trip={trip}
          onRetry={retryBuild}
        />
      )}
      {awaitingCityDistribution && cityDistribution && (
        <CityDistributionModal
          baseCities={cityDistribution.base_cities || []}
          numDays={
            cityDistribution.num_days
            || trip?.num_days
            || (trip?.day_plans?.length ?? 0)
          }
          initialSelectedCities={
            cityDistribution.selected_cities || cityDistribution.base_cities || []
          }
          initialDistribution={cityDistribution.day_distribution || {}}
          onSubmit={handleCityDistributionSubmit}
        />
      )}
      {needsDestination && (
        <AskDestinationModal onSubmit={handleDestinationSubmit} />
      )}
      {showAddDayTrip && (
        <AddDayTripModal
          mainCity={mainCityFromProfile}
          mainCountry={mainCountryFromProfile}
          excludeCities={[
            mainCityFromProfile,
            ...new Set(
              (trip?.day_plans || [])
                .map((dp) => dp.city)
                .filter(Boolean),
            ),
          ]}
          dayPlans={trip?.day_plans || []}
          numDays={trip?.num_days || (trip?.day_plans?.length ?? 0)}
          onSubmit={handleAddDayTrip}
          onClose={() => setShowAddDayTrip(false)}
        />
      )}
      {buildErrorMsg && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 space-y-5 border-2 border-red-200">
            <div className="text-center">
              <div className="text-4xl mb-2">⚠️</div>
              <h3 className="text-xl font-bold text-gray-900">
                Não conseguimos gerar seu roteiro
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                O servidor tentou mas não terminou a tempo.
              </p>
            </div>
            <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-xs text-red-900">
              <p className="font-mono break-words leading-relaxed">{buildErrorMsg}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Seus links e o perfil ficaram salvos. Você pode tentar de novo
              agora (costuma funcionar na 2ª tentativa — os conteúdos dos
              vídeos já estão em cache), ou voltar depois.
            </p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  try {
                    const rails = trip?.id;
                    if (rails) {
                      const profile = {
                        ...(trip?.traveler_profile || {}),
                      };
                      delete profile.build_error;
                      await updateProfile(profile, "confirm");
                    }
                  } catch {}
                  await retryBuild();
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-md transition"
              >
                🔁 Tentar de novo
              </button>
              <Link
                to="/dashboard"
                className="px-4 py-2.5 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold transition flex items-center"
              >
                Voltar
              </Link>
            </div>
          </div>
        </div>
      )}
      {/* Trip header — name + num_days are inline-editable so the user
          can rename the project or adjust duration without leaving this
          page. Adding more links uses the LinkInput below the header. */}
      <div className="px-4 py-4 border-b border-gray-200 flex items-start gap-4">
        <Link to="/dashboard" className="text-gray-500 hover:text-gray-900 transition-colors mt-1 flex-shrink-0">
          {t("tripDetail.back")}
        </Link>
        <div className="flex-1 min-w-0">
          <EditableTripHeader
            name={trip.name}
            numDays={trip.num_days}
            isStaging={trip.is_staging}
            onSave={handleSaveTripMeta}
          />
          {trip.destination && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              📍 {trip.destination}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* AI Assist button moved out of the header into the AiAssistBanner
              that lives between the link input and the days list — that's
              where the user is asking "what now?" after pasting videos. */}
          <button
            onClick={() => setShowShareModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:text-gray-900 hover:border-gray-400 transition-colors"
            title={t("tripDetail.share") || "Share"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            <span className="hidden sm:inline">{lang === "pt-BR" ? "Compartilhar" : "Share"}</span>
          </button>
          <button
            onClick={() => setShowPDFExport(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-coral-500 hover:bg-coral-600 text-white text-sm font-semibold transition-colors"
            title="PDF"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/>
            </svg>
            <span className="hidden sm:inline">PDF</span>
          </button>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="px-4 border-b border-gray-200">
        <div className="flex gap-1 overflow-x-auto">
          {["itinerary", "flights", "notes"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-coral-500 text-coral-600"
                  : "border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-500"
              }`}
            >
              {t(`logistics.tabs.${tab}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Logistics panels (non-itinerary tabs) */}
      {activeTab !== "itinerary" && (
        <div className="max-w-3xl mx-auto p-4">
          {activeTab === "flights" && <FlightPanel tripId={trip.id} flights={trip.flights || []} />}
          {activeTab === "notes" && <NotePanel tripId={trip.id} notes={trip.trip_notes || []} />}
        </div>
      )}

      {/* Main content: itinerary + map */}
      {activeTab === "itinerary" && <div className="flex flex-col lg:flex-row">
        {/* Left panel: itinerary (rolls with the page, no inner scroll) */}
        <div className="w-full lg:w-3/5 p-4">
          {/* Link input section — works at any time, even after the trip
              has been built. Adding a new link triggers extraction on
              that link only; the user can then drag the new places onto
              days (manual mode) or run AI Assist again. */}
          <div className="mb-4">
            <div className="flex items-baseline justify-between mb-1.5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                {lang === "pt-BR" ? "Links de inspiração" : "Inspiration links"}
              </h2>
              {trip.links && trip.links.length > 0 && (
                <span className="text-[11px] text-gray-400 tabular-nums">
                  {trip.links.length}{" "}
                  {lang === "pt-BR"
                    ? trip.links.length === 1 ? "link" : "links"
                    : trip.links.length === 1 ? "link" : "links"}
                </span>
              )}
            </div>
            <LinkInput onSubmit={(url) => addLink(url)} />
            {trip.links && trip.links.length > 0 && (
              <LinkList links={trip.links} onDelete={(linkId) => removeLink(linkId)} />
            )}
          </div>

          {/* AI Assist banner — sits between the link input and the days
              list precisely because that's where the user is asking
              "what now?" after pasting links. Hidden when items already
              exist (would duplicate) or when there's nothing extracted
              for the AI to work with. */}
          {showAiAssistButton && (
            <AiAssistBanner
              running={aiAssistRunning}
              onAssist={handleAiAssist}
              totalPlaces={(trip?.traveler_profile?.places_mentioned || []).length}
              placedCount={placedCount}
              emptyDayCount={emptyDayCount}
            />
          )}

          {/* Processing status feedback */}
          <ProcessingStatus trip={trip} />

          {/* Traveler profile card — always shown when a profile exists.
              Phase 3 of the deferred-extraction redesign: the modal
              confirm/reject UI was replaced with an editable inline card
              the user can open whenever they want to adjust prefs. */}
          {trip.traveler_profile && (
            <TravelerProfileCard
              profile={trip.traveler_profile}
              numDays={trip.num_days}
              onSave={(p) => updateProfile(p, "confirm")}
            />
          )}

          {/* Vibe tag filter */}
          <VibeTagFilter
            activeFilters={vibeFilters}
            availableTags={availableVibeTags}
            onToggle={(tag) => {
              if (tag === null) {
                setVibeFilters([]);
              } else {
                setVibeFilters((prev) =>
                  prev.includes(tag) ? prev.filter((f) => f !== tag) : [...prev, tag]
                );
              }
            }}
          />

          {/* City pills bar — main city + day-trips with add/remove */}
          <CityTabs
            dayPlans={trip.day_plans || []}
            activeCity={activeCity}
            onCityChange={setActiveCity}
            mainCity={mainCityFromProfile}
            onAddDayTrip={() => setShowAddDayTrip(true)}
            onRemoveDayTrip={handleRemoveDayTrip}
          />

          {/* View toggle. Routing + experiences used to live here as
              buttons, but the user asked for those to be automatic
              (zero clicks). Now they run during trip creation AND, for
              trips built before those features existed, silently on
              first mount via the useEffect below.
              In manual mode the toggle is hidden — list view is forced
              so the ExtractedPlacesPanel's drag-and-drop works (timeline
              view has its own DragDropContext that we can't share). */}
          {!isManualMode && (
            <div className="flex justify-end items-center gap-3 mb-4">
              <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
                <button
                  onClick={() => switchView("timeline")}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
                    viewMode === "timeline"
                      ? "bg-emerald-500 text-white shadow"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  ✨ Timeline
                </button>
                <button
                  onClick={() => switchView("list")}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
                    viewMode === "list"
                      ? "bg-emerald-500 text-white shadow"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  ☰ Lista
                </button>
              </div>
            </div>
          )}

          {/* Phase 5.4 — surface any pending conflict_alerts (from refine
              steps) so the user can confirm keep/replace/remove for items
              that came from their videos. Re-polled whenever `refining`
              transitions false→true→false. */}
          <ConflictsBanner tripId={id} refreshKey={refining ? 1 : 0} />

          {/* Post-build validation report (STEPs 6-9 of the planning spec).
              Shows only when the validator dropped destination-as-activity
              items, injected transfer days, or flagged thin days. */}
          <ValidationReportBanner
            report={trip?.traveler_profile?.validation_report}
          />

          {/* Trip-level AI feedback */}
          {trip.day_plans?.some((dp) => dp.itinerary_items?.length > 0) && (
            <div className="mb-4">
              <FeedbackBox
                alwaysOpen
                loading={refining}
                placeholder={t("feedback.placeholderTrip")}
                onSubmit={(feedback) => refineItinerary(feedback, "trip")}
              />
            </div>
          )}

          {/* Day plans — Timeline carousel OR classic list. Manual mode
              forces list view because the ExtractedPlacesPanel below shares
              the list view's DragDropContext (timeline owns its own). */}
          {(!isManualMode && viewMode === "timeline") ? (
            <TripTimeline
              dayPlans={(activeCity
                ? trip.day_plans?.filter((dp) => dp.city === activeCity)
                : trip.day_plans) || []}
              onReorder={({ dayPlanId, itemIds }) =>
                reorderItems(dayPlanId, itemIds)
              }
              onMoveBetweenDays={({ sourceDayId, destDayId, itemId, destIndex }) =>
                moveItemBetweenDays(sourceDayId, destDayId, itemId, destIndex)
              }
              onItemClick={(itemId, dayPlanId) => {
                const dp = trip.day_plans?.find((d) => d.id === dayPlanId);
                const item = dp?.itinerary_items?.find((i) => i.id === itemId);
                if (item) handleItemClick(item);
              }}
              onDeleteItem={(itemId, dayPlanId) => removeItem(dayPlanId, itemId)}
              onSwapItem={(itemId, dayPlanId) => {
                const dp = trip.day_plans?.find((d) => d.id === dayPlanId);
                const item = dp?.itinerary_items?.find((i) => i.id === itemId);
                if (item) handleSwapItem(itemId, { dayPlanId });
              }}
            />
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
              <div className={isManualMode ? "grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4" : ""}>
                {isManualMode && (
                  <ExtractedPlacesPanel
                    trip={trip}
                    onPlaceClick={handlePlaceClick}
                    highlightedPlaceKey={highlightedPlaceKey}
                    hoveredPlaceKey={hoveredPlaceKey}
                    onPlaceHover={setHoveredPlaceKey}
                  />
                )}
                <Droppable droppableId="trip-days" type="day">
                  {(dropProvided) => (
                    <div
                      ref={dropProvided.innerRef}
                      {...dropProvided.droppableProps}
                      className="space-y-4"
                    >
                      {(activeCity
                        ? trip.day_plans?.filter((dp) => dp.city === activeCity)
                        : trip.day_plans
                      )?.map((dayPlan, dayIndex) => (
                        <Draggable
                          key={dayPlan.id}
                          draggableId={`day::${dayPlan.id}`}
                          index={dayIndex}
                          type="day"
                        >
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={
                                dragSnapshot.isDragging
                                  ? "ring-2 ring-coral-400 rounded-2xl"
                                  : ""
                              }
                            >
                              <DayPlanColumn
                                dayPlan={dayPlan}
                                tripId={trip.id}
                                selectedItemId={selectedItemId}
                                hoveredItemId={hoveredItemId}
                                vibeFilters={vibeFilters}
                                travelSegments={travelTimes[dayPlan.id] || []}
                                hotelLodging={(trip.lodgings || []).find(l => l.latitude && l.longitude) || null}
                                onItemClick={handleItemClick}
                                onItemHover={setHoveredItemId}
                                onAddClick={() => setShowSuggestions(dayPlan.id)}
                                onDeleteItem={(itemId) => removeItem(dayPlan.id, itemId)}
                                onSwapItem={handleSwapItem}
                                onSelectDay={() =>
                                  setSelectedDayNumber(
                                    selectedDayNumber === dayPlan.day_number ? null : dayPlan.day_number
                                  )
                                }
                                isSelectedDay={selectedDayNumber === dayPlan.day_number}
                                onRefine={(dayPlanId, feedback) => refineItinerary(feedback, "day", dayPlanId)}
                                refineLoading={refining}
                                onRecalculate={async () => {
                                  try {
                                    const data = await recalculateSchedule(trip.id, dayPlan.id);
                                    setSchedulePreview({ dayPlanId: dayPlan.id, proposals: data.proposals || [] });
                                  } catch { /* ignore */ }
                                }}
                                dayDragHandleProps={dragProvided.dragHandleProps}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {dropProvided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            </DragDropContext>
          )}
        </div>

        {/* Right panel: hotel input + map */}
        <div className="w-full lg:w-2/5 h-[400px] lg:h-[calc(100vh-80px)] lg:sticky lg:top-4 flex flex-col">
          <HotelMapInput
            lodgings={trip.lodgings || []}
            onLodgingCreated={addLodging}
            onLodgingRemoved={removeLodging}
          />
          <div className="flex-1 min-h-0">
            <TripMap
              dayPlans={trip.day_plans || []}
              selectedDayNumber={selectedDayNumber}
              selectedItemId={selectedItemId}
              hoveredItemId={hoveredItemId}
              onMarkerClick={handleMarkerClick}
              hotelLodgings={(trip.lodgings || []).filter(l => l.latitude && l.longitude)}
              unassignedPlaces={unassignedPlaces}
              onUnassignedPlaceClick={handlePlaceClick}
              highlightedUnassignedKey={highlightedPlaceKey}
              hoveredUnassignedKey={hoveredPlaceKey}
            />
          </div>
        </div>
      </div>}


      {/* Item detail slide-out (drawer on desktop, bottom sheet on mobile).
          enrichedPlace cross-references the item to its entry in the
          trip-level traveler_profile.places_mentioned, which carries
          editorial_summary + community_notes (aggregated from EVERY
          video that mentioned this place). The lookup matches on
          name (case-insensitive trim) — same dedup key used in the
          backend merge_link path. */}
      {expandedItem && (
        <ItemDetail
          item={expandedItem}
          tripId={trip.id}
          enrichedPlace={(() => {
            const target = (expandedItem.name || "").trim().toLowerCase();
            if (!target) return null;
            return (trip?.traveler_profile?.places_mentioned || []).find(
              (p) => (p.name || "").trim().toLowerCase() === target,
            ) || null;
          })()}
          onClose={() => {
            setExpandedItem(null);
            setSelectedItemId(null);
          }}
          onUpdate={async (data) => {
            const updated = await updateItem(expandedItem.day_plan_id, expandedItem.id, data);
            setExpandedItem(updated);
          }}
          onDelete={async () => {
            await removeItem(expandedItem.day_plan_id, expandedItem.id);
            setExpandedItem(null);
            setSelectedItemId(null);
          }}
          onAddNearby={async (data) => {
            await addItem(expandedItem.day_plan_id, data);
          }}
        />
      )}

      {/* Schedule recalculation preview */}
      {schedulePreview && (
        <SchedulePreview
          proposals={schedulePreview.proposals}
          onClose={() => setSchedulePreview(null)}
          onApply={async (proposals) => {
            for (const p of proposals) {
              if (p.current_time_slot !== p.suggested_time_slot) {
                await updateItem(schedulePreview.dayPlanId, p.item_id, {
                  time_slot: p.suggested_time_slot,
                });
              }
            }
            setSchedulePreview(null);
          }}
        />
      )}

      {/* Smart suggestions modal */}
      {showSuggestions && (
        <PlaceSuggestions
          tripId={trip.id}
          dayPlanId={showSuggestions}
          onAdd={async (data) => {
            await addItem(showSuggestions, data);
          }}
          onManualAdd={() => {
            const dayPlanId = showSuggestions;
            setShowSuggestions(null);
            setShowItemForm(dayPlanId);
          }}
          onClose={() => setShowSuggestions(null)}
        />
      )}

      {/* Place detail modal — opened either by clicking a card in
          ExtractedPlacesPanel OR a pin on TripMap. The same modal is
          shared between both surfaces and offers quick "add to day X"
          buttons (when in manual mode and the place isn't already
          on a day). The polling refresh will update the cards/map
          afterward. */}
      {detailPlace && (
        <PlaceDetailModal
          place={detailPlace}
          onClose={closePlaceDetail}
          dayPlans={isManualMode ? (trip.day_plans || []) : null}
          onAddToDay={
            isManualMode
              ? (dayPlanId) => handleAddPlaceToDay(detailPlace, dayPlanId)
              : null
          }
          alreadyOnDayId={(() => {
            const target = (detailPlace.name || "").trim().toLowerCase();
            const owner = (trip.day_plans || []).find((dp) =>
              (dp.itinerary_items || []).some(
                (i) => (i.name || "").trim().toLowerCase() === target,
              ),
            );
            return owner?.id || null;
          })()}
        />
      )}

      {/* Add item modal (manual) */}
      {showItemForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-sm w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">{t("tripDetail.addItem")}</h2>
              <button
                onClick={() => setShowItemForm(null)}
                className="text-gray-500 hover:text-gray-900"
              >
                ✕
              </button>
            </div>
            <ItemForm
              onSubmit={(data) => handleAddItem(showItemForm, data)}
              onCancel={() => setShowItemForm(null)}
            />
          </div>
        </div>
      )}

      {/* PDF Export modal */}
      {showPDFExport && (
        <TripPDFExport trip={trip} onClose={() => setShowPDFExport(false)} />
      )}

      {/* Share modal */}
      {showShareModal && (
        <TripShareModal trip={trip} onClose={() => setShowShareModal(false)} />
      )}

      {/* Geo review modal — shown once when link-sourced places were
          flagged by the backend as too far from the rest of their day.
          The user decides keep or remove (we never drop silently). */}
      {!geoModalDismissed && collectFlaggedItems(trip.day_plans).length > 0 && (
        <GeoReviewModal
          trip={trip}
          pt={lang === "pt-BR"}
          onClose={() => setGeoModalDismissed(true)}
          onReload={async () => {
            if (fetchTrip) await fetchTrip();
          }}
        />
      )}
    </div>
  );
}
