import { supabase } from "@/lib/supabase";
import { buildUnaiWeeklyInstallments, type WeeklyInstallmentDraft } from "@/lib/unai-cred";

export type LoanWeeklyInstallment = {
  id: string;
  loan_id: string;
  week_number: number;
  due_date: string;
  amount: number;
  status: "pending" | "paid";
  paid_at: string | null;
  payment_id: string | null;
};

function mapRow(row: Record<string, unknown>): LoanWeeklyInstallment {
  return {
    id: String(row.id),
    loan_id: String(row.loan_id),
    week_number: Number(row.week_number || 0),
    due_date: String(row.due_date || "").split("T")[0],
    amount: parseFloat(String(row.amount || 0)),
    status: String(row.status || "pending") === "paid" ? "paid" : "pending",
    paid_at: row.paid_at ? String(row.paid_at) : null,
    payment_id: row.payment_id ? String(row.payment_id) : null,
  };
}

export async function fetchLoanWeeklyInstallments(loanId: string): Promise<LoanWeeklyInstallment[]> {
  const { data, error } = await supabase
    .from("loan_weekly_installments")
    .select("*")
    .eq("loan_id", loanId)
    .order("week_number", { ascending: true });

  if (error) {
    if (String(error.code) === "PGRST205" || String(error.message || "").includes("loan_weekly_installments")) {
      return [];
    }
    throw error;
  }
  return (data || []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function insertLoanWeeklyInstallments(
  loanId: string,
  rows: WeeklyInstallmentDraft[],
): Promise<LoanWeeklyInstallment[]> {
  const payload = rows.map((r) => ({
    loan_id: loanId,
    week_number: r.week_number,
    due_date: r.due_date,
    amount: r.amount,
    status: "pending",
  }));

  const { data, error } = await supabase.from("loan_weekly_installments").insert(payload).select("*");
  if (error) throw error;
  return (data || []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function createUnaiWeeklySchedule(
  loanId: string,
  product: "semanal_1" | "semanal_2",
  capital: number,
  interestRatePercent: number,
  loanDateYmd: string,
): Promise<LoanWeeklyInstallment[]> {
  const drafts = buildUnaiWeeklyInstallments(product, capital, interestRatePercent, loanDateYmd);
  return insertLoanWeeklyInstallments(loanId, drafts);
}

export async function markLoanWeeklyInstallmentPaid(
  installmentId: string,
  paymentId?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("loan_weekly_installments")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      payment_id: paymentId || null,
    })
    .eq("id", installmentId);

  if (error) throw error;
}
