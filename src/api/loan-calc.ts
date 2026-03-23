import { supabase } from "@/lib/supabase";

const INTEREST_ONLY_TYPES = [
  "renewal",
  "interest_renewal",
  "early_payment_partial_interest",
  "early_payment_interest_renewal",
  "partial_interest",
];

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
};

export async function calculateLoanRemaining(loanId: string): Promise<LoanRemainingResult> {
  const { data: loan, error: loanErr } = await supabase
    .from("loans")
    .select("amount, interest_rate, loan_date, due_date")
    .eq("id", loanId)
    .single();

  if (loanErr || !loan) throw loanErr || new Error("Empréstimo não encontrado");

  const originalCapital = parseFloat(String((loan as { original_amount?: number }).original_amount || loan.amount || 0));
  let interestRate = parseFloat(String(loan.interest_rate || 0));
  if (interestRate > 100) interestRate = interestRate / 100;

  const { data: payments } = await supabase
    .from("payments")
    .select("amount, payment_type, fine_amount")
    .eq("loan_id", loanId)
    .order("created_at", { ascending: true });

  const realPayments = (payments || []).filter((p) => parseFloat(String(p.amount || 0)) > 0);

  let capitalPaid = 0;
  let interestPaid = 0;
  let currentCapital = originalCapital;
  const totalFinesPaid = realPayments.reduce(
    (s, p) => s + parseFloat(String((p as { fine_amount?: number }).fine_amount || 0)),
    0
  );

  for (const payment of realPayments) {
    const amt = parseFloat(String(payment.amount || 0));
    const type = String((payment as { payment_type?: string }).payment_type || "");

    if (INTEREST_ONLY_TYPES.includes(type)) {
      interestPaid += amt;
    } else {
      const currentInterest = currentCapital * (interestRate / 100);
      if (amt > currentInterest) {
        interestPaid += currentInterest;
        const capitalReduction = amt - currentInterest;
        capitalPaid += capitalReduction;
        currentCapital = Math.max(0, currentCapital - capitalReduction);
      } else {
        interestPaid += amt;
      }
    }
  }

  const remainingCapital = Math.max(0, originalCapital - capitalPaid);
  const remainingInterest = remainingCapital * (interestRate / 100);
  const remainingAmount = remainingCapital + remainingInterest;
  const minimumPayment = remainingInterest;
  const totalPaid = realPayments.reduce((s, p) => s + parseFloat(String(p.amount || 0)), 0) + totalFinesPaid;

  return {
    capital: remainingCapital,
    interestRate,
    interestAmount: remainingInterest,
    totalAmount: remainingAmount,
    remainingAmount,
    minimumPayment,
    capitalPaid,
    interestPaid,
    finesPaid: totalFinesPaid,
    totalPaid,
  };
}

export function calculateNextDueDate(currentDueDate: string, termDays: number): string {
  const d = new Date(String(currentDueDate).split("T")[0]);
  d.setDate(d.getDate() + termDays);
  return d.toISOString().split("T")[0];
}
