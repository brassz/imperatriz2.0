import { createClient } from "@supabase/supabase-js";
import { getEnv, parseCompaniesJson } from "../lib/env.js";

let cached = null;

export function getSupabaseByCompany() {
  if (cached) return cached;
  const env = getEnv();
  const companies = parseCompaniesJson(env.SUPABASE_COMPANIES_JSON);

  const map = new Map();
  for (const c of companies) {
    const supabase = createClient(c.url, c.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "X-Client-Info": "nexus-auto-send-backend" } },
    });
    map.set(c.company, supabase);
  }

  cached = map;
  return map;
}

