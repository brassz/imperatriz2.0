import { supabase } from "@/lib/supabase";
import { calculateLoanRemaining } from "./loan-calc";
import type { LoanForMessage } from "@/lib/whatsapp-messages";

export type AutomationLoan = {
  id: string;
  type: "cobranca" | "lembrete_hoje" | "lembrete_amanha";
  loan: LoanForMessage;
};

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

export async function fetchLoansForAutomation(): Promise<AutomationLoan[]> {
  const today = todayStr();
  const tomorrow = tomorrowStr();

  const { data: loans, error } = await supabase
    .from("loans")
    .select("id, client_id, amount, interest_rate, due_date, status")
    .in("status", ["active", "overdue", "partial_paid"])
    .order("due_date", { ascending: true });

  if (error) throw error;

  const result: AutomationLoan[] = [];
  const clientIds = [...new Set((loans || []).map((l: Record<string, unknown>) => l.client_id).filter(Boolean))];

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, phone")
    .in("id", clientIds);
  const clientMap: Record<string, { name: string; phone: string }> = {};
  for (const c of clients || []) {
    const r = c as Record<string, unknown>;
    clientMap[String(r.id)] = {
      name: String(r.name || "—"),
      phone: String(r.phone || "").replace(/\D/g, "") ? String(r.phone || "") : "",
    };
  }

  for (const row of loans || []) {
    const r = row as Record<string, unknown>;
    const due = String(r.due_date || "").split("T")[0];
    if (!due) continue;

    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };
    if (!client.phone) continue;

    let rem: { capital: number; interestAmount: number; totalAmount: number; minimumPayment: number };
    try {
      rem = await calculateLoanRemaining(String(r.id));
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

    if (due < today) {
      result.push({ id: String(r.id), type: "cobranca", loan: loanForMsg });
    } else if (due === today) {
      result.push({ id: String(r.id), type: "lembrete_hoje", loan: loanForMsg });
    } else if (due === tomorrow) {
      result.push({ id: String(r.id), type: "lembrete_amanha", loan: loanForMsg });
    }
  }

  return result;
}
