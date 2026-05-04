import { supabase } from "@/lib/supabase";
import { calendarDateInBrazil } from "@/lib/brazil-date";
import {
  computeOverdueDailyFineBrl,
  listOverdueFineCalendarDates,
} from "@/lib/loan-overdue-fine";

/** Tipos de pagamento que não abatem principal (só juros / renovação). */
export const INTEREST_ONLY_TYPES: string[] = [
  "renewal",
  "interest_renewal",
  "early_payment_partial_interest",
  "early_payment_interest_renewal",
  "partial_interest",
];

/** Renovação "somente capital": abate direto do principal, sem priorizar juros da parcela. */
const PRINCIPAL_ONLY_TYPES = new Set(["capital_renewal"]);

export type AmortizationPayment = { amount: number; payment_type: string; fine_amount?: number };

/**
 * Capital base para amortização: `original_amount` quando > 0; caso contrário `amount`.
 * Evita valor restante zerado quando o banco tem `original_amount = 0` mas `amount` correto.
 */
export function effectiveLoanPrincipal(loan: { original_amount?: unknown; amount?: unknown }): number {
  const orig = parseFloat(String(loan.original_amount ?? ""));
  if (Number.isFinite(orig) && orig > 0) return orig;
  const amt = parseFloat(String(loan.amount ?? 0));
  return Number.isFinite(amt) && amt >= 0 ? amt : 0;
}

/**
 * Rateio juros/capital na ordem dos pagamentos (mesma regra de {@link amortizationWaterfall}).
 * Linhas com `amount <= 0` retornam zeros e não alteram o saldo.
 */
export function allocateWaterfallPerPayment(
  originalCapitalRaw: number,
  interestRateRaw: number,
  payments: AmortizationPayment[],
): Array<{ interest: number; capital: number }> {
  let rate = interestRateRaw;
  if (rate > 100) rate = rate / 100;
  const originalCapital = Math.max(0, originalCapitalRaw);
  let currentCapital = originalCapital;
  const out: Array<{ interest: number; capital: number }> = [];

  for (const payment of payments) {
    const amt = payment.amount;
    const type = String(payment.payment_type || "");
    if (!(amt > 0)) {
      out.push({ interest: 0, capital: 0 });
      continue;
    }
    if (INTEREST_ONLY_TYPES.includes(type)) {
      out.push({ interest: amt, capital: 0 });
      continue;
    }
    if (PRINCIPAL_ONLY_TYPES.has(type)) {
      out.push({ interest: 0, capital: amt });
      currentCapital = Math.max(0, currentCapital - amt);
      continue;
    }

    const currentInterest = currentCapital * (rate / 100);
    if (amt > currentInterest) {
      const capitalReduction = amt - currentInterest;
      out.push({ interest: currentInterest, capital: capitalReduction });
      currentCapital = Math.max(0, currentCapital - capitalReduction);
    } else {
      out.push({ interest: amt, capital: 0 });
    }
  }

  return out;
}

/**
 * Mesma regra do sistema antigo: capital base = valor original do contrato; juros só capital;
 * `interest_renewal` etc. não abatem principal; `capital_renewal` abate só principal.
 */
export function amortizationWaterfall(
  originalCapitalRaw: number,
  interestRateRaw: number,
  payments: AmortizationPayment[],
): {
  remainingCapital: number;
  remainingInterest: number;
  remainingAmount: number;
  capitalPaid: number;
  interestPaid: number;
} {
  let rate = interestRateRaw;
  if (rate > 100) rate = rate / 100;
  const originalCapital = Math.max(0, originalCapitalRaw);

  const parts = allocateWaterfallPerPayment(originalCapitalRaw, interestRateRaw, payments);
  let capitalPaid = 0;
  let interestPaid = 0;
  for (const p of parts) {
    capitalPaid += p.capital;
    interestPaid += p.interest;
  }

  const remainingCapital = Math.max(0, originalCapital - capitalPaid);
  const remainingInterest = remainingCapital * (rate / 100);
  const remainingAmount = remainingCapital + remainingInterest;

  return {
    remainingCapital,
    remainingInterest,
    remainingAmount,
    capitalPaid,
    interestPaid,
  };
}

/** Valor total restante (principal + juros sobre o saldo) — usado na listagem de empréstimos. */
export function computeLoanRemainingTotal(
  originalCapital: number,
  interestRate: number,
  payments: AmortizationPayment[],
): number {
  return amortizationWaterfall(originalCapital, interestRate, payments).remainingAmount;
}

export type LoanRemainingResult = {
  capital: number;
  interestRate: number;
  interestAmount: number;
  totalAmount: number;
  remainingAmount: number;
  minimumPayment: number;
  capitalPaid: number;
  interestPaid: number;
  finesPaid: number;
  totalPaid: number;
  /** Multa diária de atraso (R$ 50/dia civil) ainda não anulada. */
  overdueDailyFineOwed: number;
};

export async function calculateLoanRemaining(loanId: string): Promise<LoanRemainingResult> {
  const { data: loan, error: loanErr } = await supabase
    .from("loans")
    .select("amount, original_amount, interest_rate, loan_date, due_date, status")
    .eq("id", loanId)
    .single();

  if (loanErr || !loan) throw loanErr || new Error("Empréstimo não encontrado");

  const originalCapital = effectiveLoanPrincipal(loan as { original_amount?: unknown; amount?: unknown });
  let interestRate = parseFloat(String(loan.interest_rate || 0));
  const interestRateForResult = interestRate > 100 ? interestRate / 100 : interestRate;
  const status = String((loan as { status?: string }).status || "active").toLowerCase();
  const settled = status === "paid" || status === "finalized" || status === "cancelled";

  const { data: payments } = await supabase
    .from("payments")
    .select("amount, payment_type, fine_amount")
    .eq("loan_id", loanId)
    .order("created_at", { ascending: true });

  const rows: AmortizationPayment[] = (payments || []).map((p) => ({
    amount: parseFloat(String(p.amount || 0)),
    payment_type: String((p as { payment_type?: string }).payment_type || ""),
    fine_amount: parseFloat(String((p as { fine_amount?: number }).fine_amount || 0)),
  }));

  const totalFinesPaid = rows.reduce((s, p) => s + (p.fine_amount || 0), 0);
  const realPayments = rows.filter((p) => p.amount > 0);
  const totalPaid = realPayments.reduce((s, p) => s + p.amount, 0) + totalFinesPaid;

  const w = amortizationWaterfall(originalCapital, interestRate, rows);

  let overdueDailyFineOwed = 0;
  if (!settled) {
    const due = String((loan as { due_date?: string }).due_date || "").split("T")[0];
    const today = calendarDateInBrazil();
    const overdueDates = listOverdueFineCalendarDates(due, today);
    if (overdueDates.length > 0) {
      try {
        const { data: waiverRows, error: wErr } = await supabase
          .from("loan_fine_waivers")
          .select("waive_date")
          .eq("loan_id", loanId);
        if (!wErr && waiverRows) {
          const waived = (waiverRows as Array<{ waive_date?: string }>).map((r) =>
            String(r.waive_date || "").split("T")[0],
          );
          overdueDailyFineOwed = computeOverdueDailyFineBrl(overdueDates, waived);
        } else {
          overdueDailyFineOwed = computeOverdueDailyFineBrl(overdueDates, []);
        }
      } catch {
        overdueDailyFineOwed = computeOverdueDailyFineBrl(overdueDates, []);
      }
    }
  }

  return {
    capital: w.remainingCapital,
    interestRate: interestRateForResult,
    interestAmount: w.remainingInterest,
    totalAmount: w.remainingAmount,
    remainingAmount: w.remainingAmount,
    minimumPayment: w.remainingInterest,
    capitalPaid: w.capitalPaid,
    interestPaid: w.interestPaid,
    finesPaid: totalFinesPaid,
    totalPaid,
    overdueDailyFineOwed,
  };
}

export type PaymentRowInput = {
  amount: unknown;
  payment_type?: unknown;
  fine_amount?: unknown;
};

/**
 * Mesma lógica de {@link calculateLoanRemaining}, sem I/O — para lote (WhatsApp / automação).
 */
export function computeLoanRemainingFromData(
  loan: { amount?: unknown; interest_rate?: unknown; original_amount?: unknown },
  payments: PaymentRowInput[],
): Pick<LoanRemainingResult, "capital" | "interestAmount" | "totalAmount" | "minimumPayment"> {
  const originalCapital = effectiveLoanPrincipal(loan);
  const interestRate = parseFloat(String(loan.interest_rate || 0));

  const rows: AmortizationPayment[] = payments.map((p) => ({
    amount: parseFloat(String(p.amount || 0)),
    payment_type: String(p.payment_type || ""),
    fine_amount: parseFloat(String(p.fine_amount || 0)),
  }));

  const w = amortizationWaterfall(originalCapital, interestRate, rows);

  return {
    capital: w.remainingCapital,
    interestAmount: w.remainingInterest,
    totalAmount: w.remainingAmount,
    minimumPayment: w.remainingInterest,
  };
}

export function calculateNextDueDate(currentDueDate: string, termDays: number): string {
  const d = new Date(String(currentDueDate).split("T")[0]);
  d.setDate(d.getDate() + termDays);
  return d.toISOString().split("T")[0];
}
