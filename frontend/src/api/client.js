import { supabase } from "../lib/supabase";

const RAW_URL = process.env.REACT_APP_API_URL || "http://localhost:3000/api/v1";
const BASE_URL = RAW_URL.endsWith("/api/v1") ? RAW_URL : `${RAW_URL.replace(/\/+$/, "")}/api/v1`;

async function request(path, options = {}) {
  // Get current Supabase session token
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 204) return null;

  // Handle non-JSON responses (e.g. Rails HTML 404 pages)
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText || "Request failed"}`);
    }
    return null;
  }

  const data = await response.json();

  if (!response.ok) {
    // If 401 Unauthorized, sign out from Supabase
    if (response.status === 401) {
      await supabase.auth.signOut();
      window.location.href = "/login";
      throw new Error("Session expired");
    }
    throw new Error(data.errors?.join(", ") || data.error || "Request failed");
  }

  return data;
}

export function get(path) {
  return request(path);
}

export function post(path, body) {
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

export function patch(path, body) {
  return request(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function del(path) {
  return request(path, { method: "DELETE" });
}
