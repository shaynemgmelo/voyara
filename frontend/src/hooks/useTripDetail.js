import { useState, useEffect, useCallback, useRef } from "react";
import * as tripsApi from "../api/trips";
import * as itemsApi from "../api/itineraryItems";
import * as linksApi from "../api/links";
import * as logisticsApi from "../api/logistics";
import { resumeProcessing, analyzeTrip } from "../api/links";
import { refineItinerary as refineApi } from "../api/trips";

const POLL_INTERVAL = 5000; // 5 seconds

export default function useTripDetail(tripId) {
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refining, setRefining] = useState(false);
  const pollRef = useRef(null);
  const analyzeRetried = useRef(false);

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
    // Optimistic update
    setTrip((prev) => ({
      ...prev,
      day_plans: prev.day_plans.map((dp) => {
        if (dp.id !== dayPlanId) return dp;
        const ordered = itemIds.map((id) =>
          dp.itinerary_items.find((i) => i.id === id)
        );
        return { ...dp, itinerary_items: ordered };
      }),
    }));

    try {
      await itemsApi.reorderItems(tripId, dayPlanId, itemIds);
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
    // Optimistic update
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

      return { ...prev, day_plans: newDayPlans };
    });

    try {
      await itemsApi.moveItem(tripId, sourceDayId, itemId, destDayId, destIndex);
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
    addLodging,
    removeLodging,
  };
}
