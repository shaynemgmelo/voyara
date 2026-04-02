import { useState, useEffect, useCallback } from "react";
import * as tripsApi from "../api/trips";

export default function useTrips() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchTrips = useCallback(async (status) => {
    setLoading(true);
    setError(null);
    try {
      const data = await tripsApi.getTrips(status);
      setTrips(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  const createTrip = async (data) => {
    const trip = await tripsApi.createTrip(data);
    setTrips((prev) => [...prev, trip]);
    return trip;
  };

  const deleteTrip = async (id) => {
    await tripsApi.deleteTrip(id);
    setTrips((prev) => prev.filter((t) => t.id !== id));
  };

  return { trips, loading, error, fetchTrips, createTrip, deleteTrip };
}
