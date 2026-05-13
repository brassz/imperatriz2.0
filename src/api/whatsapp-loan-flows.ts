import { supabase } from "@/lib/supabase";

export type WhatsappLoanFlowRow = {
  id: number;
  instance_id: string;
  remote_jid: string;
  remote_phone: string;
  status: string;
  step: string;
  draft_payload: Record<string, unknown> | null;
  created_client_id?: string | null;
  created_loan_id?: string | null;
  last_message_at: string;
  last_error?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at?: string;
};

function normalizePhoneDigits(input: unknown): string {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  return digits;
}

export async function fetchActiveWhatsappLoanFlowByPhone(phone: string, instanceId?: string): Promise<WhatsappLoanFlowRow | null> {
  const target = normalizePhoneDigits(phone);
  if (!target) return null;

  try {
    let query = supabase
      .from("whatsapp_loan_flows")
      .select("*")
      .eq("status", "active")
      .order("last_message_at", { ascending: false })
      .limit(50);

    if (String(instanceId || "").trim()) {
      query = query.eq("instance_id", String(instanceId).trim());
    }

    const { data, error } = await query;
    if (error) throw error;

    return ((data || []) as WhatsappLoanFlowRow[]).find((row) => {
      const digits = normalizePhoneDigits(row.remote_phone || row.remote_jid);
      return digits === target || digits.endsWith(target) || target.endsWith(digits);
    }) ?? null;
  } catch {
    return null;
  }
}
