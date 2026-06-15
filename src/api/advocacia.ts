import { supabase } from "@/lib/supabase";
import { addCalendarDays, calendarDateInBrazil } from "@/lib/brazil-date";
import {
  computeOverdueDailyFineBrl,
  DAILY_OVERDUE_FINE_BRL,
  listOverdueFineCalendarDates,
} from "@/lib/loan-overdue-fine";
import { computeLoanRemainingFromData } from "./loan-calc";
import type { LoanForMessage } from "@/lib/whatsapp-messages";

export type AdvocaciaOverdueLoan = {
  id: string;
  client_id: string;
  loan: LoanForMessage;
  days_overdue: number;
  source: "loan" | "installment";
};

function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  if (![y1, m1, d1, y2, m2, d2].every(Number.isFinite)) return 0;
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.floor((b - a) / 86_400_000);
}

function buildLoanRow(
  row: Record<string, unknown>,
  client: { name: string; phone: string },
  paymentsByLoan: Record<string, Array<{ amount: unknown; payment_type?: unknown; fine_amount?: unknown }>>,
  waiverByLoan: Map<string, Set<string>>,
  today: string,
): LoanForMessage {
  const id = String(row.id);
  const due = String(row.due_date || "").split("T")[0];

  let rem: { capital: number; interestAmount: number; totalAmount: number; minimumPayment: number };
  try {
    rem = computeLoanRemainingFromData(
      {
        amount: row.amount,
        interest_rate: row.interest_rate,
        original_amount: row.original_amount,
      },
      paymentsByLoan[id] || [],
    );
  } catch {
    const amt = parseFloat(String(row.amount || 0));
    const rate = parseFloat(String(row.interest_rate || 0)) / 100;
    const interest = amt * rate;
    rem = {
      capital: amt,
      interestAmount: interest,
      totalAmount: amt + interest,
      minimumPayment: interest,
    };
  }

  const overdueDates = due < today ? listOverdueFineCalendarDates(due, today) : [];
  const waived = waiverByLoan.get(id) ?? new Set<string>();
  const fine = overdueDates.length > 0 ? computeOverdueDailyFineBrl(overdueDates, waived) : 0;

  return {
    client_name: client.name,
    client_phone: client.phone,
    amount: rem.totalAmount + fine,
    capital: rem.capital,
    interest: rem.interestAmount,
    fine,
    due_date: due,
    minimumPayment: rem.minimumPayment,
  };
}

/** Empréstimos vencidos há mais de 30 dias (exclui exatamente 30). */
export async function fetchAdvocaciaOverdueLoans(options?: {
  requirePhone?: boolean;
  minDaysOverdue?: number;
}): Promise<AdvocaciaOverdueLoan[]> {
  const requirePhone = options?.requirePhone !== false;
  const minDays = Math.max(1, options?.minDaysOverdue ?? 30);
  const today = calendarDateInBrazil();
  const maxDueDate = addCalendarDays(today, -minDays);

  const { data: loans, error } = await supabase
    .from("loans")
    .select("id, client_id, amount, interest_rate, due_date, status, original_amount")
    .in("status", ["active", "overdue", "partial_paid"])
    .lt("due_date", maxDueDate)
    .order("due_date", { ascending: true });

  if (error) throw error;

  const rows = (loans || []) as Record<string, unknown>[];
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

  const loanIds = rows.map((r) => String(r.id));
  const paymentsByLoan: Record<string, Array<{ amount: unknown; payment_type?: unknown; fine_amount?: unknown }>> = {};

  if (loanIds.length > 0) {
    const { data: payRows, error: payErr } = await supabase
      .from("payments")
      .select("loan_id, amount, payment_type, fine_amount, created_at")
      .in("loan_id", loanIds)
      .order("created_at", { ascending: true });
    if (payErr) throw payErr;
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
  }

  const waiverByLoan = new Map<string, Set<string>>();
  if (loanIds.length > 0) {
    try {
      const { data: waiverRows, error: wErr } = await supabase
        .from("loan_fine_waivers")
        .select("loan_id, waive_date")
        .in("loan_id", loanIds);
      if (!wErr && waiverRows) {
        for (const wr of waiverRows as Array<{ loan_id?: string; waive_date?: string }>) {
          const lid = String(wr.loan_id || "");
          const d = String(wr.waive_date || "").split("T")[0];
          if (!lid || !d) continue;
          if (!waiverByLoan.has(lid)) waiverByLoan.set(lid, new Set());
          waiverByLoan.get(lid)!.add(d);
        }
      }
    } catch {
      /* optional table */
    }
  }

  const result: AdvocaciaOverdueLoan[] = [];

  for (const r of rows) {
    const due = String(r.due_date || "").split("T")[0];
    if (!due || due >= maxDueDate) continue;

    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };
    if (requirePhone && !client.phone) continue;

    const daysOverdue = daysBetweenYmd(due, today);
    if (daysOverdue <= minDays) continue;

    result.push({
      id: String(r.id),
      client_id: String(r.client_id || ""),
      loan: buildLoanRow(r, client, paymentsByLoan, waiverByLoan, today),
      days_overdue: daysOverdue,
      source: "loan",
    });
  }

  const { data: installments, error: instErr } = await supabase
    .from("installments")
    .select(
      `
      id,
      client_id,
      clients (name, phone),
      installment_payments (id, status, due_date, amount)
    `,
    )
    .eq("status", "active");

  if (instErr) throw instErr;

  for (const inst of (installments || []) as Array<Record<string, unknown>>) {
    const payments = (inst.installment_payments as Array<Record<string, unknown>>) || [];
    const pending = payments
      .filter((p) => String(p.status || "") === "pending")
      .sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")));
    const next = pending[0];
    if (!next) continue;

    const due = String(next.due_date || "").split("T")[0];
    if (!due || due >= maxDueDate) continue;

    const daysOverdue = daysBetweenYmd(due, today);
    if (daysOverdue <= minDays) continue;

    const cl = (inst.clients as { name?: unknown; phone?: unknown }) || {};
    const clientName = String(cl.name || "—");
    const clientPhone = String(cl.phone || "").replace(/\D/g, "") ? String(cl.phone || "") : "";
    if (requirePhone && !clientPhone) continue;

    const amt = parseFloat(String(next.amount || 0));
    const instOverdue = due < today ? listOverdueFineCalendarDates(due, today) : [];
    const instFine = instOverdue.length > 0 ? instOverdue.length * DAILY_OVERDUE_FINE_BRL : 0;

    const instId = String(inst.id || "");
    const payId = String(next.id || "");

    result.push({
      id: `inst:${instId}:${payId}`,
      client_id: String(inst.client_id || ""),
      loan: {
        client_name: clientName,
        client_phone: clientPhone,
        amount: amt + instFine,
        capital: amt,
        interest: 0,
        fine: instFine,
        due_date: due,
        minimumPayment: amt,
      },
      days_overdue: daysOverdue,
      source: "installment",
    });
  }

  result.sort((a, b) => a.loan.due_date.localeCompare(b.loan.due_date));

  return result;
}
