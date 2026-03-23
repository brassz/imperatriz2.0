/**
 * Agendamentos de envio de cobranças via WhatsApp
 * Escopados por usuário + empresa no localStorage.
*/

import { getStoredUser } from "@/api/auth";
import { getSupabaseCompany } from "@/lib/supabase";

export type FiltroAgendamento = "vencem_hoje" | "vencidos" | "parcelamentos";

export type DiaSemana = "todos" | "segunda" | "terca" | "quarta" | "quinta" | "sexta" | "sabado" | "domingo";

export type Agendamento = {
  id: string;
  nome: string;
  instance: string;
  empresa: string;
  horario: string; // HH:MM
  dias: DiaSemana[];
  filtros: FiltroAgendamento[];
  delayMinutos: number;
  ativo: boolean;
  createdAt: string;
};

function getAgendamentosStorageKey(): string {
  const user = getStoredUser();
  const userId = user?.id || "anon";
  const companyId = getSupabaseCompany() || "unknown";
  return `nexus_agendamentos_${companyId}_${userId}`;
}

const LEGACY_AGENDAMENTOS_KEY = "nexus_agendamentos";

export function getAgendamentos(): Agendamento[] {
  try {
    const scopedKey = getAgendamentosStorageKey();
    const stored = localStorage.getItem(scopedKey);
    const legacyStored = !stored ? localStorage.getItem(LEGACY_AGENDAMENTOS_KEY) : null;
    const raw = stored || legacyStored;
    if (!raw) return [];

    const arr = JSON.parse(raw) as Agendamento[];
    // Migração 1x: move do key legado para o key escopado
    if (!stored && legacyStored) {
      localStorage.setItem(scopedKey, legacyStored);
      localStorage.removeItem(LEGACY_AGENDAMENTOS_KEY);
    }
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveAgendamento(a: Omit<Agendamento, "id" | "createdAt">): Agendamento {
  const list = getAgendamentos();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const novo: Agendamento = {
    ...a,
    id,
    createdAt: now,
  };
  list.push(novo);
  localStorage.setItem(getAgendamentosStorageKey(), JSON.stringify(list));
  return novo;
}

export function updateAgendamento(id: string, patch: Partial<Agendamento>): void {
  const list = getAgendamentos().map((a) => (a.id === id ? { ...a, ...patch } : a));
  localStorage.setItem(getAgendamentosStorageKey(), JSON.stringify(list));
}

export function removeAgendamento(id: string): void {
  const list = getAgendamentos().filter((a) => a.id !== id);
  localStorage.setItem(getAgendamentosStorageKey(), JSON.stringify(list));
}
