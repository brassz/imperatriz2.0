import { supabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

const PIX_KEY_TYPE_DB_VALUES = ["cpf", "cnpj", "email", "phone", "random"] as const;
export type PixKeyTypeDb = (typeof PIX_KEY_TYPE_DB_VALUES)[number];

const PIX_KEY_TYPE_ALIASES: Record<string, PixKeyTypeDb> = {
  cpf: "cpf",
  cnpj: "cnpj",
  email: "email",
  "e-mail": "email",
  phone: "phone",
  telefone: "phone",
  random: "random",
  aleatoria: "random",
  "aleatória": "random",
  "chave aleatória": "random",
};

/** Converte rótulos da UI (ex.: CNPJ, Telefone) para o valor aceito no Supabase. */
export function normalizePixKeyType(raw: string): PixKeyTypeDb {
  const trimmed = String(raw || "").trim();
  const lower = trimmed.toLowerCase();
  if (PIX_KEY_TYPE_ALIASES[lower]) return PIX_KEY_TYPE_ALIASES[lower];
  if ((PIX_KEY_TYPE_DB_VALUES as readonly string[]).includes(lower)) return lower as PixKeyTypeDb;
  throw new Error(
    `Tipo de chave PIX inválido: "${trimmed}". Use CPF, CNPJ, E-mail, Telefone ou Aleatória.`,
  );
}

export function formatPixKeyTypeLabel(type: string): string {
  try {
    switch (normalizePixKeyType(type)) {
      case "cpf":
        return "CPF";
      case "cnpj":
        return "CNPJ";
      case "email":
        return "E-mail";
      case "phone":
        return "Telefone";
      case "random":
        return "Aleatória";
      default:
        return type;
    }
  } catch {
    return type || "—";
  }
}

function supabasePixErrorMessage(error: { message?: string; details?: string; code?: string }): string {
  if (error.code === "23514" && String(error.message || "").includes("pix_key_type")) {
    return "Tipo de chave PIX inválido. Use CPF, CNPJ, E-mail, Telefone ou Aleatória.";
  }
  if (error.code === "PGRST204" && String(error.message || "").includes("pix_key_type")) {
    return "Tabela pix_keys desatualizada no Supabase (coluna pix_key_type). Execute a migration de chaves PIX.";
  }
  return error.message || "Erro ao salvar chave PIX";
}

export async function fetchPixKeysForClient(client: SupabaseClient) {
  try {
    const { data, error } = await client
      .from("pix_keys")
      .select("*")
      .eq("is_active", true)
      .order("bank_name", { ascending: true });

    if (error) throw error;

    return (data || []).map((p: Record<string, unknown>) => ({
      id: p.id,
      bank: p.bank_name || "—",
      type: (p.pix_key_type || p.key_type || "—") as string,
      key: p.pix_key || "",
      holder: p.account_holder || "",
    }));
  } catch {
    return [];
  }
}

export async function fetchPixKeys() {
  return fetchPixKeysForClient(supabase);
}

export type PixKeyInput = {
  bank_name: string;
  pix_key_type: string;
  pix_key: string;
  account_holder: string;
};

export async function insertPixKey(input: PixKeyInput) {
  const payload = {
    bank_name: input.bank_name.trim(),
    pix_key_type: normalizePixKeyType(input.pix_key_type),
    pix_key: input.pix_key.trim(),
    account_holder: input.account_holder.trim().slice(0, 100),
    is_active: true,
  };
  const { data, error } = await supabase.from("pix_keys").insert(payload).select("*").single();
  if (error) throw new Error(supabasePixErrorMessage(error));
  return data;
}

/** Soft delete (mantém histórico) */
export async function deactivatePixKey(id: string) {
  const { error } = await supabase.from("pix_keys").update({ is_active: false }).eq("id", id);
  if (error) throw error;
  return { ok: true };
}
