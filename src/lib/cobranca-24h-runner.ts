import type { AutomationLoan } from "@/api/automation";
import { fetchLoansForAutomation } from "@/api/automation";
import { fetchPixKeysForClient } from "@/api/pix-keys";
import { sendWhatsAppTextWithInstance } from "@/api/evolution";
import { interruptibleDelay } from "@/contexts/AutomationQueueContext";
import { COMPANIES, type CompanyId } from "@/lib/companies";
import { calendarDateInBrazil } from "@/lib/brazil-date";
import { getSupabaseClientForCompany } from "@/lib/supabase";
import {
  buildAutomationCobrancaMessage,
  buildAutomationLembreteMessage,
  resolvePixInfoForMessages,
  type PixInfo,
} from "@/lib/whatsapp-messages";
import {
  cobranca24hDedupKey,
  loadCobranca24hConfig,
  markCobranca24hSent,
  wasCobranca24hSentToday,
  type Cobranca24hConfig,
} from "@/lib/cobranca-24h-config";
import {
  EVOLUTION_INSTANCE_API_KEYS,
  FIXED_EVOLUTION_BASE_URL,
  getApiKeyForEvolutionInstance,
  normalizeEvolutionInstanceId,
} from "@/lib/evolution-settings";

export type Cobranca24hLogEntry = {
  at: string;
  companyId: CompanyId;
  companyName: string;
  clientName: string;
  type: AutomationLoan["type"];
  status: "sent" | "failed" | "skipped";
  detail?: string;
};

export type Cobranca24hRunnerState = {
  running: boolean;
  phase: "idle" | "cycle" | "company" | "sending" | "waiting" | "sleeping";
  currentCompany: string;
  currentClient: string;
  lastCycleAt: string | null;
  nextCycleAt: string | null;
  sent: number;
  failed: number;
  skipped: number;
  logs: Cobranca24hLogEntry[];
};

const MAX_LOGS = 200;

let abort = false;
let loopRunning = false;
let state: Cobranca24hRunnerState = {
  running: false,
  phase: "idle",
  currentCompany: "—",
  currentClient: "—",
  lastCycleAt: null,
  nextCycleAt: null,
  sent: 0,
  failed: 0,
  skipped: 0,
  logs: [],
};

const listeners = new Set<(s: Cobranca24hRunnerState) => void>();

function emit() {
  const snap = { ...state, logs: [...state.logs] };
  listeners.forEach((fn) => fn(snap));
}

function patch(partial: Partial<Cobranca24hRunnerState>) {
  state = { ...state, ...partial };
  emit();
}

function pushLog(entry: Omit<Cobranca24hLogEntry, "at">) {
  const row: Cobranca24hLogEntry = { ...entry, at: new Date().toISOString() };
  const logs = [row, ...state.logs].slice(0, MAX_LOGS);
  patch({ logs });
}

function buildMessage(item: AutomationLoan, pix: PixInfo, companyId: CompanyId): string {
  if (item.type === "cobranca" || item.type === "lembrete_hoje") {
    return buildAutomationCobrancaMessage(item.loan, pix, 50, companyId, item.source);
  }
  return buildAutomationLembreteMessage(item.loan, pix, item.days_until_due ?? 1, companyId);
}

async function resolvePixForCompany(
  companyId: CompanyId,
  pixKeyId: string,
): Promise<PixInfo | null> {
  const client = getSupabaseClientForCompany(companyId);
  const keys = await fetchPixKeysForClient(client);
  if (!keys.length) return null;
  const picked = pixKeyId ? keys.find((k) => String(k.id) === pixKeyId) : keys[0];
  const pix = picked || keys[0];
  if (!pix?.key?.trim()) return null;
  return resolvePixInfoForMessages(
    {
      tipo: String(pix.bank || "CNPJ"),
      titular: String(pix.holder || ""),
      chave: String(pix.key || ""),
    },
    companyId,
  );
}

function evolutionOpts(instance: string) {
  const norm = normalizeEvolutionInstanceId(instance);
  return {
    instance: norm,
    apiKey: getApiKeyForEvolutionInstance(norm),
    baseUrl: FIXED_EVOLUTION_BASE_URL,
  };
}

async function runCycle(config: Cobranca24hConfig) {
  const today = calendarDateInBrazil();
  const activeTypes = new Set<AutomationLoan["type"]>(
    ([
      config.sendTypes.cobranca && "cobranca",
      config.sendTypes.lembrete_hoje && "lembrete_hoje",
      config.sendTypes.lembrete_amanha && "lembrete_amanha",
    ].filter(Boolean) as AutomationLoan["type"][]),
  );

  if (activeTypes.size === 0) return;

  const delayMs = Math.max(0, Math.round(config.delayMinutes * 60_000));
  const inst = normalizeEvolutionInstanceId(config.instance);
  if (!EVOLUTION_INSTANCE_API_KEYS[inst] && !getApiKeyForEvolutionInstance(inst)) {
    pushLog({
      companyId: "imperatriz",
      companyName: "—",
      clientName: "—",
      type: "cobranca",
      status: "failed",
      detail: `Instância "${inst}" sem API key configurada`,
    });
    return;
  }

  for (const company of COMPANIES) {
    if (abort) break;
    const companyCfg = config.companies[company.id];
    if (!companyCfg?.enabled) continue;

    patch({ phase: "company", currentCompany: company.name, currentClient: "Carregando..." });

    let pix: PixInfo | null = null;
    try {
      pix = await resolvePixForCompany(company.id, companyCfg.pixKeyId);
    } catch (e) {
      pushLog({
        companyId: company.id,
        companyName: company.name,
        clientName: "—",
        type: "cobranca",
        status: "failed",
        detail: e instanceof Error ? e.message : "Erro ao buscar PIX",
      });
      continue;
    }

    if (!pix) {
      pushLog({
        companyId: company.id,
        companyName: company.name,
        clientName: "—",
        type: "cobranca",
        status: "skipped",
        detail: "Nenhuma chave PIX ativa",
      });
      continue;
    }

    let items: AutomationLoan[] = [];
    try {
      const db = getSupabaseClientForCompany(company.id);
      items = await fetchLoansForAutomation(
        { requirePhone: true, includeInstallments: config.includeInstallments, companyId: company.id },
        db,
      );
    } catch (e) {
      pushLog({
        companyId: company.id,
        companyName: company.name,
        clientName: "—",
        type: "cobranca",
        status: "failed",
        detail: e instanceof Error ? e.message : "Erro ao listar empréstimos",
      });
      continue;
    }

    const toSend = items.filter((i) => activeTypes.has(i.type) && i.loan.client_phone?.trim());

    for (let i = 0; i < toSend.length; i++) {
      if (abort) break;
      const item = toSend[i];
      const dedup = cobranca24hDedupKey(company.id, item.id, item.type, today);

      patch({
        phase: "sending",
        currentCompany: company.name,
        currentClient: item.loan.client_name,
      });

      if (wasCobranca24hSentToday(dedup)) {
        patch({ skipped: state.skipped + 1 });
        pushLog({
          companyId: company.id,
          companyName: company.name,
          clientName: item.loan.client_name,
          type: item.type,
          status: "skipped",
          detail: "Já enviado hoje",
        });
        continue;
      }

      const text = buildMessage(item, pix, company.id);
      const res = await sendWhatsAppTextWithInstance(item.loan.client_phone, text, evolutionOpts(inst));

      if (res.ok) {
        markCobranca24hSent(dedup, today);
        patch({ sent: state.sent + 1 });
        pushLog({
          companyId: company.id,
          companyName: company.name,
          clientName: item.loan.client_name,
          type: item.type,
          status: "sent",
        });
      } else {
        patch({ failed: state.failed + 1 });
        pushLog({
          companyId: company.id,
          companyName: company.name,
          clientName: item.loan.client_name,
          type: item.type,
          status: "failed",
          detail: res.error || "Falha no envio",
        });
      }

      if (abort) break;
      if (i < toSend.length - 1 && delayMs > 0) {
        patch({ phase: "waiting", currentClient: "Aguardando intervalo..." });
        await interruptibleDelay(delayMs, () => abort);
      }
    }
  }
}

async function mainLoop() {
  if (loopRunning) return;
  loopRunning = true;
  abort = false;

  patch({
    running: true,
    phase: "cycle",
    sent: 0,
    failed: 0,
    skipped: 0,
    currentCompany: "—",
    currentClient: "—",
  });

  try {
    while (!abort) {
      const config = loadCobranca24hConfig();
      if (!config.enabled) break;

      patch({ phase: "cycle", lastCycleAt: new Date().toISOString() });
      await runCycle(config);

      if (abort) break;

      const cycleMs = Math.max(5, config.cycleMinutes) * 60_000;
      const nextAt = new Date(Date.now() + cycleMs).toISOString();
      patch({
        phase: "sleeping",
        currentCompany: "—",
        currentClient: `Próxima varredura em ${config.cycleMinutes} min`,
        nextCycleAt: nextAt,
      });

      await interruptibleDelay(cycleMs, () => abort);
    }
  } finally {
    loopRunning = false;
    patch({
      running: false,
      phase: "idle",
      currentCompany: "—",
      currentClient: "—",
      nextCycleAt: null,
    });
  }
}

export function getCobranca24hRunnerState(): Cobranca24hRunnerState {
  return { ...state, logs: [...state.logs] };
}

export function subscribeCobranca24hRunner(listener: (s: Cobranca24hRunnerState) => void): () => void {
  listeners.add(listener);
  listener(getCobranca24hRunnerState());
  return () => listeners.delete(listener);
}

export function startCobranca24hRunner(): void {
  if (loopRunning) return;
  void mainLoop();
}

export function stopCobranca24hRunner(): void {
  abort = true;
}

export function clearCobranca24hLogs(): void {
  patch({ logs: [] });
}
