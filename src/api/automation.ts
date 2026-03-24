import { supabase } from "@/lib/supabase";
import { calendarDateInBrazil, tomorrowCalendarDateBrazil } from "@/lib/brazil-date";
import { computeLoanRemainingFromData } from "./loan-calc";
import type { LoanForMessage } from "@/lib/whatsapp-messages";

export type AutomationLoan = {
  id: string;
  client_id: string;
  type: "cobranca" | "lembrete_hoje" | "lembrete_amanha";
  loan: LoanForMessage;
};

export type FetchLoansForAutomationOptions = {
  /** Padrão true: só entra na fila de envio quem tem telefone. False: inclui na prévia (Config. WhatsApp). */
  requirePhone?: boolean;
};

/**
 * Lista empréstimos elegíveis para cobrança/lembrete (vencido, hoje, amanhã).
 * Otimizado: filtra `due_date` no SQL; um único fetch de pagamentos; cálculo em memória
 * (evita N×2 round-trips do `calculateLoanRemaining` por empréstimo).
 */
export async function fetchLoansForAutomation(
  options?: FetchLoansForAutomationOptions,
): Promise<AutomationLoan[]> {
  const requirePhone = options?.requirePhone !== false;
  const today = calendarDateInBrazil();
  const tomorrow = tomorrowCalendarDateBrazil();

  const { data: loans, error } = await supabase
    .from("loans")
    .select("id, client_id, amount, interest_rate, due_date, status, original_amount")
    .in("status", ["active", "overdue", "partial_paid"])
    .lte("due_date", tomorrow)
    .order("due_date", { ascending: true });

  if (error) throw error;

  const rows = (loans || []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const clientIds = [...new Set(rows.map((l) => String(l.client_id || "")).filter(Boolean))];

  const { data: clients } = await supabase.from("clients").select("id, name, phone").in("id", clientIds);
  const clientMap: Record<string, { name: string; phone: string }> = {};
  for (const c of clients || []) {
    const r = c as Record<string, unknown>;
    clientMap[String(r.id)] = {
      name: String(r.name || "—"),
      phone: String(r.phone || "").replace(/\D/g, "") ? String(r.phone || "") : "",
    };
  }

  const candidates: Array<{ row: Record<string, unknown>; type: AutomationLoan["type"] }> = [];
  for (const r of rows) {
    const due = String(r.due_date || "").split("T")[0];
    if (!due) continue;

    let type: AutomationLoan["type"] | null = null;
    if (due < today) type = "cobranca";
    else if (due === today) type = "lembrete_hoje";
    else if (due === tomorrow) type = "lembrete_amanha";
    else continue;

    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };
    if (requirePhone && !client.phone) continue;

    candidates.push({ row: r, type });
  }

  if (candidates.length === 0) return [];

  const loanIds = candidates.map((c) => String(c.row.id));

  const { data: payRows, error: payErr } = await supabase
    .from("payments")
    .select("loan_id, amount, payment_type, fine_amount, created_at")
    .in("loan_id", loanIds)
    .order("created_at", { ascending: true });

  if (payErr) throw payErr;

  const paymentsByLoan: Record<string, Array<{ amount: unknown; payment_type?: unknown; fine_amount?: unknown }>> = {};
  for (const p of payRows || []) {
    const pr = p as Record<string, unknown>;
    const lid = String(pr.loan_id || "");
    if (!lid) continue;
    if (!paymentsByLoan[lid]) paymentsByLoan[lid] = [];
    paymentsByLoan[lid].push({
      amount: pr.amount,
      payment_type: pr.payment_type,
      fine_amount: pr.fine_amount,
    });
  }

  const result: AutomationLoan[] = [];

  for (const { row: r, type } of candidates) {
    const id = String(r.id);
    const due = String(r.due_date || "").split("T")[0];
    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };

    let rem: { capital: number; interestAmount: number; totalAmount: number; minimumPayment: number };
    try {
      rem = computeLoanRemainingFromData(
        {
          amount: r.amount,
          interest_rate: r.interest_rate,
          original_amount: r.original_amount,
        },
        paymentsByLoan[id] || [],
      );
    } catch {
      const amt = parseFloat(String(r.amount || 0));
      const rate = parseFloat(String(r.interest_rate || 0)) / 100;
      const interest = amt * rate;
      rem = {
        capital: amt,
        interestAmount: interest,
        totalAmount: amt + interest,
        minimumPayment: interest,
      };
    }

    const loanForMsg: LoanForMessage = {
      client_name: client.name,
      client_phone: client.phone,
      amount: rem.totalAmount,
      capital: rem.capital,
      interest: rem.interestAmount,
      fine: 0,
      due_date: due,
      minimumPayment: rem.minimumPayment,
    };

    result.push({
      id,
      client_id: String(r.client_id || ""),
      type,
      loan: loanForMsg,
    });
  }

  return result;
}
