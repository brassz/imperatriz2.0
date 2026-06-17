import { supabase } from "@/lib/supabase";
import { addCalendarDays, calendarDateInBrazil } from "@/lib/brazil-date";
import {
  computeOverdueDailyFineBrl,
  DAILY_OVERDUE_FINE_BRL,
  listOverdueFineCalendarDates,
} from "@/lib/loan-overdue-fine";
import { computeLoanRemainingFromData, effectiveLoanPrincipal, amortizationWaterfall, type AmortizationPayment } from "./loan-calc";
import type { LoanForMessage } from "@/lib/whatsapp-messages";

export type RenegotiationDebtDetails = {
  total_paid: number;
  /** Empréstimo */
  original_amount?: number;
  loan_amount?: number;
  interest_rate?: number;
  loan_date?: string;
  capital_remaining?: number;
  interest_remaining?: number;
  capital_paid?: number;
  interest_paid?: number;
  fines_paid?: number;
  /** Parcelamento */
  total_installments?: number;
  installment_amount?: number;
  first_due_date?: string;
  paid_installments?: number;
  pending_installments?: number;
  pending_amount?: number;
  linked_loan_id?: string | null;
};

export type AdvocaciaOverdueLoan = {
  id: string;
  client_id: string;
  loan: LoanForMessage;
  days_overdue: number;
  source: "loan" | "installment";
  details: RenegotiationDebtDetails;
};

function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  if (![y1, m1, d1, y2, m2, d2].every(Number.isFinite)) return 0;
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.floor((b - a) / 86_400_000);
}

function buildLoanPaymentDetails(
  row: Record<string, unknown>,
  payments: Array<{ amount: unknown; payment_type?: unknown; fine_amount?: unknown }>,
  rem: { capital: number; interestAmount: number; totalAmount: number },
): RenegotiationDebtDetails {
  const originalCapital = effectiveLoanPrincipal({
    original_amount: row.original_amount,
    amount: row.amount,
  });
  const interestRate = parseFloat(String(row.interest_rate || 0));
  const rows: AmortizationPayment[] = payments.map((p) => ({
    amount: parseFloat(String(p.amount || 0)),
    payment_type: String(p.payment_type || ""),
    fine_amount: parseFloat(String(p.fine_amount || 0)),
  }));
  const w = amortizationWaterfall(originalCapital, interestRate, rows);
  const finesPaid = rows.reduce((s, p) => s + (p.fine_amount || 0), 0);
  const paymentsSum = rows.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0);

  return {
    total_paid: paymentsSum + finesPaid,
    original_amount: originalCapital,
    loan_amount: parseFloat(String(row.amount || 0)),
    interest_rate: interestRate,
    loan_date: String(row.loan_date || "").split("T")[0],
    capital_remaining: rem.capital,
    interest_remaining: rem.interestAmount,
    capital_paid: w.capitalPaid,
    interest_paid: w.interestPaid,
    fines_paid: finesPaid,
  };
}

function buildLoanRow(
  row: Record<string, unknown>,
  client: { name: string; phone: string },
  paymentsByLoan: Record<string, Array<{ amount: unknown; payment_type?: unknown; fine_amount?: unknown }>>,
  waiverByLoan: Map<string, Set<string>>,
  today: string,
): { loan: LoanForMessage; details: RenegotiationDebtDetails } {
  const id = String(row.id);
  const due = String(row.due_date || "").split("T")[0];
  const loanPayments = paymentsByLoan[id] || [];

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
    loan: {
      client_name: client.name,
      client_phone: client.phone,
      amount: rem.totalAmount + fine,
      capital: rem.capital,
      interest: rem.interestAmount,
      fine,
      due_date: due,
      minimumPayment: rem.minimumPayment,
    },
    details: buildLoanPaymentDetails(row, loanPayments, rem),
  };
}

/** Empréstimos e parcelamentos vencidos há mais de N dias (padrão 30; Renegociações usa 60). */
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
    .select("id, client_id, amount, interest_rate, due_date, loan_date, status, original_amount")
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

    const built = buildLoanRow(r, client, paymentsByLoan, waiverByLoan, today);

    result.push({
      id: String(r.id),
      client_id: String(r.client_id || ""),
      loan: built.loan,
      details: built.details,
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
      total_amount,
      total_installments,
      installment_amount,
      first_due_date,
      loan_id,
      clients (name, phone),
      installment_payments (id, status, due_date, amount, paid_amount)
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
    const totalContract = parseFloat(String(inst.total_amount || 0));
    const pendingSum = pending.reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);
    const paidRows = payments.filter((p) => {
      const st = String(p.status || "");
      return st === "paid" || st === "partial";
    });
    const totalPaidInstallments = paidRows.reduce(
      (sum, p) => sum + parseFloat(String(p.paid_amount ?? p.amount ?? 0)),
      0,
    );
    let instFine = 0;
    for (const p of pending) {
      const pDue = String(p.due_date || "").split("T")[0];
      if (pDue && pDue < today) {
        instFine +=
          listOverdueFineCalendarDates(pDue, today).length * DAILY_OVERDUE_FINE_BRL;
      }
    }

    const instId = String(inst.id || "");
    const payId = String(next.id || "");

    result.push({
      id: `inst:${instId}:${payId}`,
      client_id: String(inst.client_id || ""),
      loan: {
        client_name: clientName,
        client_phone: clientPhone,
        amount: pendingSum + instFine,
        capital: totalContract > 0 ? totalContract : pendingSum,
        interest: 0,
        fine: instFine,
        due_date: due,
        minimumPayment: amt,
      },
      details: {
        total_paid: totalPaidInstallments,
        total_installments: Number(inst.total_installments || 0),
        installment_amount: parseFloat(String(inst.installment_amount || 0)),
        first_due_date: String(inst.first_due_date || "").split("T")[0],
        paid_installments: paidRows.length,
        pending_installments: pending.length,
        pending_amount: pendingSum,
        linked_loan_id: inst.loan_id ? String(inst.loan_id) : null,
      },
      days_overdue: daysOverdue,
      source: "installment",
    });
  }

  result.sort((a, b) => a.loan.due_date.localeCompare(b.loan.due_date));

  return result;
}
