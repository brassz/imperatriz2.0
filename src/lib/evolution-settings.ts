/**
 * Configuração da Evolution API (WhatsApp)
 * Escopada por usuário + empresa no localStorage.
 * Chaves por instância são fixas (não é necessário trocar manualmente).
 */

import { getStoredUser } from "@/api/auth";
import { getSupabaseCompany } from "@/lib/supabase";

export type EvolutionConfig = {
  baseUrl: string;
  apiKey: string;
  instance: string;
};

/** Instâncias oficiais e API key correspondente (header apikey). */
export const EVOLUTION_INSTANCE_API_KEYS: Record<string, string> = {
  omnibot2: "47D7D2601B26-4433-A14E-19C9C521E405",
  omni2: "47D7D2601B26-4433-A14E-19C9C521E405",
  douglas: "C90BA26A8886-42A1-88CA-32876067F1D2",
  vinicius: "142CE646BFB4-49A2-9BB5-D775F2B4FD22",
};

export const EVOLUTION_INSTANCE_IDS = ["omnibot2", "vinicius", "douglas"] as const;

export function normalizeEvolutionInstanceId(id: string): string {
  const k = String(id || "")
    .trim()
    .toLowerCase();
  if (k === "omni2" || k === "omnibot") return "omnibot2";
  return k;
}

export function getApiKeyForEvolutionInstance(instance: string): string {
  const norm = normalizeEvolutionInstanceId(instance);
  return EVOLUTION_INSTANCE_API_KEYS[norm] || EVOLUTION_INSTANCE_API_KEYS[instance] || "";
}

const DEFAULTS: EvolutionConfig = {
  baseUrl: "http://212.85.19.210:3000",
  apiKey: getApiKeyForEvolutionInstance("vinicius"),
  instance: "vinicius",
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
      let instanceNorm = normalizeEvolutionInstanceId(parsed.instance || defaults.instance);
      if (!getApiKeyForEvolutionInstance(instanceNorm)) {
        instanceNorm = "vinicius";
      }
      const keyFromInstance = getApiKeyForEvolutionInstance(instanceNorm);
      const config: EvolutionConfig = {
        ...defaults,
        ...parsed,
        instance: instanceNorm,
        baseUrl: parsed.baseUrl || defaults.baseUrl,
        apiKey: keyFromInstance || parsed.apiKey || defaults.apiKey,
      };
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
  const instanceNorm = normalizeEvolutionInstanceId(config.instance ?? current.instance);
  const apiKey =
    getApiKeyForEvolutionInstance(instanceNorm) ||
    config.apiKey ||
    current.apiKey;
  const merged = { ...current, ...config, instance: instanceNorm, apiKey };
  localStorage.setItem(getEvolutionStorageKey(), JSON.stringify(merged));
}
