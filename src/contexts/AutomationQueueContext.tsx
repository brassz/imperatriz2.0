import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { AutomationLoan } from "@/api/automation";
import { sendWhatsAppText } from "@/api/evolution";
import type { PixInfo } from "@/lib/whatsapp-messages";

export type AutomationSendTypes = {
  cobranca: boolean;
  lembrete_hoje: boolean;
  lembrete_amanha: boolean;
  lembrete_pagamento: boolean;
};

export type AutomationQueueLog = {
  idx: number;
  clientName: string;
  type: AutomationLoan["type"];
  status: "sent" | "failed";
  error?: string;
};

export type AutomationQueueStats = { total: number; done: number; sent: number; failed: number };

type StartParams = {
  items: AutomationLoan[];
  delayMs: number;
  pixInfo: PixInfo;
  sendTypes: AutomationSendTypes;
  buildMessage: (item: AutomationLoan, pixInfo: PixInfo) => string;
};

type AutomationQueueState = {
  isRunning: boolean;
  phase: "idle" | "loading" | "sending" | "waiting" | "done";
  stats: AutomationQueueStats;
  logs: AutomationQueueLog[];
  currentName: string;
  nextName: string;
  minimized: boolean;
  detailsOpen: boolean;
  startedAtMs: number | null;
  delayMs: number;
};

type AutomationQueueApi = AutomationQueueState & {
  start: (params: StartParams) => Promise<void>;
  stop: () => void;
  setMinimized: (v: boolean) => void;
  setDetailsOpen: (v: boolean) => void;
  clear: () => void;
};

const AutomationQueueContext = createContext<AutomationQueueApi | null>(null);

export function interruptibleDelay(ms: number, shouldAbort: () => boolean): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const start = Date.now();
    const step = () => {
      if (shouldAbort()) return resolve();
      const elapsed = Date.now() - start;
      if (elapsed >= ms) return resolve();
      window.setTimeout(step, Math.min(250, ms - elapsed));
    };
    step();
  });
}

export function AutomationQueueProvider({ children }: { children: React.ReactNode }) {
  const abortRef = useRef(false);
  const runningRef = useRef(false);

  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState<AutomationQueueState["phase"]>("idle");
  const [stats, setStats] = useState<AutomationQueueStats>({ total: 0, done: 0, sent: 0, failed: 0 });
  const [logs, setLogs] = useState<AutomationQueueLog[]>([]);
  const [currentName, setCurrentName] = useState("");
  const [nextName, setNextName] = useState("");
  const [minimized, setMinimized] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [delayMs, setDelayMs] = useState(0);

  const stop = useCallback(() => {
    abortRef.current = true;
  }, []);

  const clear = useCallback(() => {
    if (runningRef.current) return;
    setPhase("idle");
    setStats({ total: 0, done: 0, sent: 0, failed: 0 });
    setLogs([]);
    setCurrentName("");
    setNextName("");
    setDetailsOpen(false);
    setMinimized(true);
    setStartedAtMs(null);
    setDelayMs(0);
  }, []);

  const start = useCallback(async (params: StartParams) => {
    if (runningRef.current) return;

    abortRef.current = false;
    runningRef.current = true;
    setIsRunning(true);
    setMinimized(false);
    setDetailsOpen(false);
    setPhase("loading");
    setStats({ total: params.items.length, done: 0, sent: 0, failed: 0 });
    setLogs([]);
    setCurrentName("Carregando fila...");
    setNextName("—");
    setStartedAtMs(Date.now());
    setDelayMs(Math.max(0, params.delayMs || 0));

    try {
      const activeTypes = new Set<AutomationLoan["type"]>(
        ([
          params.sendTypes.cobranca && "cobranca",
          params.sendTypes.lembrete_hoje && "lembrete_hoje",
          params.sendTypes.lembrete_amanha && "lembrete_amanha",
          params.sendTypes.lembrete_pagamento && "lembrete_pagamento",
        ].filter(Boolean) as AutomationLoan["type"][]),
      );

      const toSend = (params.items || []).filter((i) => i.loan.client_phone?.trim() && activeTypes.has(i.type));
      setStats({ total: toSend.length, done: 0, sent: 0, failed: 0 });

      let sent = 0;
      let failed = 0;

      for (let i = 0; i < toSend.length; i++) {
        if (abortRef.current) break;

        const item = toSend[i];
        const nextItem = toSend[i + 1];

        setPhase("sending");
        setCurrentName(item.loan.client_name || "—");
        setNextName(nextItem?.loan?.client_name || "—");

        const text = params.buildMessage(item, params.pixInfo);
        const { ok, error } = await sendWhatsAppText(item.loan.client_phone, text);
        if (ok) sent++;
        else failed++;

        setLogs((prev) => [
          ...prev,
          {
            idx: i,
            clientName: item.loan.client_name,
            type: item.type,
            status: ok ? "sent" : "failed",
            error: ok ? undefined : error ?? "Erro desconhecido",
          },
        ]);
        setStats({ total: toSend.length, done: i + 1, sent, failed });

        if (abortRef.current) break;
        if (i < toSend.length - 1 && params.delayMs > 0) {
          setPhase("waiting");
          setCurrentName("Aguardando intervalo...");
          setNextName(nextItem?.loan?.client_name || "—");
          await interruptibleDelay(params.delayMs, () => abortRef.current);
        }
      }

      setPhase("done");
    } finally {
      runningRef.current = false;
      setIsRunning(false);
      if (!abortRef.current) {
        setCurrentName("—");
        setNextName("—");
      }
    }
  }, []);

  const value: AutomationQueueApi = useMemo(
    () => ({
      isRunning,
      phase,
      stats,
      logs,
      currentName,
      nextName,
      minimized,
      detailsOpen,
      startedAtMs,
      delayMs,
      start,
      stop,
      setMinimized,
      setDetailsOpen,
      clear,
    }),
    [isRunning, phase, stats, logs, currentName, nextName, minimized, detailsOpen, startedAtMs, delayMs, start, stop, clear],
  );

  return <AutomationQueueContext.Provider value={value}>{children}</AutomationQueueContext.Provider>;
}

export function useAutomationQueue(): AutomationQueueApi {
  const ctx = useContext(AutomationQueueContext);
  if (!ctx) throw new Error("useAutomationQueue must be used within AutomationQueueProvider");
  return ctx;
}

