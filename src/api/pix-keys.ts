import { supabase } from "@/lib/supabase";

export async function fetchPixKeys() {
  try {
    const { data, error } = await supabase
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

export type PixKeyInput = {
  bank_name: string;
  pix_key_type: string;
  pix_key: string;
  account_holder: string;
};

export async function insertPixKey(input: PixKeyInput) {
  const payload = {
    bank_name: input.bank_name.trim(),
    pix_key_type: input.pix_key_type.trim(),
    pix_key: input.pix_key.trim(),
    account_holder: input.account_holder.trim(),
    is_active: true,
  };
  const { data, error } = await supabase.from("pix_keys").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

/** Soft delete (mantém histórico) */
export async function deactivatePixKey(id: string) {
  const { error } = await supabase.from("pix_keys").update({ is_active: false }).eq("id", id);
  if (error) throw error;
  return { ok: true };
}
