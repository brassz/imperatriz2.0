import { getSupabaseCompany, supabase } from "@/lib/supabase";
import { amortizationWaterfall, effectiveLoanPrincipal, INTEREST_ONLY_TYPES } from "@/api/loan-calc";

/** PostgREST no Supabase limita `limit` ao máximo do projeto (ex.: 1000) — acima disso retorna 400. */
// PostgREST/Supabase pode ter `max-rows` menor que 1000 dependendo do projeto.
// Se pedirmos um range maior que o permitido, o servidor retorna 400.
const REST_MAX_ROW_CANDIDATES = [1000, 500, 250, 100] as const;

function dashboardSkipKey(name: string): string {
  return `nfh_skip_${getSupabaseCompany()}_${name}`;
}

function shouldSkipOptionalResource(name: string): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(dashboardSkipKey(name)) === "1";
}

function markSkipOptionalResource(name: string): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(dashboardSkipKey(name), "1");
}

/** View/tabela ausente no projeto ou não exposta no schema cache do PostgREST. */
function isMissingRestResource(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "PGRST205" || code === "PGRST302") return true;
  const m = String(error.message || "").toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find the table") ||
    m.includes("requested resource wasn't found")
  );
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
        .select("id, amount, original_amount, interest_rate, status, due_date")
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
    original_amount?: number;
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
      const originalCapital = effectiveLoanPrincipal(loan as { original_amount?: unknown; amount?: unknown });
      const rate = parseFloat(String(loan.interest_rate || 0));
      const payments = paymentsByLoan[loan.id] || [];
      const { remainingInterest, remainingAmount } = amortizationWaterfall(originalCapital, rate, payments);
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
    if (shouldSkipOptionalResource("dash_pay_totals")) return 0;
    try {
      const { data, error } = await supabase
        .from("dashboard_payments_totals")
        .select("total_received")
        .limit(1)
        .maybeSingle();
      if (error) {
        if (isMissingRestResource(error)) markSkipOptionalResource("dash_pay_totals");
        throw error;
      }
      return parseFloat(String((data as { total_received?: unknown } | null)?.total_received || 0)) || 0;
    } catch {
      return 0;
    }
  })();

  const expensesTotal = await (async () => {
    if (shouldSkipOptionalResource("dash_exp_totals")) return 0;
    try {
      const { data, error } = await supabase
        .from("dashboard_expenses_totals")
        .select("expenses_total")
        .limit(1)
        .maybeSingle();
      if (error) {
        if (isMissingRestResource(error)) markSkipOptionalResource("dash_exp_totals");
        throw error;
      }
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

function toLocalYyyyMmDd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `new Date("YYYY-MM-DD")` é UTC em muitos engines → mês errado no BR; usar meio-dia local. */
function chartDayLocal(isoDay: string): Date | null {
  const s = String(isoDay).split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const CHART_PAYMENT_SELECT = "id, loan_id, amount, payment_date, payment_type, fine_amount, created_at";
const CHART_PAYMENTS_PAGE = 1000;

/**
 * Todos os pagamentos com data efetiva ≥ firstDateStr (igual filtro da tela Pagamentos).
 * Substitui `.limit(10000)` sem ordem, que no Postgres retorna linhas arbitrárias e subconta meses recentes.
 */
async function fetchPaymentsForChart(firstDateStr: string): Promise<Array<Record<string, unknown>>> {
  const byId = new Map<string, Record<string, unknown>>();

  const addRows = (rows: Array<Record<string, unknown>> | null | undefined) => {
    for (const r of rows || []) {
      const id = String(r.id ?? "");
      if (id) byId.set(id, r);
    }
  };

  let offset = 0;
  while (offset < 400_000) {
    const { data, error } = await supabase
      .from("payments")
      .select(CHART_PAYMENT_SELECT)
      .gte("payment_date", firstDateStr)
      .order("payment_date", { ascending: true })
      .range(offset, offset + CHART_PAYMENTS_PAGE - 1);
    if (error) break;
    const batch = data || [];
    addRows(batch as Array<Record<string, unknown>>);
    if (batch.length < CHART_PAYMENTS_PAGE) break;
    offset += CHART_PAYMENTS_PAGE;
  }

  if (byId.size === 0) {
    offset = 0;
    while (offset < 400_000) {
      const { data, error } = await supabase
        .from("payments")
        .select(CHART_PAYMENT_SELECT)
        .order("payment_date", { ascending: false })
        .range(offset, offset + CHART_PAYMENTS_PAGE - 1);
      if (error) break;
      const batch = (data || []) as Array<Record<string, unknown>>;
      if (!batch.length) break;
      for (const p of batch) {
        const ds = String(p.payment_date || p.created_at || "").split("T")[0];
        if (ds && ds >= firstDateStr) {
          const key = String(p.id || `${p.loan_id}|${p.created_at}|${p.amount}`);
          byId.set(key, p);
        }
      }
      const last = batch[batch.length - 1];
      const lastDay = String(last?.payment_date || "").split("T")[0];
      if (lastDay && lastDay < firstDateStr) break;
      if (batch.length < CHART_PAYMENTS_PAGE) break;
      offset += CHART_PAYMENTS_PAGE;
    }
  }

  const { data: nullDateRows } = await supabase
    .from("payments")
    .select(CHART_PAYMENT_SELECT)
    .is("payment_date", null)
    .gte("created_at", `${firstDateStr}T00:00:00`);

  addRows((nullDateRows || []) as Array<Record<string, unknown>>);

  return Array.from(byId.values());
}

export async function fetchDashboardChartData(months = 6): Promise<ChartDataPoint[]> {
  const today = new Date();
  const points: ChartDataPoint[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    points.push({ mes: label, emprestimos: 0, pagamentos: 0, despesas: 0, fluxo: 0, multas: 0, juros: 0 });
  }

  const firstDate = new Date(today.getFullYear(), today.getMonth() - months, 1);
  /** Data local (evita deslocar o corte do mês com `toISOString()` em UTC). */
  const firstDateStr = toLocalYyyyMmDd(firstDate);

  const [loansRes, finesRes] = await Promise.all([
    supabase
      .from("loans")
      .select("id, amount, interest_rate, loan_date")
      .gte("loan_date", firstDateStr),
    (async () => {
      if (shouldSkipOptionalResource("client_fines")) return { data: [] as Record<string, unknown>[] };
      const { data, error } = await supabase
        .from("client_fines")
        .select("amount, created_at")
        .gte("created_at", `${firstDateStr}T00:00:00`);
      if (error) {
        if (isMissingRestResource(error)) markSkipOptionalResource("client_fines");
        return { data: [] as Record<string, unknown>[] };
      }
      return { data: (data || []) as Record<string, unknown>[] };
    })(),
  ]);

  const payments = await fetchPaymentsForChart(firstDateStr);

  const expenses = await (async () => {
    type ExpRow = {
      amount?: unknown;
      expense_date?: string;
      date?: string;
      created_at?: string;
      status?: string;
    };

    const expenseDateStr = (e: ExpRow) =>
      String(e.expense_date ?? e.date ?? e.created_at ?? "").split("T")[0];

    const filterCancelled = (rows: ExpRow[]) =>
      rows.filter((e) => {
        const d = expenseDateStr(e);
        if (d && d < firstDateStr) return false;
        return String(e.status || "") !== "cancelled";
      });

    const finishRows = (rows: ExpRow[]) => {
      const withDate = rows.filter((e) => expenseDateStr(e));
      const base = withDate.length ? filterCancelled(withDate) : rows;
      return base.length ? base : rows;
    };

    // Sem `.gte` no servidor: em alguns projetos PostgREST retorna 400 ao filtrar `expense_date`.
    // `limit` acima do máximo do PostgREST (ex. 1000 no Supabase) também retorna 400 — usar `.range` paginado.
    const selectVariants = [
      "amount, expense_date",
      "amount, expense_date, status",
      "amount, date",
      "amount, date, status",
      "amount, created_at",
      "amount, created_at, status",
      "amount",
    ] as const;

    for (const selectStr of selectVariants) {
      let picked: (typeof REST_MAX_ROW_CANDIDATES)[number] | null = null;
      for (const pageSize of REST_MAX_ROW_CANDIDATES) {
        const { error } = await supabase.from("expenses").select(selectStr).range(0, pageSize - 1);
        if (!error) {
          picked = pageSize;
          break;
        }
      }
      if (!picked) continue;

      const acc: ExpRow[] = [];
      let offset = 0;
      for (;;) {
        const { data, error } = await supabase.from("expenses").select(selectStr).range(offset, offset + picked - 1);
        if (error) {
          if (offset === 0) break;
          return finishRows(acc);
        }
        const batch = (data || []) as ExpRow[];
        acc.push(...batch);
        if (batch.length < picked) return finishRows(acc);
        offset += picked;
        if (offset > 400_000) return finishRows(acc);
      }
    }
    return [];
  })();

  const loans = loansRes.data || [];
  const fines = finesRes.data || [];

  const loanIdsWithPaymentsInRange = new Set<string>();
  for (const p of payments) {
    const dateStr = String((p as { payment_date?: string }).payment_date || (p as { created_at?: string }).created_at || "").split("T")[0];
    if (dateStr && dateStr >= firstDateStr) loanIdsWithPaymentsInRange.add(String((p as { loan_id?: string }).loan_id || ""));
  }

  const LOAN_IN_CHUNK = 150;

  const allLoansForJuros = await (async () => {
    const idList = Array.from(loanIdsWithPaymentsInRange).filter(Boolean);
    if (idList.length === 0) return [];
    const acc: Array<Record<string, unknown>> = [];
    for (let i = 0; i < idList.length; i += LOAN_IN_CHUNK) {
      const { data } = await supabase
        .from("loans")
        .select("id, amount, interest_rate")
        .in("id", idList.slice(i, i + LOAN_IN_CHUNK));
      if (data?.length) acc.push(...(data as Array<Record<string, unknown>>));
    }
    return acc;
  })();

  const allPaymentsForJuros = await (async () => {
    if (allLoansForJuros.length === 0) return [];
    const ids = allLoansForJuros.map((l: Record<string, unknown>) => String(l.id)).filter(Boolean);
    const acc: Array<Record<string, unknown>> = [];
    for (let i = 0; i < ids.length; i += LOAN_IN_CHUNK) {
      const { data } = await supabase
        .from("payments")
        .select("loan_id, amount, payment_type, payment_date, created_at")
        .in("loan_id", ids.slice(i, i + LOAN_IN_CHUNK))
        .order("created_at", { ascending: true });
      if (data?.length) acc.push(...(data as Array<Record<string, unknown>>));
    }
    acc.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    return acc;
  })();

  const getMonthIndex = (dateStr: string) => {
    const d = chartDayLocal(dateStr);
    if (!d) return -1;
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
    const d = chartDayLocal(dateStr);
    if (!d || d.getTime() < cutoffTime) continue;
    const idx = getMonthIndex(dateStr);
    if (idx >= 0) points[idx].pagamentos += amt;
  }

  for (const e of expenses) {
    const amt = parseFloat(String((e as { amount?: unknown }).amount || 0));
    const ex = e as { expense_date?: string; date?: string; created_at?: string };
    const dateStr = String(ex.expense_date ?? ex.date ?? ex.created_at ?? "").split("T")[0];
    if (!dateStr) continue;
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
