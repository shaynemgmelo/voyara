import Constants from 'expo-constants';
import { supabase } from '../auth/supabase';

const API_URL =
  Constants.expoConfig?.extra?.apiUrl ??
  process.env.EXPO_PUBLIC_API_URL ??
  'https://voyara-api.onrender.com/api/v1';

const AI_URL =
  Constants.expoConfig?.extra?.aiUrl ??
  process.env.EXPO_PUBLIC_AI_URL ??
  'https://voyara-ai.onrender.com';

class HTTPError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  base: string = API_URL,
): Promise<T> {
  const auth = await getAuthHeader();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...auth,
    ...((init.headers as Record<string, string>) ?? {}),
  };

  const url = path.startsWith('http') ? path : `${base}${path}`;
  const res = await fetch(url, { ...init, headers });

  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    throw new HTTPError(
      body?.error || body?.message || `Request failed: ${res.status}`,
      res.status,
      body,
    );
  }

  return body as T;
}

export const api = {
  get: <T>(path: string, base?: string) => request<T>(path, { method: 'GET' }, base),
  post: <T>(path: string, body?: unknown, base?: string) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }, base),
  put: <T>(path: string, body?: unknown, base?: string) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }, base),
  patch: <T>(path: string, body?: unknown, base?: string) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }, base),
  delete: <T>(path: string, base?: string) => request<T>(path, { method: 'DELETE' }, base),
  ai: {
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }, AI_URL),
    get: <T>(path: string) => request<T>(path, { method: 'GET' }, AI_URL),
  },
};

export { HTTPError, API_URL, AI_URL };
