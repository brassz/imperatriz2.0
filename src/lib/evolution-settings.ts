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

export type EvolutionProfileId = "cobranca";

export const EVOLUTION_PROFILE_LABELS: Record<EvolutionProfileId, string> = {
  cobranca: "Cobrança",
};

const FIXED_EVOLUTION_BASE_URL = "https://sapphiredev.com.br";

/** Instâncias oficiais e API key correspondente (header apikey). */
export const EVOLUTION_INSTANCE_API_KEYS: Record<string, string> = {
  vinicius: "142CE646BFB4-49A2-9BB5-D775F2B4FD22",
  litoral: "94CF7A25C270-4057-8A92-194B4B9A7B81",
  imperatriz: "DC1496386FE8-4B2F-B871-D96689DFBC4E",
  rafael: "2D8DE0E7FE94-4441-A004-EF88849900E7",
  novixcred: "C6C119E91CEF-4A96-8336-18AAD15E84C6",
  nobrega: "D879B3B8ED95-4D6E-9174-AC081E4351C3",
  luciana: "AF9F4C62CC87-4B2A-B4DF-EF3F8CDF5C77",
};

export const EVOLUTION_INSTANCE_IDS = [
  "vinicius",
  "nobrega",
  "litoral",
  "imperatriz",
  "rafael",
  "novixcred",
  "luciana",
] as const;

const DEFAULT_PROFILE_INSTANCE: Record<EvolutionProfileId, string> = {
  cobranca: "vinicius",
};

export function normalizeEvolutionInstanceId(id: string): string {
  const k = String(id || "")
    .trim()
    .toLowerCase();
  if (k === "omni2" || k === "omnibot" || k === "omnibot2") return "omni2";
  return k;
}

export function getApiKeyForEvolutionInstance(instance: string): string {
  const norm = normalizeEvolutionInstanceId(instance);
  return EVOLUTION_INSTANCE_API_KEYS[norm] || EVOLUTION_INSTANCE_API_KEYS[instance] || "";
}

function getDefaultEvolutionConfig(profile: EvolutionProfileId): EvolutionConfig {
  const instance = DEFAULT_PROFILE_INSTANCE[profile];
  return {
    baseUrl: FIXED_EVOLUTION_BASE_URL,
    apiKey: getApiKeyForEvolutionInstance(instance),
    instance,
  };
}

function ensureHttpsOnSecurePage(baseUrl: string): string {
  if (typeof window !== "undefined" && window.location.protocol === "https:" && baseUrl.startsWith("http://")) {
    return baseUrl.replace(/^http:\/\//, "https://");
  }
  return baseUrl;
}

function getEvolutionStorageKey(profile: EvolutionProfileId): string {
  const user = getStoredUser();
  const userId = user?.id || "anon";
  const companyId = getSupabaseCompany() || "unknown";
  return `nexus_evolution_api_${profile}_${companyId}_${userId}`;
}

const LEGACY_EVOLUTION_KEY = "nexus_evolution_api";

function parseStoredEvolutionConfig(raw: string, defaults: EvolutionConfig): EvolutionConfig {
  const parsed = JSON.parse(raw) as Partial<EvolutionConfig>;
  let instanceNorm = normalizeEvolutionInstanceId(parsed.instance || defaults.instance);
  if (!getApiKeyForEvolutionInstance(instanceNorm)) {
    instanceNorm = defaults.instance;
  }
  const keyFromInstance = getApiKeyForEvolutionInstance(instanceNorm);
  return {
    ...defaults,
    ...parsed,
    instance: instanceNorm,
    baseUrl: ensureHttpsOnSecurePage(defaults.baseUrl),
    apiKey: keyFromInstance || parsed.apiKey || defaults.apiKey,
  };
}

export function getEvolutionConfig(profile: EvolutionProfileId = "cobranca"): EvolutionConfig {
  const defaults = getDefaultEvolutionConfig(profile);
  try {
    const scopedKey = getEvolutionStorageKey(profile);
    const stored = localStorage.getItem(scopedKey);
    const legacyStored =
      profile === "cobranca" && !stored ? localStorage.getItem(LEGACY_EVOLUTION_KEY) : null;

    if (stored || legacyStored) {
      const raw = stored || legacyStored || "{}";
      const config = parseStoredEvolutionConfig(raw, defaults);

      if (!stored && legacyStored && profile === "cobranca") {
        localStorage.setItem(scopedKey, JSON.stringify(config));
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

export function saveEvolutionConfig(
  config: Partial<EvolutionConfig>,
  profile: EvolutionProfileId = "cobranca",
): void {
  const current = getEvolutionConfig(profile);
  const instanceNorm = normalizeEvolutionInstanceId(config.instance ?? current.instance);
  const apiKey = getApiKeyForEvolutionInstance(instanceNorm) || config.apiKey || current.apiKey;
  const merged = {
    ...current,
    ...config,
    instance: instanceNorm,
    apiKey,
    baseUrl: FIXED_EVOLUTION_BASE_URL,
  };
  localStorage.setItem(getEvolutionStorageKey(profile), JSON.stringify(merged));
}

export function clearEvolutionConfig(profile: EvolutionProfileId = "cobranca"): void {
  localStorage.removeItem(getEvolutionStorageKey(profile));
}
