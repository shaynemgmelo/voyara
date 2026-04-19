// Supabase Edge Function: delete-account
//
// Required for App Store compliance: users must be able to permanently
// delete their account from inside the app.
//
// Deploy:
//   supabase functions deploy delete-account --no-verify-jwt=false
//
// Environment variables required:
//   - SUPABASE_URL (auto-injected by Supabase)
//   - SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase)
//   - RAILS_API_URL (set manually): e.g. https://voyara-api.onrender.com/api/v1
//   - RAILS_SERVICE_KEY (set manually): shared service key for Rails backend

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the user by calling Supabase auth with their token
    const userClient = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: "unauthorized" }, 401);
    }

    const userId = user.id;

    // Step 1: tell Rails to purge all user data
    const railsUrl = Deno.env.get("RAILS_API_URL");
    const railsKey = Deno.env.get("RAILS_SERVICE_KEY");
    if (railsUrl && railsKey) {
      try {
        await fetch(`${railsUrl}/users/${userId}/purge`, {
          method: "DELETE",
          headers: {
            "X-Service-Key": railsKey,
            "Content-Type": "application/json",
          },
        });
      } catch (e) {
        console.error("Rails purge failed:", e);
      }
    }

    // Step 2: delete the user from auth.users (service role required)
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) {
      return json({ error: deleteErr.message }, 500);
    }

    return json({ success: true, user_id: userId });
  } catch (e: any) {
    console.error("delete-account error:", e);
    return json({ error: e?.message ?? "internal_error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
