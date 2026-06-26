import type { CompanyId } from "@/lib/companies";
import { COMPANIES } from "@/lib/companies";
import type { AutomationSendTypes } from "@/contexts/AutomationQueueContext";

export const COBRANCA_24H_STORAGE_KEY = "nexus_cobranca_24h_config";
export const COBRANCA_24H_DEDUP_KEY = "nexus_cobranca_24h_dedup";
export const COBRANCA_24H_DEFAULT_INSTANCE = "nexus24horas";

export type Cobranca24hCompanyConfig = {
  enabled: boolean;
  pixKeyId: string;
};

export type Cobranca24hConfig = {
  enabled: boolean;
  instance: string;
  /** Intervalo entre envios (minutos). */
  delayMinutes: number;
  /** Intervalo entre varreduras completas de todas as empresas (minutos). */
  cycleMinutes: number;
  includeInstallments: boolean;
  sendTypes: Pick<AutomationSendTypes, "cobranca" | "lembrete_hoje" | "lembrete_amanha">;
  companies: Record<CompanyId, Cobranca24hCompanyConfig>;
};

function defaultCompanies(): Record<CompanyId, Cobranca24hCompanyConfig> {
  const out = {} as Record<CompanyId, Cobranca24hCompanyConfig>;
  for (const c of COMPANIES) {
    out[c.id] = { enabled: true, pixKeyId: "" };
  }
  return out;
}

export function getDefaultCobranca24hConfig(): Cobranca24hConfig {
  return {
    enabled: false,
    instance: COBRANCA_24H_DEFAULT_INSTANCE,
    delayMinutes: 2,
    cycleMinutes: 60,
    includeInstallments: true,
    sendTypes: {
      cobranca: true,
      lembrete_hoje: true,
      lembrete_amanha: false,
    },
    companies: defaultCompanies(),
  };
}

export function loadCobranca24hConfig(): Cobranca24hConfig {
  const defaults = getDefaultCobranca24hConfig();
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(COBRANCA_24H_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Cobranca24hConfig>;
    const instance =
      parsed.instance && parsed.instance !== "novixcred"
        ? parsed.instance
        : COBRANCA_24H_DEFAULT_INSTANCE;
    return {
      ...defaults,
      ...parsed,
      instance,
      sendTypes: { ...defaults.sendTypes, ...parsed.sendTypes },
      companies: { ...defaults.companies, ...parsed.companies },
    };
  } catch {
    return defaults;
  }
}

export function saveCobranca24hConfig(config: Cobranca24hConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(COBRANCA_24H_STORAGE_KEY, JSON.stringify(config));
}

export function wasCobranca24hSentToday(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(COBRANCA_24H_DEDUP_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, string>;
    return Boolean(map[key]);
  } catch {
    return false;
  }
}

export function markCobranca24hSent(key: string, dateYmd: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(COBRANCA_24H_DEDUP_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[key] = dateYmd;
    const cutoff = dateYmd;
    for (const k of Object.keys(map)) {
      if (map[k] < cutoff) delete map[k];
    }
    localStorage.setItem(COBRANCA_24H_DEDUP_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function cobranca24hDedupKey(
  companyId: CompanyId,
  itemId: string,
  type: string,
  dateYmd: string,
): string {
  return `${companyId}:${itemId}:${type}:${dateYmd}`;
}
