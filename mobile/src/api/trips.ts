import { api } from './client';

/**
 * Trip — matches Rails TripSerializer.
 * Note: backend uses `name` (not `title`).
 */
export interface Trip {
  id: number;
  name: string;
  destination: string;
  num_days: number;
  status: string;
  ai_mode?: string;
  profile_status?: string | null;
  traveler_profile?: any;
  day_plans_count?: number;
  items_count?: number;
  links_count?: number;
  created_at: string;
  updated_at: string;
  // Detailed view
  day_plans?: DayPlan[];
  links?: any[];
  flights?: any[];
  lodgings?: any[];
  transports?: any[];
  trip_notes?: any[];
}

export interface DayPlan {
  id: number;
  day_number: number;
  date?: string | null;
  city?: string | null;
  itinerary_items?: ItineraryItem[];
}

export interface ItineraryItem {
  id: number;
  day_plan_id: number;
  name: string;
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
  position?: number;
  source?: "ai" | "link" | "manual" | null;
  source_url?: string | null;
}

export const tripsApi = {
  // Rails returns array directly (not wrapped)
  list: () => api.get<Trip[]>('/trips'),

  get: (id: number) => api.get<Trip>(`/trips/${id}`),

  create: (data: {
    name: string;
    destination: string;
    num_days: number;
    ai_mode?: 'eco' | 'pro';
  }) => api.post<Trip>('/trips', { trip: { ai_mode: 'eco', ...data } }),

  update: (id: number, data: Partial<Trip>) =>
    api.patch<Trip>(`/trips/${id}`, { trip: data }),

  delete: (id: number) => api.delete<void>(`/trips/${id}`),

  generate: (id: number, profile?: any) =>
    api.ai.post<{ status: string; message: string }>('/generate-itinerary', {
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

  share: (id: number) =>
    api.post<{ share_token: string; shared_at: string }>(`/trips/${id}/share`),
};
