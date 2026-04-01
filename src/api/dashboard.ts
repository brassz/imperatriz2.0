import { supabase } from "@/lib/supabase";

const INTEREST_ONLY_TYPES = [
  "renewal",
  "interest_renewal",
  "early_payment_partial_interest",
  "early_payment_interest_renewal",
  "partial_interest",
];

function computeLoanRemaining(
  originalCapital: number,
  interestRate: number,
  payments: Array<{ amount: number; payment_type: string; fine_amount: number }>
) {
  let interestRateNorm = interestRate;
  if (interestRateNorm > 100) interestRateNorm = interestRateNorm / 100;

  const realPayments = payments.filter((p) => p.amount > 0);
  let capitalPaid = 0;
  let currentCapital = originalCapital;

  for (const payment of realPayments) {
    const amt = payment.amount;
    const type = String(payment.payment_type || "");

    if (INTEREST_ONLY_TYPES.includes(type)) {
      // interest only
    } else {
      const currentInterest = currentCapital * (interestRateNorm / 100);
      if (amt > currentInterest) {
        const capitalReduction = amt - currentInterest;
        capitalPaid += capitalReduction;
        currentCapital = Math.max(0, currentCapital - capitalReduction);
      }
    }
  }

  const remainingCapital = Math.max(0, originalCapital - capitalPaid);
  const remainingInterest = remainingCapital * (interestRateNorm / 100);
  const remainingAmount = remainingCapital + remainingInterest;

  return { remainingCapital, remainingInterest, remainingAmount };
}

export async function fetchDashboardMetrics() {
  // Importante: a dashboard não pode “zerar tudo” só porque UMA tabela não existe em algum ambiente.
  // Por isso, cada bloco é tolerante a erro e o cálculo segue com o que der para obter.

  const clientsCount = await (async () => {
    try {
      const { count } = await supabase.from("clients").select("id", { count: "exact", head: true });
      return count ?? 0;
    } catch {
      return 0;
    }
  })();

  const loansData = await (async () => {
    try {
      const { data, error } = await supabase
        .from("loans")
        .select("id, amount, interest_rate, status, due_date")
        .in("status", ["active", "partial_paid", "overdue"]);
      if (error) throw error;
      return (data || []) as Array<Record<string, unknown>>;
    } catch {
      return [] as Array<Record<string, unknown>>;
    }
  })();

  const activeLoansCount = await (async () => {
    try {
      const { count } = await supabase
        .from("loans")
        .select("id", { count: "exact", head: true })
        .in("status", ["active", "partial_paid"]);
      return count ?? 0;
    } catch {
      return 0;
    }
  })();

  const paidLoansData = await (async () => {
    try {
      const { data, error } = await supabase.from("paid_loans").select("loan_id, original_amount");
      if (error) throw error;
      return (data || []) as Array<Record<string, unknown>>;
    } catch {
      return [] as Array<Record<string, unknown>>;
    }
  })();

  const activeLoans = (loansData || []) as Array<{
    id: string;
    amount: number;
    interest_rate: number;
    status: string;
    due_date?: string;
  }>;
  const paidLoanIds = new Set(paidLoansData.map((p) => String(p.loan_id)).filter(Boolean));
  const paidLoansCount = paidLoanIds.size;

  const today = new Date();
  const todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  function isOverdueByDueDate(dueDate: string | undefined): boolean {
    if (!dueDate) return false;
    const due = new Date(String(dueDate).split("T")[0]);
    const dueNorm = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    return dueNorm.getTime() < todayNorm.getTime();
  }

  // Juros Restante, Total Restante, Empréstimos Vencidos (valor)
  let jurosRestante = 0;
  let totalRestante = 0;
  let vencidosValor = 0;

  if (activeLoans.length > 0) {
    const loanIds = activeLoans.map((l) => l.id);
    // Evita erro/performance ruim com `.in("loan_id", [...muitos])` (pode estourar limites).
    const paymentsData: Array<Record<string, unknown>> = [];
    const CHUNK = 200;
    for (let i = 0; i < loanIds.length; i += CHUNK) {
      const chunk = loanIds.slice(i, i + CHUNK);
      const { data } = await supabase
        .from("payments")
        .select("loan_id, amount, payment_type, fine_amount")
        .in("loan_id", chunk)
        .order("created_at", { ascending: true });
      if (data?.length) paymentsData.push(...(data as Array<Record<string, unknown>>));
    }

    const paymentsByLoan: Record<string, Array<{ amount: number; payment_type: string; fine_amount: number }>> = {};
    for (const p of paymentsData || []) {
      const row = p as { loan_id: string; amount: number; payment_type: string; fine_amount?: number };
      if (!paymentsByLoan[row.loan_id]) paymentsByLoan[row.loan_id] = [];
      paymentsByLoan[row.loan_id].push({
        amount: parseFloat(String(row.amount || 0)),
        payment_type: String(row.payment_type || ""),
        fine_amount: parseFloat(String(row.fine_amount || 0)),
      });
    }

    for (const loan of activeLoans) {
      const originalCapital = parseFloat(String(loan.amount || 0));
      const rate = parseFloat(String(loan.interest_rate || 0));
      const payments = paymentsByLoan[loan.id] || [];
      const { remainingInterest, remainingAmount } = computeLoanRemaining(
        originalCapital,
        rate,
        payments
      );
      jurosRestante += remainingInterest;
      totalRestante += remainingAmount;
      // Vencido: por status OU por due_date (igual ao sistema antigo - getLoanStatusFromDueDate)
      if (loan.status === "overdue" || isOverdueByDueDate(loan.due_date)) {
        vencidosValor += remainingAmount;
      }
    }
  }

  // OBS: não usar view `overdue_loans` aqui. Em alguns ambientes ela não existe/colunas divergem e gera 400 no PostgREST.

  // Empréstimos Quitados (valor): soma do capital original dos quitados
  const totalQuitadosValor = (paidLoansData || []).reduce(
    (s: number, p: Record<string, unknown>) =>
      s + parseFloat(String((p as { original_amount?: number }).original_amount || 0)),
    0
  );

  // Parcelamentos: soma dos valores pendentes e contagem
  let parcelamentosTotal = 0;
  let parcelamentosCount = 0;
  let parcelamentosAtrasadosValor = 0;
  try {
    const todayStr = new Date().toISOString().split("T")[0];
    const { data: installmentsData } = await supabase
      .from("installments")
      .select("id, installment_payments(amount, status, due_date)")
      .eq("status", "active");

    parcelamentosCount = (installmentsData || []).length;
    for (const inst of installmentsData || []) {
      const payments = (inst as { installment_payments?: Array<{ amount: number; status: string; due_date?: string }> }).installment_payments || [];
      for (const p of payments) {
        if (p.status === "pending") {
          parcelamentosTotal += parseFloat(String(p.amount || 0));
          const due = String(p.due_date || "").split("T")[0];
          if (due && due < todayStr) {
            parcelamentosAtrasadosValor += parseFloat(String(p.amount || 0));
          }
        }
      }
    }
  } catch {
    parcelamentosTotal = 0;
    parcelamentosCount = 0;
    parcelamentosAtrasadosValor = 0;
  }

  // Total Emprestado: capital (ativos) + capital dos parcelamentos
  const totalCapitalAtivo = activeLoans.reduce((s, l) => s + parseFloat(String(l.amount || 0)), 0);
  const totalLoaned = totalCapitalAtivo + parcelamentosTotal;

  let cashBalance = 0;
  try {
    const { data: cashData } = await supabase
      .from("cash_settings")
      .select("current_balance")
      .limit(1)
      .single();
    cashBalance = parseFloat(String(cashData?.current_balance || 0));
  } catch {
    // tabela pode não existir
  }

  // Totais via views (1 linha) — PostgREST aceita bem e é rápido.
  const totalReceived = await (async () => {
    try {
      const { data, error } = await supabase
        .from("dashboard_payments_totals")
        .select("total_received")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return parseFloat(String((data as { total_received?: unknown } | null)?.total_received || 0)) || 0;
    } catch {
      return 0;
    }
  })();

  const expensesTotal = await (async () => {
    try {
      const { data, error } = await supabase
        .from("dashboard_expenses_totals")
        .select("expenses_total")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return parseFloat(String((data as { expenses_total?: unknown } | null)?.expenses_total || 0)) || 0;
    } catch {
      return 0;
    }
  })();

  // Contagens por status (excluindo paid_loans)
  const activeLoansFiltered = (loansData || []).filter(
    (l: { id: string; status?: string }) =>
      ["active", "partial_paid", "overdue"].includes(String(l.status || "")) && !paidLoanIds.has(String(l.id))
  );
  const ativosCount = activeLoansFiltered.filter((l: { status?: string }) => l.status === "active").length;
  const partialPaidCount = activeLoansFiltered.filter((l: { status?: string }) => l.status === "partial_paid").length;
  const vencidosCount = activeLoansFiltered.filter(
    (l: { status?: string; due_date?: string }) => l.status === "overdue" || isOverdueByDueDate(l.due_date)
  ).length;

  return {
    clientsCount: clientsCount ?? 0,
    totalLoaned,
    jurosRestante,
    totalRestante,
    activeLoans: ativosCount + partialPaidCount + parcelamentosCount,
    ativosCount,
    partialPaidCount,
    vencidosCount,
    parcelamentosCount,
    paidLoansCount: paidLoansCount ?? 0,
    parcelamentosTotal,
    parcelamentosAtrasadosValor,
    paidLoansValor: totalQuitadosValor,
    cashBalance,
    overdueLoansCount: vencidosCount,
    vencidosValor,
    totalReceived,
    expensesTotal,
    commissions: 0,
  };
}

export type ChartDataPoint = {
  mes: string;
  emprestimos: number;
  pagamentos: number;
  despesas: number;
  fluxo: number;
  multas: number;
  juros: number; // lucro por juros (interesse recebido)
};

export async function fetchDashboardChartData(months = 6): Promise<ChartDataPoint[]> {
  const today = new Date();
  const points: ChartDataPoint[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    points.push({ mes: label, emprestimos: 0, pagamentos: 0, despesas: 0, fluxo: 0, multas: 0, juros: 0 });
  }

  const firstDate = new Date(today.getFullYear(), today.getMonth() - months, 1);
  const firstDateStr = firstDate.toISOString().split("T")[0];

  const [loansRes, paymentsRes, finesRes] = await Promise.all([
    supabase
      .from("loans")
      .select("id, amount, interest_rate, loan_date")
      .gte("loan_date", firstDateStr),
    supabase
      .from("payments")
      .select("loan_id, amount, payment_date, payment_type, fine_amount, created_at")
      .limit(10000),
    supabase
      .from("client_fines")
      .select("amount, created_at")
      .gte("created_at", `${firstDateStr}T00:00:00`),
  ]);

  const expenses = await (async () => {
    const filterCancelled = (rows: Array<{ expense_date?: string; status?: string }>) =>
      rows.filter((e) => {
        const d = String(e.expense_date || "").split("T")[0];
        if (d < firstDateStr) return false;
        return String(e.status || "") !== "cancelled";
      });

    let { data, error } = await supabase
      .from("expenses")
      .select("amount, expense_date, status")
      .gte("expense_date", firstDateStr);
    if (!error && data) return filterCancelled(data);

    ({ data, error } = await supabase
      .from("expenses")
      .select("amount, expense_date")
      .gte("expense_date", firstDateStr));
    if (!error && data) return data;

    ({ data, error } = await supabase.from("expenses").select("amount, expense_date, status").limit(10000));
    if (!error && data) return filterCancelled(data);

    ({ data, error } = await supabase.from("expenses").select("amount, expense_date").limit(10000));
    if (!error && data) return filterCancelled(data);

    return [];
  })();

  const loans = loansRes.data || [];
  const payments = paymentsRes.data || [];
  const fines = finesRes.data || [];

  const loanIdsWithPaymentsInRange = new Set<string>();
  for (const p of payments) {
    const dateStr = String((p as { payment_date?: string }).payment_date || (p as { created_at?: string }).created_at || "").split("T")[0];
    if (dateStr && dateStr >= firstDateStr) loanIdsWithPaymentsInRange.add(String((p as { loan_id?: string }).loan_id || ""));
  }

  const allLoansForJuros = await (async () => {
    if (loanIdsWithPaymentsInRange.size === 0) return [];
    const { data } = await supabase.from("loans").select("id, amount, interest_rate").in("id", Array.from(loanIdsWithPaymentsInRange));
    return data || [];
  })();

  const allPaymentsForJuros = await (async () => {
    if (allLoansForJuros.length === 0) return [];
    const ids = allLoansForJuros.map((l: Record<string, unknown>) => l.id);
    const { data } = await supabase
      .from("payments")
      .select("loan_id, amount, payment_type, payment_date, created_at")
      .in("loan_id", ids)
      .order("created_at", { ascending: true });
    return data || [];
  })();

  const getMonthIndex = (dateStr: string) => {
    const d = new Date(String(dateStr).split("T")[0]);
    const y = d.getFullYear();
    const m = d.getMonth();
    for (let i = 0; i < points.length; i++) {
      const pd = new Date(today.getFullYear(), today.getMonth() - (months - 1 - i), 1);
      if (pd.getFullYear() === y && pd.getMonth() === m) return i;
    }
    return -1;
  };

  for (const l of loans) {
    const amt = parseFloat(String(l.amount || 0));
    const dateStr = String((l as { loan_date?: string }).loan_date || "").split("T")[0];
    const idx = getMonthIndex(dateStr);
    if (idx >= 0) points[idx].emprestimos += amt;
  }

  const cutoffTime = firstDate.getTime();
  for (const p of payments) {
    const amt = parseFloat(String(p.amount || 0)) + parseFloat(String((p as { fine_amount?: number }).fine_amount || 0));
    const dateStr = String((p as { payment_date?: string }).payment_date || (p as { created_at?: string }).created_at || "").split("T")[0];
    if (!dateStr) continue;
    const d = new Date(dateStr + "T12:00:00");
    if (d.getTime() < cutoffTime) continue;
    const y = d.getFullYear();
    const m = d.getMonth();
    for (let i = 0; i < points.length; i++) {
      const pd = new Date(today.getFullYear(), today.getMonth() - (months - 1 - i), 1);
      if (pd.getFullYear() === y && pd.getMonth() === m) {
        points[i].pagamentos += amt;
        break;
      }
    }
  }

  for (const e of expenses) {
    const amt = parseFloat(String(e.amount || 0));
    const dateStr = String((e as { expense_date?: string }).expense_date || "").split("T")[0];
    const idx = getMonthIndex(dateStr);
    if (idx >= 0) points[idx].despesas += amt;
  }

  for (const f of fines) {
    const amt = parseFloat(String(f.amount || 0));
    const dateStr = String((f as { created_at?: string }).created_at || "").split("T")[0];
    const idx = getMonthIndex(dateStr);
    if (idx >= 0) points[idx].multas += amt;
  }

  const paymentsByLoan: Record<string, Array<{ amount: number; payment_type: string; dateStr: string }>> = {};
  for (const p of allPaymentsForJuros) {
    const loanId = String((p as { loan_id?: string }).loan_id || "");
    if (!paymentsByLoan[loanId]) paymentsByLoan[loanId] = [];
    paymentsByLoan[loanId].push({
      amount: parseFloat(String(p.amount || 0)),
      payment_type: String((p as { payment_type?: string }).payment_type || ""),
      dateStr: String((p as { payment_date?: string }).payment_date || (p as { created_at?: string }).created_at || "").split("T")[0],
    });
  }

  for (const loan of allLoansForJuros) {
    const rate = parseFloat(String(loan.interest_rate || 0));
    const rateNorm = rate > 100 ? rate / 100 : rate;
    let currentCapital = parseFloat(String(loan.amount || 0));
    const list = paymentsByLoan[String(loan.id)] || [];

    for (const pmt of list) {
      if (pmt.amount <= 0) continue;
      let interestPortion = 0;
      if (INTEREST_ONLY_TYPES.includes(pmt.payment_type)) {
        interestPortion = pmt.amount;
      } else {
        const currentInterest = currentCapital * (rateNorm / 100);
        if (pmt.amount > currentInterest) {
          interestPortion = currentInterest;
          currentCapital = Math.max(0, currentCapital - (pmt.amount - currentInterest));
        } else {
          interestPortion = pmt.amount;
        }
      }
      if (pmt.dateStr >= firstDateStr && interestPortion > 0) {
        const idx = getMonthIndex(pmt.dateStr);
        if (idx >= 0) points[idx].juros += interestPortion;
      }
    }
  }

  for (const p of points) {
    p.fluxo = p.pagamentos - p.despesas;
  }

  return points;
}
