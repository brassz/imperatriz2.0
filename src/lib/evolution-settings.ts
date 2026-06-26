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

export const FIXED_EVOLUTION_BASE_URL = "https://sapphiredev.com.br";

/** Instância dedicada ao envio de token de login. */
export const LOGIN_EVOLUTION_INSTANCE = "credcardlogin";

/** Instâncias oficiais CRED CARD - IMPERATRIZ e API key correspondente (header apikey). */
export const EVOLUTION_INSTANCE_API_KEYS: Record<string, string> = {
  credcardlogin: "0F3BD7C3CA06-4C2E-B415-241CB195C60E",
  imperatrizcredcard: "0B30A3953B15-42E5-B48C-01E49BAF3889",
  imperatrizcredcard2: "A1DF53512E58-4CD2-B917-8D905028F969",
};

export const EVOLUTION_INSTANCE_IDS = [
  "imperatrizcredcard",
  "imperatrizcredcard2",
] as const;

/** Instâncias WhatsApp da aba Advocacia (desativadas nesta operação). */
export const ADVOCACIA_INSTANCE_IDS = [] as const;

/** Instância dedicada à automação 24HORAS (desativada por enquanto). */
export const COBRANCA_24H_INSTANCE_IDS = [] as const;

const DEFAULT_PROFILE_INSTANCE: Record<EvolutionProfileId, string> = {
  cobranca: "imperatrizcredcard",
};

/** Instância padrão de cobrança por empresa (quando ainda não há preferência salva). */
const COMPANY_DEFAULT_INSTANCE: Partial<Record<string, string>> = {
  imperatriz: "imperatrizcredcard",
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
  const companyId = getSupabaseCompany();
  const instance = COMPANY_DEFAULT_INSTANCE[companyId] || DEFAULT_PROFILE_INSTANCE[profile];
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
