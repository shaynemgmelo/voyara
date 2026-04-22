import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { DragDropContext } from "@hello-pangea/dnd";
import useTripDetail from "../hooks/useTripDetail";
import DayPlanColumn from "../components/itinerary/DayPlanColumn";
import TripTimeline from "../components/itinerary/TripTimeline";
import GeoReviewModal, { collectFlaggedItems } from "../components/itinerary/GeoReviewModal";
import ItemDetail from "../components/itinerary/ItemDetail";
import ItemForm from "../components/itinerary/ItemForm";
import LinkInput from "../components/links/LinkInput";
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
import ExtractedPlacesPanel from "../components/trips/ExtractedPlacesPanel";
import { updateTrip, triggerBuild } from "../api/trips";
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

export default function TripDetail() {
  const { id } = useParams();
  const { t, lang } = useLanguage();
  const {
    trip,
    loading,
    error,
    addItem,
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
  // fire a background enrich + optimize once per session. Zero UI chrome —
  // the user just sees new cards appear naturally after the next poll tick.
  useEffect(() => {
    if (!trip || !id) return;
    if (autoEnrichedRef.current) return;
    if (pipelinePhase === "generating" || pipelinePhase === "analyzing") return;

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
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // Drag FROM the manual-mode extracted-places panel TO a day → create a
    // new itinerary_item on that day. The draggableId encodes the place name
    // ("extracted::<name>::<index>") since extracted places have no DB id yet.
    if (source.droppableId === ExtractedPlacesPanel.DROPPABLE_ID) {
      const destDayId = parseInt(destination.droppableId);
      if (Number.isNaN(destDayId)) return;
      // Format: "extracted::<name>::<index>"
      const parts = draggableId.split("::");
      const name = parts[1] || "";
      if (!name) return;
      // Reuse the source_url from the profile if we have it.
      const place = (trip?.traveler_profile?.places_mentioned || [])
        .find((p) => p.name === name);
      addItem(destDayId, {
        name,
        category: "attraction",
        source: "link",
        origin: "extracted_from_video",
        source_url: place?.source_url || null,
      });
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
  const isManualMode = trip?.ai_mode === "manual";

  return (
    <div className="max-w-[1600px] mx-auto pb-16">
      {showProgressModal && (
        <GenerationProgressModal
          phase={pipelinePhase}
          trip={trip}
          onRetry={retryBuild}
        />
      )}
      {needsDestination && (
        <AskDestinationModal onSubmit={handleDestinationSubmit} />
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
      {/* Trip header */}
      <div className="px-4 py-4 border-b border-gray-200 flex items-center gap-4">
        <Link to="/dashboard" className="text-gray-500 hover:text-gray-900 transition-colors">
          {t("tripDetail.back")}
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900">{trip.name}</h1>
          <p className="text-sm text-gray-500">
            {trip.destination}
            {trip.num_days && ` · ${trip.num_days} ${t("tripDetail.days")}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
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
          {/* Link input section */}
          <div className="mb-4">
            <LinkInput onSubmit={(url) => addLink(url)} />
            {trip.links && trip.links.length > 0 && (
              <LinkList links={trip.links} onDelete={(linkId) => removeLink(linkId)} />
            )}
          </div>

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

          {/* City tabs (only shown for multi-city trips) */}
          <CityTabs
            dayPlans={trip.day_plans || []}
            activeCity={activeCity}
            onCityChange={setActiveCity}
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
                  <ExtractedPlacesPanel trip={trip} />
                )}
                <div className="space-y-4">
              {(activeCity
                ? trip.day_plans?.filter((dp) => dp.city === activeCity)
                : trip.day_plans
              )?.map((dayPlan) => (
                <DayPlanColumn
                  key={dayPlan.id}
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
                />
              ))}
                </div>
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
            />
          </div>
        </div>
      </div>}


      {/* Item detail slide-out */}
      {expandedItem && (
        <ItemDetail
          item={expandedItem}
          tripId={trip.id}
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
