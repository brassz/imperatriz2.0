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

const FIXED_EVOLUTION_BASE_URL = "https://sapphiredev.com.br";

/** Instâncias oficiais e API key correspondente (header apikey). */
export const EVOLUTION_INSTANCE_API_KEYS: Record<string, string> = {
  vinicius: "142CE646BFB4-49A2-9BB5-D775F2B4FD22",
  litoral: "94CF7A25C270-4057-8A92-194B4B9A7B81",
  imperatriz: "DC1496386FE8-4B2F-B871-D96689DFBC4E",
  rafael: "2D8DE0E7FE94-4441-A004-EF88849900E7",
  novixcred: "C6C119E91CEF-4A96-8336-18AAD15E84C6",
  nobrega: "D879B3B8ED95-4D6E-9174-AC081E4351C3",
};

export const EVOLUTION_INSTANCE_IDS = ["vinicius", "nobrega", "litoral", "imperatriz", "rafael", "novixcred"] as const;

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

const DEFAULTS: EvolutionConfig = {
  baseUrl: FIXED_EVOLUTION_BASE_URL,
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
  const defaults = DEFAULTS;
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
        baseUrl: defaults.baseUrl,
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
  // baseUrl é fixa e não deve ser alterada via UI/localStorage/env
  const merged = { ...current, ...config, instance: instanceNorm, apiKey, baseUrl: FIXED_EVOLUTION_BASE_URL };
  localStorage.setItem(getEvolutionStorageKey(), JSON.stringify(merged));
}
