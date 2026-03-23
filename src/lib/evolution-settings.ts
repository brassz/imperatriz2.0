/**
 * Configuração da Evolution API (WhatsApp)
 * Escopada por usuário + empresa no localStorage.
 */

import { getStoredUser } from "@/api/auth";
import { getSupabaseCompany } from "@/lib/supabase";

export type EvolutionConfig = {
  baseUrl: string;
  apiKey: string;
  instance: string;
};

const DEFAULTS: EvolutionConfig = {
  baseUrl: "http://212.85.19.210:3000",
  apiKey: "3D4CF3735264-454E-9564-C253D0B0C3D2",
  instance: "nexussistema",
};

function ensureHttpsOnSecurePage(baseUrl: string): string {
  if (typeof window !== "undefined" && window.location.protocol === "https:" && baseUrl.startsWith("http://")) {
    return baseUrl.replace(/^http:\/\//, "https://");
  }
  return baseUrl;
}

function getEvolutionStorageKey(): string {
  const user = getStoredUser();
  const userId = user?.id || "anon";
  const companyId = getSupabaseCompany() || "unknown";
  return `nexus_evolution_api_${companyId}_${userId}`;
}

const LEGACY_EVOLUTION_KEY = "nexus_evolution_api";

export function getEvolutionConfig(): EvolutionConfig {
  const envUrl = import.meta.env.VITE_EVOLUTION_API_URL;
  const defaults = envUrl ? { ...DEFAULTS, baseUrl: envUrl } : DEFAULTS;
  try {
    const scopedKey = getEvolutionStorageKey();
    const stored = localStorage.getItem(scopedKey);
    const legacyStored = !stored ? localStorage.getItem(LEGACY_EVOLUTION_KEY) : null;

    if (stored || legacyStored) {
      const raw = stored || legacyStored || "{}";
      const parsed = JSON.parse(raw) as Partial<EvolutionConfig>;
      const config = { ...defaults, ...parsed };
      config.baseUrl = ensureHttpsOnSecurePage(config.baseUrl);

      // Migração 1x: move do key legado para o key escopado
      if (!stored && legacyStored) {
        localStorage.setItem(scopedKey, legacyStored);
        localStorage.removeItem(LEGACY_EVOLUTION_KEY);
      }
      return config;
    }
  } catch {}
  return {
    ...defaults,
    baseUrl: ensureHttpsOnSecurePage(defaults.baseUrl),
  };
}

export function saveEvolutionConfig(config: Partial<EvolutionConfig>): void {
  const current = getEvolutionConfig();
  const merged = { ...current, ...config };
  localStorage.setItem(getEvolutionStorageKey(), JSON.stringify(merged));
}
