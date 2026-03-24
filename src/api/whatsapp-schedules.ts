/**
 * Agendamentos de WhatsApp persistidos no Supabase para execução via Edge Function (cron).
 */

import { supabase, getSupabaseCompany } from "@/lib/supabase";
import { getStoredUser } from "@/api/auth";
import type {
  Agendamento,
  DiaSemana,
  FiltroAgendamento,
} from "@/lib/agendamentos";
import { getAgendamentos as getLocalAgendamentos, getAgendamentosStorageKey } from "@/lib/agendamentos";

export type ScheduleRow = {
  id: string;
  user_id: string;
  company_id: string;
  nome: string;
  instance: string;
  empresa: string;
  horario: string;
  dias: DiaSemana[];
  filtros: FiltroAgendamento[];
  delay_minutos: number;
  ativo: boolean;
  evolution_base_url: string;
  evolution_api_key: string;
  pix_tipo: string;
  pix_titular: string;
  pix_chave: string;
  last_fired_on: string | null;
  target_client_ids: string[] | unknown;
  created_at: string;
  updated_at: string;
};

function rowToAgendamento(r: ScheduleRow): Agendamento {
  return {
    id: r.id,
    nome: r.nome,
    instance: r.instance,
    empresa: r.empresa,
    horario: r.horario,
    dias: Array.isArray(r.dias) ? r.dias : [],
    filtros: Array.isArray(r.filtros) ? r.filtros : [],
    delayMinutos: r.delay_minutos,
    ativo: r.ativo,
    createdAt: r.created_at,
    evolutionBaseUrl: r.evolution_base_url,
    evolutionApiKey: r.evolution_api_key,
    pixTipo: r.pix_tipo,
    pixTitular: r.pix_titular,
    pixChave: r.pix_chave,
    targetClientIds: normalizeTargetClientIds(r.target_client_ids),
  };
}

function normalizeTargetClientIds(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
  return [];
}

export async function fetchWhatsAppSchedules(): Promise<Agendamento[]> {
  const user = getStoredUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("whatsapp_schedules")
    .select("*")
    .eq("user_id", user.id)
    .eq("company_id", getSupabaseCompany())
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchWhatsAppSchedules:", error);
    return getLocalAgendamentos();
  }

  return (data as ScheduleRow[]).map(rowToAgendamento);
}

export type NewScheduleInput = Omit<
  Agendamento,
  "id" | "createdAt" | "evolutionBaseUrl" | "evolutionApiKey" | "pixTipo" | "pixTitular" | "pixChave"
> & {
  evolutionBaseUrl: string;
  evolutionApiKey: string;
  pixTipo: string;
  pixTitular: string;
  pixChave: string;
};

export async function insertWhatsAppSchedule(input: NewScheduleInput): Promise<Agendamento> {
  const user = getStoredUser();
  if (!user) throw new Error("Faça login para salvar agendamentos.");

  const payload = {
    user_id: user.id,
    company_id: getSupabaseCompany(),
    nome: input.nome,
    instance: input.instance,
    empresa: input.empresa,
    horario: input.horario,
    dias: input.dias,
    filtros: input.filtros,
    delay_minutos: input.delayMinutos,
    ativo: input.ativo,
    evolution_base_url: input.evolutionBaseUrl,
    evolution_api_key: input.evolutionApiKey,
    pix_tipo: input.pixTipo,
    pix_titular: input.pixTitular,
    pix_chave: input.pixChave,
    target_client_ids: input.targetClientIds?.length ? input.targetClientIds : [],
  };

  const { data, error } = await supabase.from("whatsapp_schedules").insert([payload]).select("*").single();

  if (error) throw error;
  return rowToAgendamento(data as ScheduleRow);
}

export async function updateWhatsAppSchedule(
  id: string,
  patch: Partial<
    Pick<
      Agendamento,
      | "nome"
      | "instance"
      | "empresa"
      | "horario"
      | "dias"
      | "filtros"
      | "delayMinutos"
      | "ativo"
      | "evolutionBaseUrl"
      | "evolutionApiKey"
      | "pixTipo"
      | "pixTitular"
      | "pixChave"
      | "targetClientIds"
    >
  >,
): Promise<void> {
  const user = getStoredUser();
  if (!user) throw new Error("Faça login para atualizar agendamentos.");

  const dbPatch: Record<string, unknown> = {};
  if (patch.nome !== undefined) dbPatch.nome = patch.nome;
  if (patch.instance !== undefined) dbPatch.instance = patch.instance;
  if (patch.empresa !== undefined) dbPatch.empresa = patch.empresa;
  if (patch.horario !== undefined) dbPatch.horario = patch.horario;
  if (patch.dias !== undefined) dbPatch.dias = patch.dias;
  if (patch.filtros !== undefined) dbPatch.filtros = patch.filtros;
  if (patch.delayMinutos !== undefined) dbPatch.delay_minutos = patch.delayMinutos;
  if (patch.ativo !== undefined) dbPatch.ativo = patch.ativo;
  if (patch.evolutionBaseUrl !== undefined) dbPatch.evolution_base_url = patch.evolutionBaseUrl;
  if (patch.evolutionApiKey !== undefined) dbPatch.evolution_api_key = patch.evolutionApiKey;
  if (patch.pixTipo !== undefined) dbPatch.pix_tipo = patch.pixTipo;
  if (patch.pixTitular !== undefined) dbPatch.pix_titular = patch.pixTitular;
  if (patch.pixChave !== undefined) dbPatch.pix_chave = patch.pixChave;
  if (patch.targetClientIds !== undefined) {
    dbPatch.target_client_ids = patch.targetClientIds.length ? patch.targetClientIds : [];
  }

  if (Object.keys(dbPatch).length === 0) return;

  dbPatch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("whatsapp_schedules")
    .update(dbPatch)
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("company_id", getSupabaseCompany());

  if (error) throw error;
}

export async function deleteWhatsAppSchedule(id: string): Promise<void> {
  const user = getStoredUser();
  if (!user) throw new Error("Faça login para remover agendamentos.");

  const { error } = await supabase
    .from("whatsapp_schedules")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("company_id", getSupabaseCompany());

  if (error) throw error;
}

/** Migra agendamentos antigos (localStorage) para o Supabase uma vez. */
export async function migrateLocalSchedulesToSupabase(
  evolution: { baseUrl: string; apiKey: string; instance: string },
  pix: { tipo: string; titular: string; chave: string },
): Promise<number> {
  const user = getStoredUser();
  if (!user) return 0;

  const { count } = await supabase
    .from("whatsapp_schedules")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("company_id", getSupabaseCompany());

  if (count && count > 0) return 0;

  const local = getLocalAgendamentos();
  if (local.length === 0) return 0;

  let migrated = 0;
  for (const a of local) {
    try {
      await insertWhatsAppSchedule({
        nome: a.nome,
        instance: a.instance || evolution.instance,
        empresa: a.empresa,
        horario: a.horario,
        dias: a.dias,
        filtros: a.filtros,
        delayMinutos: a.delayMinutos,
        ativo: a.ativo,
        evolutionBaseUrl: evolution.baseUrl,
        evolutionApiKey: evolution.apiKey,
        pixTipo: pix.tipo,
        pixTitular: pix.titular,
        pixChave: pix.chave,
        targetClientIds: [],
      });
      migrated++;
    } catch (e) {
      console.error("migrateLocalSchedulesToSupabase item:", e);
    }
  }

  if (migrated > 0) {
    try {
      localStorage.removeItem(getAgendamentosStorageKey());
    } catch {
      /* ignore */
    }
  }

  return migrated;
}
