import { createApiClient } from "@aurora/api-client";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

/** Null when sign-in isn't configured (no .env.local); the modeler still works without it. */
export const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000",
  getToken: async () => (supabase ? ((await supabase.auth.getSession()).data.session?.access_token ?? null) : null),
});
