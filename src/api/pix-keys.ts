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
