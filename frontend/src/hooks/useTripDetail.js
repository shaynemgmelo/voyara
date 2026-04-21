import { useState, useEffect, useCallback, useRef } from "react";
import * as tripsApi from "../api/trips";
import * as itemsApi from "../api/itineraryItems";
import * as linksApi from "../api/links";
import * as logisticsApi from "../api/logistics";
import { resumeProcessing, analyzeTrip } from "../api/links";
import { refineItinerary as refineApi } from "../api/trips";
import { fetchBuildStatus } from "../api/buildStatus";

const POLL_INTERVAL = 5000; // 5 seconds

export default function useTripDetail(tripId) {
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refining, setRefining] = useState(false);
  const pollRef = useRef(null);
  const analyzeRetried = useRef(false);
  // Auto-retry for Phase 2 (itinerary build). We stamp the time we first saw
  // `profile_status === "confirmed" && hasItems === false` and if that state
  // persists for more than RETRY_BUILD_AFTER_MS, we call resumeProcessing
  // again. One retry per trip per page-load.
  const buildStuckSinceRef = useRef(null);
  const buildRetried = useRef(false);
  const RETRY_BUILD_AFTER_MS = 90_000;
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
    const hasItems = trip.day_plans?.some((dp) => dp.itinerary_items?.length > 0);
    if (trip.profile_status === "confirmed" && hasExtractedLinks && !hasItems) return true;

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
      const t = trip;
      if (
        t
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
          const generating =
            data.profile_status === "confirmed" && hasExtracted && !hasItems;
          if (generating) {
            if (!buildStuckSinceRef.current) {
              buildStuckSinceRef.current = Date.now();
            }
            const stuckFor = Date.now() - buildStuckSinceRef.current;

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
          }

          const keepPolling = hasActive
            || (hasExtracted && !profileDone)
            || (data.profile_status === "confirmed" && hasExtracted && !hasItems);
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
    const updated = await tripsApi.updateTrip(tripId, {
      traveler_profile: profileData,
      profile_status: status,
    });
    setTrip((prev) => ({
      ...prev,
      traveler_profile: updated.traveler_profile,
      profile_status: updated.profile_status,
    }));

    // Resume processing: trigger ONE itinerary build for the whole trip
    // Only need to call once — the AI service builds a unified itinerary for all links
    if (status === "confirmed") {
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
  // inside GenerationProgressModal. Resets the stuck timer so the user
  // doesn't hit the escape card again immediately.
  const retryBuild = useCallback(async () => {
    const anyLink = trip?.links?.[0];
    if (!anyLink) {
      window.location.reload();
      return;
    }
    buildStuckSinceRef.current = null;
    buildRetried.current = false;
    try {
      await resumeProcessing(anyLink.id, tripId);
    } catch {
      // If the server is genuinely down, a reload is the next-best escape.
      window.location.reload();
    }
    await fetchTrip();
  }, [trip, tripId, fetchTrip]);

  return {
    trip,
    loading,
    error,
    refining,
    fetchTrip,
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
    retryBuild,
    addLodging,
    removeLodging,
  };
}
