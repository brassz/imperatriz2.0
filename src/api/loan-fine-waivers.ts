import { supabase } from "@/lib/supabase";

export async function fetchLoanFineWaivers(loanId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("loan_fine_waivers")
      .select("waive_date")
      .eq("loan_id", loanId);
    if (error) throw error;
    return (data || []).map((r: { waive_date?: string }) => String(r.waive_date || "").split("T")[0]).filter(Boolean);
  } catch {
    return [];
  }
}

/** Registra anulações (uma linha por dia). Ignora duplicatas (unique). */
export async function insertLoanFineWaivers(loanId: string, waiveDatesYmd: string[]): Promise<void> {
  const unique = [...new Set(waiveDatesYmd.map((d) => String(d).split("T")[0]).filter(Boolean))];
  for (const waive_date of unique) {
    const { error } = await supabase.from("loan_fine_waivers").insert({ loan_id: loanId, waive_date });
    if (error) {
      const code = String((error as { code?: string }).code || "");
      if (code === "23505") continue;
      throw error;
    }
  }
}
