import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type TrafficSource = "novixcred" | "credcard";

type TrafficEnv = {
  url: string | undefined;
  anonKey: string | undefined;
};

const trafficEnv: Record<TrafficSource, TrafficEnv> = {
  novixcred: {
    url: import.meta.env.VITE_SUPABASE_URL_NOVIXCRED,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY_NOVIXCRED,
  },
  credcard: {
    url: import.meta.env.VITE_SUPABASE_URL_CREDCARD,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY_CREDCARD,
  },
};

const clientCache: Partial<Record<TrafficSource, SupabaseClient>> = {};

export function getTrafficSupabaseClient(source: TrafficSource): SupabaseClient {
  const cached = clientCache[source];
  if (cached) return cached;

  const { url, anonKey } = trafficEnv[source];
  const u = String(url || "").trim();
  const k = String(anonKey || "").trim();

  if (!u || !k) {
    throw new Error(
      `Supabase de tráfego (${source}) não configurado. Configure VITE_SUPABASE_URL_${source.toUpperCase()} e VITE_SUPABASE_ANON_KEY_${source.toUpperCase()} no .env.`
    );
  }

  const client = createClient(u, k);
  clientCache[source] = client;
  return client;
}

