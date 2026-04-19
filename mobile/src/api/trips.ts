import { api } from './client';

export interface Trip {
  id: number;
  title: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  num_days: number;
  cover_photo_url?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DayPlan {
  id: number;
  trip_id: number;
  day_number: number;
  date: string | null;
  title?: string | null;
  summary?: string | null;
  items?: ItineraryItem[];
}

export interface ItineraryItem {
  id: number;
  day_plan_id: number;
  title: string;
  category?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_place_id?: string | null;
  notes?: string | null;
  photo_url?: string | null;
  rating?: number | null;
  website?: string | null;
  order: number;
}

export const tripsApi = {
  list: () => api.get<{ trips: Trip[] }>('/trips'),

  get: (id: number) =>
    api.get<{ trip: Trip; day_plans: DayPlan[] }>(`/trips/${id}`),

  create: (data: {
    title: string;
    destination: string;
    num_days: number;
    start_date?: string;
    end_date?: string;
  }) => api.post<{ trip: Trip }>('/trips', { trip: data }),

  update: (id: number, data: Partial<Trip>) =>
    api.patch<{ trip: Trip }>(`/trips/${id}`, { trip: data }),

  delete: (id: number) => api.delete<{ success: boolean }>(`/trips/${id}`),

  generate: (id: number, profile?: any) =>
    api.ai.post<{ ok: boolean }>('/generate-itinerary', {
      trip_id: id,
      profile,
    }),

  analyzeUrl: (urls: string[]) =>
    api.ai.post<{
      places: any[];
      destination: string;
      summary: string;
      error?: string;
    }>('/analyze-url', { urls }),
};
