import { useState, useEffect, useCallback, useRef } from "react";
import * as tripsApi from "../api/trips";
import * as itemsApi from "../api/itineraryItems";
import * as linksApi from "../api/links";
import * as logisticsApi from "../api/logistics";
import { reorderDayPlans as reorderDayPlansApi } from "../api/dayPlans";
import { resumeProcessing, analyzeTrip } from "../api/links";
import { refineItinerary as refineApi } from "../api/trips";
import { fetchBuildStatus, clearStuckBuild } from "../api/buildStatus";

const POLL_INTERVAL = 5000; // 5 seconds

export default function useTripDetail(tripId) {
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refining, setRefining] = useState(false);
  // Client-side hard failure. When generation has been running for more
  // than CLIENT_FAILURE_AFTER_MS and the backend still hasn't either
  // delivered items OR persisted a build_error, we forcibly transition
  // into a failure state so the user isn't stranded on 95 %. If the
  // backend DOES finish later, polling picks it up and the items still
  // land — this flag only controls the modal.
  const [clientForcedFailure, setClientForcedFailure] = useState(false);
  const pollRef = useRef(null);
  const analyzeRetried = useRef(false);
  // Auto-retry for Phase 2 (itinerary build). We stamp the time we first saw
  // `profile_status === "confirmed" && hasItems === false` and if that state
  // persists for more than RETRY_BUILD_AFTER_MS, we call resumeProcessing
  // again. One retry per trip per page-load.
  const buildStuckSinceRef = useRef(null);
  const buildRetried = useRef(false);
  const RETRY_BUILD_AFTER_MS = 90_000;
  // Absolute ceiling for how long we're willing to show the progress modal.
  // The new combined pipeline (extract + profile + build) has a 350s backend
  // budget — 400s on the client gives a 50s grace window for polling delays
  // and the backend's build_error persistence step. Worst case the user
  // sees the failure modal at 400s with a "Tentar de novo" button.
  // Scales with trip length. Backend budget is now 180s + 20s/day, clamped
  // [240s, 500s] — it went up because the structured classifier feeds
  // Sonnet a much richer prompt now. Client cap gives a ~60s grace window.
  // For a 15-day trip: backend caps at 480s, client forces failure at 540s.
  // For a 5-day trip: backend 280s, client ~340s.
  const tripDays = Math.max(1, trip?.num_days || 5);
  const CLIENT_FAILURE_AFTER_MS = Math.min(
    560_000,
    Math.max(240_000, (180 + 20 * tripDays + 60) * 1000),
  );
  // Browser-notification bookkeeping — we fire at most one "ready" push per
  // page-load so the user gets pinged even when the tab is in the background.
  const wasGeneratingRef = useRef(false);
  const readyNotifiedRef = useRef(false);

  const fetchTrip = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await tripsApi.getTrip(tripId);
      setTrip(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  // Check if we should keep polling:
  // - Links still being processed (pending/processing)
  // - Links extracted but profile not yet generated (waiting for Phase 1)
  // - Profile confirmed but itinerary not yet generated (waiting for Phase 2)
  const shouldPoll = useCallback(() => {
    if (!trip?.links || trip.links.length === 0) return false;
    const hasActiveLinks = trip.links.some(
      (l) => l.status === "pending" || l.status === "processing"
    );
    if (hasActiveLinks) return true;

    // All links extracted but profile analysis still pending?
    const hasExtractedLinks = trip.links.some((l) => l.status === "extracted");
    const profileReady = trip.profile_status === "suggested" || trip.profile_status === "confirmed" || trip.profile_status === "rejected";
    if (hasExtractedLinks && !profileReady) return true;

    // Profile confirmed but itinerary not generated yet? (Phase 2 in progress)
    // STOP polling if any of the following hold — they're all "waiting on
    // the user, not on the backend" terminal states:
    //   - build_error persisted by the backend                     (failure)
    //   - traveler_profile.needs_destination flagged + no dest set (Phase 4 modal)
    //   - ai_mode === "manual" (user is expected to drag items)
    // For everything else, keep polling so the modal closes the moment
    // items appear or build_error surfaces.
    const hasItems = trip.day_plans?.some((dp) => dp.itinerary_items?.length > 0);
    const hasBuildError = Boolean(trip?.traveler_profile?.build_error);
    const needsDestination =
      trip?.traveler_profile?.needs_destination === true
      && !(trip?.destination || "").trim();
    const isManual = trip.ai_mode === "manual";
    if (
      trip.profile_status === "confirmed"
      && hasExtractedLinks
      && !hasItems
      && !hasBuildError
      && !needsDestination
      && !isManual
    ) {
      return true;
    }

    // Refining in progress — poll for updated items
    if (refining) return true;

    return false;
  }, [trip, refining]);

  // Background-tab friendly:
  //   - Browsers throttle setInterval in background tabs (typically ~1/s
  //     minimum, sometimes 1/min), so polling keeps going but may feel slow.
  //   - The server build is a FastAPI BackgroundTask, fully independent of
  //     whether the tab is focused — closing the tab does NOT kill the build.
  //   - When the user returns to the tab we do an immediate fetch so the
  //     modal doesn't wait the full 5s poll to catch up.
  //   - When the build completes while the tab is backgrounded we fire a
  //     browser notification (with user permission) so they get pinged.
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible" || !tripId) return;
      // Refetch immediately so the user sees current trip state.
      await fetchTrip();
      // If we're in generating phase, also probe the AI service to see if
      // the build is really still running — if it died while the tab was
      // backgrounded, retry IMMEDIATELY instead of waiting for the timer.
      // Manual mode is a TERMINAL state by user choice — no auto-retry,
      // no auto-build. The "Assistência IA" button is the only way to
      // trigger an AI build for a manual trip. Trip 40 surfaced this
      // bug: the visibility handler kept calling resumeProcessing even
      // though the user picked manual, and the AI silently rebuilt the
      // whole itinerary.
      const t = trip;
      const tIsManual = t?.ai_mode === "manual";
      if (
        t
        && !tIsManual
        && t.profile_status === "confirmed"
        && t.links?.some((l) => l.status === "extracted")
        && !t.day_plans?.some((dp) => dp.itinerary_items?.length > 0)
      ) {
        try {
          const status = await fetchBuildStatus(tripId);
          if (!status.active && !buildRetried.current) {
            buildRetried.current = true;
            const anyLink = t.links?.[0];
            if (anyLink) {
              try {
                await resumeProcessing(anyLink.id, tripId);
              } catch {
                buildRetried.current = false;
              }
            }
          }
        } catch {
          // ignore probe errors
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [tripId, fetchTrip, trip]);

  // Ask for notification permission the first time we see the build phase.
  // Quiet failure — declined permission just means no background ping.
  useEffect(() => {
    if (!trip || typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return;
    const generating =
      trip.profile_status === "confirmed"
      && trip.links?.some((l) => l.status === "extracted")
      && !trip.day_plans?.some((dp) => dp.itinerary_items?.length > 0);
    if (generating) {
      Notification.requestPermission().catch(() => {});
    }
  }, [trip]);

  // Fire a "trip ready" notification when items appear. Only once per load,
  // and only if the user had been waiting (so a simple visit to a completed
  // trip doesn't ping them).
  useEffect(() => {
    if (!trip || typeof Notification === "undefined") return;
    const generating =
      trip.profile_status === "confirmed"
      && trip.links?.some((l) => l.status === "extracted")
      && !trip.day_plans?.some((dp) => dp.itinerary_items?.length > 0);
    const hasItems = trip.day_plans?.some((dp) => dp.itinerary_items?.length > 0);

    if (generating) wasGeneratingRef.current = true;
    if (
      wasGeneratingRef.current
      && hasItems
      && !readyNotifiedRef.current
      && Notification.permission === "granted"
      && document.visibilityState !== "visible"
    ) {
      readyNotifiedRef.current = true;
      try {
        const notif = new Notification("Roteiro pronto ✈️", {
          body: `Seu roteiro para ${trip.destination || "sua viagem"} está pronto!`,
          tag: `trip-${trip.id}`,
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch {
        // Notification constructor can throw on some browsers — no-op fallback.
      }
    }
  }, [trip]);

  // Poll for updates when links are being processed or itinerary is being built
  useEffect(() => {
    if (shouldPoll()) {
      pollRef.current = setInterval(async () => {
        try {
          const data = await tripsApi.getTrip(tripId);
          setTrip(data);
          // Stop polling if nothing left to wait for
          const hasActive = data.links?.some(
            (l) => l.status === "pending" || l.status === "processing"
          );
          const hasExtracted = data.links?.some((l) => l.status === "extracted");
          const profileDone = data.profile_status === "suggested" || data.profile_status === "confirmed" || data.profile_status === "rejected";
          const hasItems = data.day_plans?.some((dp) => dp.itinerary_items?.length > 0);
          // Auto-retry analyze-trip if stuck: all links extracted but profile never arrived
          if (hasExtracted && !profileDone && !hasActive && !analyzeRetried.current) {
            analyzeRetried.current = true;
            try {
              await analyzeTrip(tripId);
            } catch {
              // Will retry on next poll cycle
              analyzeRetried.current = false;
            }
          }

          // Auto-retry itinerary build if stuck at "generating".
          // Heuristics:
          //   - First check: after 30s in "generating", ask the AI service
          //     directly if a build is active. If it says active=false,
          //     retry IMMEDIATELY (no need to wait 90s — the worker already
          //     died silently).
          //   - Otherwise, fall back to the 90s timer as a safety net.
          //   - Hard ceiling: at 180s we FORCE the UI into failure state
          //     so the user sees a retry button even if the backend is
          //     still silently grinding or dead.
          const hasBackendError = Boolean(data?.traveler_profile?.build_error);
          const dataNeedsDestination =
            data?.traveler_profile?.needs_destination === true
            && !(data?.destination || "").trim();
          const dataIsManual = data?.ai_mode === "manual";
          // "Generating" is the state where we're WAITING for the backend
          // to land items. Manual mode and needs_destination are user-action
          // terminal states — they get their own modals, not the progress one.
          const generating =
            data.profile_status === "confirmed" && hasExtracted && !hasItems
            && !hasBackendError && !dataNeedsDestination && !dataIsManual;
          if (generating) {
            if (!buildStuckSinceRef.current) {
              buildStuckSinceRef.current = Date.now();
            }
            const stuckFor = Date.now() - buildStuckSinceRef.current;

            // Client-side hard failure — never let the user sit on 95 %
            // for more than CLIENT_FAILURE_AFTER_MS. If the backend
            // eventually succeeds, polling will pick up the items and
            // the UI transitions back to success on its own.
            if (stuckFor > CLIENT_FAILURE_AFTER_MS && !clientForcedFailure) {
              setClientForcedFailure(true);
            }

            // Fast retry path: after 30s, ask the AI service. Retry ONLY
            // if the server says there's no active build AND (was_stale
            // OR the poll-side heuristic agrees nothing's alive). This
            // avoids the race where auto-retry kicks while a build is
            // genuinely mid-flight.
            if (stuckFor > 30_000 && !buildRetried.current) {
              try {
                const status = await fetchBuildStatus(tripId);
                if (!status.active) {
                  buildRetried.current = true;
                  const anyLink = data.links?.[0];
                  if (anyLink) {
                    try {
                      const resp = await resumeProcessing(anyLink.id, tripId);
                      // If the server actually already has a build running
                      // (status=already_running), reset our retry flag so
                      // the safety-net timer can try again later.
                      if (resp?.status === "already_running") {
                        buildRetried.current = false;
                        buildStuckSinceRef.current = Date.now();
                      }
                    } catch {
                      buildRetried.current = false;
                    }
                  }
                }
              } catch {
                // Ignore probe errors; fall through to the time-based retry.
              }
            }

            // Safety-net timer — fires even if the AI service /build-status
            // probe failed or kept saying active=true but nothing progressed.
            if (
              stuckFor > RETRY_BUILD_AFTER_MS
              && !buildRetried.current
            ) {
              buildRetried.current = true;
              const anyLink = data.links?.[0];
              if (anyLink) {
                try {
                  await resumeProcessing(anyLink.id, tripId);
                } catch {
                  buildRetried.current = false;
                }
              }
            }
          } else {
            buildStuckSinceRef.current = null;
            if (hasItems && clientForcedFailure) {
              // Backend quietly succeeded after we flipped into forced
              // failure — un-flip so the trip becomes visible again.
              setClientForcedFailure(false);
            }
          }

          const keepPolling = hasActive
            || (hasExtracted && !profileDone)
            || (data.profile_status === "confirmed" && hasExtracted && !hasItems
                && !dataNeedsDestination && !dataIsManual);
          if (!keepPolling && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch {
          // Silently ignore polling errors
        }
      }, POLL_INTERVAL);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [shouldPoll, tripId]);

  useEffect(() => {
    analyzeRetried.current = false;
    if (tripId) fetchTrip();
  }, [tripId, fetchTrip]);

  const addItem = async (dayPlanId, itemData) => {
    const item = await itemsApi.createItem(tripId, dayPlanId, itemData);
    setTrip((prev) => ({
      ...prev,
      day_plans: prev.day_plans.map((dp) =>
        dp.id === dayPlanId
          ? { ...dp, itinerary_items: [...dp.itinerary_items, item] }
          : dp
      ),
    }));
    return item;
  };

  const updateItem = async (dayPlanId, itemId, data) => {
    const item = await itemsApi.updateItem(tripId, dayPlanId, itemId, data);
    setTrip((prev) => ({
      ...prev,
      day_plans: prev.day_plans.map((dp) =>
        dp.id === dayPlanId
          ? {
              ...dp,
              itinerary_items: dp.itinerary_items.map((i) =>
                i.id === itemId ? item : i
              ),
            }
          : dp
      ),
    }));
    return item;
  };

  const removeItem = async (dayPlanId, itemId) => {
    await itemsApi.deleteItem(tripId, dayPlanId, itemId);
    setTrip((prev) => ({
      ...prev,
      day_plans: prev.day_plans.map((dp) =>
        dp.id === dayPlanId
          ? {
              ...dp,
              itinerary_items: dp.itinerary_items.filter((i) => i.id !== itemId),
            }
          : dp
      ),
    }));
  };

  const reorderItems = async (dayPlanId, itemIds) => {
    // Default rhythm — reassigned by POSITION so the card at position 0
    // always shows morning (10:00) even after the user drags a different
    // item into slot 0. Matches the backend's _optimize_day_proximity.
    const slotByPosition = ["10:00", "12:30", "14:30", "16:30", "19:00"];

    // Optimistic update: new order + fresh time_slots + fresh positions.
    setTrip((prev) => ({
      ...prev,
      day_plans: prev.day_plans.map((dp) => {
        if (dp.id !== dayPlanId) return dp;
        const ordered = itemIds.map((id, idx) => {
          const item = dp.itinerary_items.find((i) => i.id === id);
          if (!item) return null;
          const next = { ...item, position: idx };
          if (idx < slotByPosition.length) next.time_slot = slotByPosition[idx];
          return next;
        }).filter(Boolean);
        return { ...dp, itinerary_items: ordered };
      }),
    }));

    try {
      // Persist the new order (updates `position` on each item).
      await itemsApi.reorderItems(tripId, dayPlanId, itemIds);
      // Persist the fresh time_slots in parallel so the map + the list
      // reflect the new rhythm. Each PATCH is fire-and-forget for the UI
      // because we already did the optimistic update above.
      await Promise.all(
        itemIds.slice(0, slotByPosition.length).map((id, idx) =>
          itemsApi
            .updateItem(tripId, dayPlanId, id, { time_slot: slotByPosition[idx] })
            .catch(() => null)
        )
      );
    } catch {
      fetchTrip(); // rollback
    }
  };

  const moveItemBetweenDays = async (
    sourceDayId,
    destDayId,
    itemId,
    destIndex
  ) => {
    const slotByPosition = ["10:00", "12:30", "14:30", "16:30", "19:00"];
    const reassignSlots = (items) =>
      items.map((it, idx) =>
        idx < slotByPosition.length
          ? { ...it, time_slot: slotByPosition[idx] }
          : it
      );

    // Optimistic update — moves the item AND reassigns time_slots on both
    // days so the rhythm 10:00/12:30/14:30/16:30/19:00 stays intact.
    setTrip((prev) => {
      const newDayPlans = prev.day_plans.map((dp) => ({
        ...dp,
        itinerary_items: [...dp.itinerary_items],
      }));

      const sourceDp = newDayPlans.find((dp) => dp.id === sourceDayId);
      const destDp = newDayPlans.find((dp) => dp.id === destDayId);
      const itemIndex = sourceDp.itinerary_items.findIndex(
        (i) => i.id === itemId
      );
      const [item] = sourceDp.itinerary_items.splice(itemIndex, 1);
      item.day_plan_id = destDayId;
      destDp.itinerary_items.splice(destIndex, 0, item);

      sourceDp.itinerary_items = reassignSlots(sourceDp.itinerary_items);
      destDp.itinerary_items = reassignSlots(destDp.itinerary_items);

      return { ...prev, day_plans: newDayPlans };
    });

    try {
      await itemsApi.moveItem(tripId, sourceDayId, itemId, destDayId, destIndex);
      // Persist fresh time_slots on both days.
      const after = await tripsApi.getTrip(tripId);
      const touchedDays = [sourceDayId, destDayId];
      for (const dayId of touchedDays) {
        const dp = after.day_plans?.find((d) => d.id === dayId);
        if (!dp) continue;
        await Promise.all(
          (dp.itinerary_items || []).slice(0, slotByPosition.length).map(
            (it, idx) =>
              itemsApi
                .updateItem(tripId, dayId, it.id, { time_slot: slotByPosition[idx] })
                .catch(() => null)
          )
        );
      }
    } catch {
      fetchTrip(); // rollback
    }
  };

  const addLink = async (url) => {
    const link = await linksApi.createLink(tripId, url);
    setTrip((prev) => ({
      ...prev,
      links: [...(prev.links || []), link],
    }));
    return link;
  };

  const removeLink = async (linkId) => {
    await linksApi.deleteLink(tripId, linkId);
    setTrip((prev) => ({
      ...prev,
      links: prev.links.filter((l) => l.id !== linkId),
    }));
  };

  const updateAiMode = async (mode) => {
    const updated = await tripsApi.updateTrip(tripId, { ai_mode: mode });
    setTrip((prev) => ({ ...prev, ai_mode: updated.ai_mode }));
  };

  const refineItinerary = async (feedback, scope = "trip", dayPlanId = null) => {
    setRefining(true);
    try {
      await refineApi(tripId, feedback, scope, dayPlanId);
      // Poll will pick up new items; auto-stop after ~30s or when items change
      const startItems = JSON.stringify(trip?.day_plans?.map((dp) => dp.itinerary_items?.map((i) => i.id)));
      let attempts = 0;
      const checkInterval = setInterval(async () => {
        attempts++;
        try {
          const data = await tripsApi.getTrip(tripId);
          setTrip(data);
          const currentItems = JSON.stringify(data?.day_plans?.map((dp) => dp.itinerary_items?.map((i) => i.id)));
          if (currentItems !== startItems || attempts > 12) {
            clearInterval(checkInterval);
            setRefining(false);
          }
        } catch {
          if (attempts > 12) {
            clearInterval(checkInterval);
            setRefining(false);
          }
        }
      }, 3000);
    } catch {
      setRefining(false);
    }
  };

  const updateProfile = async (profileData, action) => {
    const status = action === "reject" ? "rejected" : "confirmed";
    // CRITICAL: strip backend-managed fields before PATCHing. Trip 46
    // surfaced this — the frontend sent back a stale `places_mentioned`
    // (snapshot taken BEFORE backend enrichment finished) and clobbered
    // the freshly-geocoded data Rails had just received from the AI
    // service. Result: cards showed "no data", map pins disappeared.
    //
    // The frontend OWNS: travel_style, interests, pace, country_detected,
    // cities_detected, profile_description, main_destination,
    // needs_destination, and the *_en variants. Everything else is
    // computed by the AI pipeline and must NEVER round-trip through
    // a frontend PATCH.
    const FRONTEND_OWNED = new Set([
      "travel_style", "travel_style_en",
      "interests", "interests_en",
      "pace",
      "country_detected", "cities_detected",
      "profile_description", "profile_description_en",
      "main_destination", "needs_destination",
    ]);
    const safeProfile = Object.fromEntries(
      Object.entries(profileData || {}).filter(([k]) => FRONTEND_OWNED.has(k)),
    );
    const updated = await tripsApi.updateTrip(tripId, {
      traveler_profile: safeProfile,
      profile_status: status,
    });
    setTrip((prev) => ({
      ...prev,
      traveler_profile: updated.traveler_profile,
      profile_status: updated.profile_status,
    }));

    // Resume processing: trigger a build ONLY if the trip has no items yet
    // (user is in the initial flow and confirmed an empty profile). When the
    // trip already has items, this is just a profile edit from the inline
    // card — no rebuild, otherwise we'd duplicate every item. The user can
    // still use the explicit "refine" flow if they want a rebuild.
    // Manual mode NEVER auto-builds — the user must press "Assistência IA"
    // explicitly. Confirming the profile in manual just persists the
    // profile, doesn't generate items.
    const hasItems = trip?.day_plans?.some((dp) => dp.itinerary_items?.length > 0);
    const isManual = trip?.ai_mode === "manual";
    if (status === "confirmed" && !hasItems && !isManual) {
      const anyLink = trip?.links?.[0];
      if (anyLink) {
        try {
          await resumeProcessing(anyLink.id, tripId);
        } catch {
          // AI service will handle errors
        }
      }
    }
  };

  const addLodging = async (data) => {
    const lodging = await logisticsApi.createLodging(tripId, data);
    setTrip((prev) => ({
      ...prev,
      lodgings: [...(prev.lodgings || []), lodging].sort(
        (a, b) => (a.check_in_date || "").localeCompare(b.check_in_date || "")
      ),
    }));
    return lodging;
  };

  const removeLodging = async (lodgingId) => {
    await logisticsApi.deleteLodging(tripId, lodgingId);
    setTrip((prev) => ({
      ...prev,
      lodgings: (prev.lodgings || []).filter((l) => l.id !== lodgingId),
    }));
  };

  // Manual retry of the itinerary build — wired to the stuck-state button
  // inside GenerationProgressModal. FORCE-CLEARS any existing active_builds
  // entry on the server first so the dedup guard in resume-processing
  // doesn't refuse to restart. Resets the stuck timer so the user doesn't
  // hit the escape card again immediately.
  const retryBuild = useCallback(async () => {
    const anyLink = trip?.links?.[0];
    if (!anyLink) {
      window.location.reload();
      return;
    }
    buildStuckSinceRef.current = null;
    buildRetried.current = false;
    // Clear the client-side forced failure so the modal swaps back to
    // "Gerando roteiro" and the user sees the build actually running.
    setClientForcedFailure(false);
    // Step 1: punch through the dedup guard by clearing any stale/fresh
    // active entry. Safe — if there's no entry, the endpoint is a no-op.
    try {
      await clearStuckBuild(tripId);
    } catch {
      // ignore — worst case we get already_running from resume-processing
    }
    // Step 2: trigger a new build.
    try {
      await resumeProcessing(anyLink.id, tripId);
    } catch {
      // If the server is genuinely down, a reload is the next-best escape.
      window.location.reload();
    }
    await fetchTrip();
  }, [trip, tripId, fetchTrip]);

  // Ticker so the 180 s client failure threshold actually fires even if
  // polling stalls briefly. Runs only while we're waiting for items.
  useEffect(() => {
    if (clientForcedFailure) return;
    if (!trip) return;
    const waitingForItems =
      trip.profile_status === "confirmed"
      && trip.links?.some((l) => l.status === "extracted")
      && !trip.day_plans?.some((dp) => dp.itinerary_items?.length > 0)
      && !trip?.traveler_profile?.build_error;
    if (!waitingForItems) return;
    const id = setInterval(() => {
      if (!buildStuckSinceRef.current) return;
      const stuckFor = Date.now() - buildStuckSinceRef.current;
      if (stuckFor > CLIENT_FAILURE_AFTER_MS) {
        setClientForcedFailure(true);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [trip, clientForcedFailure]);

  // Reorder days within a trip. Takes the new ordered list of day_plan IDs
  // (e.g. user dragged Day 3 to slot 1 → [day3_id, day1_id, day2_id, ...]).
  // Optimistic: re-shuffles the local trip.day_plans + renumbers their
  // day_number client-side, then PATCHes the backend. Rolls back via
  // fetchTrip on failure.
  const reorderDays = async (orderedDayPlanIds) => {
    if (!Array.isArray(orderedDayPlanIds) || orderedDayPlanIds.length === 0) return;

    setTrip((prev) => {
      if (!prev?.day_plans) return prev;
      const byId = new Map(prev.day_plans.map((dp) => [dp.id, dp]));
      const reordered = orderedDayPlanIds
        .map((id, idx) => {
          const dp = byId.get(id);
          if (!dp) return null;
          return { ...dp, day_number: idx + 1 };
        })
        .filter(Boolean);
      return { ...prev, day_plans: reordered };
    });

    try {
      await reorderDayPlansApi(tripId, orderedDayPlanIds);
    } catch {
      fetchTrip(); // rollback
    }
  };

  return {
    trip,
    loading,
    error,
    refining,
    clientForcedFailure,
    fetchTrip,
    addItem,
    updateItem,
    removeItem,
    reorderItems,
    moveItemBetweenDays,
    reorderDays,
    addLink,
    removeLink,
    updateAiMode,
    updateProfile,
    refineItinerary,
    retryBuild,
    addLodging,
    removeLodging,
  };
}
