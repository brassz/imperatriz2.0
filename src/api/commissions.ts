import { supabase } from "@/lib/supabase";

const INTEREST_ONLY_TYPES = [
  "renewal",
  "interest_renewal",
  "early_payment_partial_interest",
  "early_payment_interest_renewal",
  "partial_interest",
] as const;

type LoanRowMini = {
  id: string;
  client_id: string;
  amount: number;
  original_amount?: number | null;
  interest_rate: number;
};

type PaymentRow = {
  id: string;
  loan_id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  created_at?: string;
};

export type CommissionSummary = {
  /** Base = juros (pagamentos) + parcelas (parcelamentos) */
  baseTotal: number;
  /** Juros apurado dentro do período */
  interestTotal: number;
  /** Soma das parcelas pagas (parcelamentos) dentro do período */
  installmentsTotal: number;
  vinicius: number;
  douglas: number;
};

export type CommissionRow = {
  /** "Juros" (empréstimo) | "Parcela" (parcelamento) */
  tipo: string;
  /** valor que entra na base (juros ou parcela paga) */
  valor: number;
  /** YYYY-MM-DD */
  data: string;
  /** Ex.: "Recebido" */
  situacao: string;
  /** Texto livre (cliente / referência) */
  origem: string;
  /** Apenas informativo no export (ex.: "EMPRÉSTIMO FINALIZADO") */
  multa?: string | null;
};

function toYmd(s: string): string {
  return String(s || "").split("T")[0];
}

function parseRate(n: unknown): number {
  let r = parseFloat(String(n ?? 0));
  if (!Number.isFinite(r)) r = 0;
  if (r > 100) r = r / 100;
  return r;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function fetchLoanMap(loanIds: string[]): Promise<Record<string, LoanRowMini>> {
  if (loanIds.length === 0) return {};
  const { data, error } = await supabase
    .from("loans")
    .select("id, client_id, amount, original_amount, interest_rate")
    .in("id", loanIds);
  if (error) throw error;

  const map: Record<string, LoanRowMini> = {};
  for (const row of data || []) {
    const r = row as Record<string, unknown>;
    const id = String(r.id || "");
    if (!id) continue;
    map[id] = {
      id,
      client_id: String(r.client_id || ""),
      amount: parseFloat(String(r.amount || 0)),
      original_amount: r.original_amount != null ? parseFloat(String(r.original_amount)) : null,
      interest_rate: parseRate(r.interest_rate),
    };
  }
  return map;
}

async function fetchPaymentsUpTo(dateTo: string, loanIds?: string[]): Promise<PaymentRow[]> {
  let q = supabase
    .from("payments")
    .select("id, loan_id, amount, payment_date, payment_type, created_at")
    .lte("payment_date", dateTo)
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (loanIds && loanIds.length > 0) q = q.in("loan_id", loanIds);

  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((p: Record<string, unknown>) => ({
    id: String(p.id),
    loan_id: String(p.loan_id),
    amount: parseFloat(String(p.amount || 0)),
    payment_date: toYmd(String(p.payment_date || p.created_at || "")),
    payment_type: String(p.payment_type || ""),
    created_at: String(p.created_at || ""),
  }));
}

function computeInterestByPayment(
  loan: LoanRowMini,
  paymentsOrdered: PaymentRow[],
  dateFrom: string,
  dateTo: string,
): number {
  // Capital inicial (preferir original_amount quando existir)
  let currentCapital = Math.max(
    0,
    parseFloat(String(loan.original_amount ?? loan.amount ?? 0)) || 0,
  );
  const rate = parseRate(loan.interest_rate);

  let interestInRange = 0;

  for (const p of paymentsOrdered) {
    const amt = p.amount;
    if (!Number.isFinite(amt) || amt <= 0) continue;

    const type = String(p.payment_type || "");
    let interestPortion = 0;

    if ((INTEREST_ONLY_TYPES as readonly string[]).includes(type)) {
      interestPortion = amt;
    } else if (type === "loan_renewal") {
      // Evento interno (amount=0); ignora
      continue;
    } else {
      const currentInterest = currentCapital * (rate / 100);
      interestPortion = Math.min(amt, currentInterest);
      const capitalReduction = Math.max(0, amt - currentInterest);
      currentCapital = Math.max(0, currentCapital - capitalReduction);
    }

    if (p.payment_date >= dateFrom && p.payment_date <= dateTo) {
      interestInRange += interestPortion;
    }
  }

  return interestInRange;
}

async function fetchInstallmentsPaidTotal(dateFrom: string, dateTo: string): Promise<number> {
  const { data, error } = await supabase
    .from("installment_payments")
    .select("amount, paid_amount, status, paid_date")
    .gte("paid_date", dateFrom)
    .lte("paid_date", dateTo)
    .in("status", ["paid", "partial"]);
  if (error) throw error;

  return (data || []).reduce((s, row: Record<string, unknown>) => {
    const paidAmount = row.paid_amount != null ? parseFloat(String(row.paid_amount)) : NaN;
    if (Number.isFinite(paidAmount) && paidAmount > 0) return s + paidAmount;
    const amt = parseFloat(String(row.amount || 0));
    return s + (Number.isFinite(amt) ? amt : 0);
  }, 0);
}

export async function fetchCommissionSummary(dateFrom: string, dateTo: string): Promise<CommissionSummary> {
  const from = toYmd(dateFrom);
  const to = toYmd(dateTo);

  // Puxa todos os pagamentos até `to` para conseguir repartir juros por pagamento sequencial.
  // Para reduzir custo, primeiro lista os pagamentos que caem no range e só então busca o histórico desses empréstimos.
  const { data: rangePays, error: rangeErr } = await supabase
    .from("payments")
    .select("loan_id")
    .gte("payment_date", from)
    .lte("payment_date", to);
  if (rangeErr) throw rangeErr;

  const loanIds = [...new Set((rangePays || []).map((r: any) => String(r.loan_id || "")).filter(Boolean))];
  if (loanIds.length === 0) {
    const inst = await fetchInstallmentsPaidTotal(from, to);
    const baseTotal = round2(inst);
    return {
      baseTotal,
      interestTotal: 0,
      installmentsTotal: round2(inst),
      vinicius: round2(baseTotal * 0.66666),
      douglas: round2(baseTotal * 0.33333),
    };
  }

  const loanMap = await fetchLoanMap(loanIds);
  const allPays = await fetchPaymentsUpTo(to, loanIds);

  // Agrupa pagamentos por loan e calcula juros no período
  const byLoan: Record<string, PaymentRow[]> = {};
  for (const p of allPays) {
    if (!byLoan[p.loan_id]) byLoan[p.loan_id] = [];
    byLoan[p.loan_id].push(p);
  }

  let interestTotal = 0;
  for (const loanId of loanIds) {
    const loan = loanMap[loanId];
    if (!loan) continue;
    interestTotal += computeInterestByPayment(loan, byLoan[loanId] || [], from, to);
  }

  const installmentsTotal = await fetchInstallmentsPaidTotal(from, to);
  const baseTotal = interestTotal + installmentsTotal;

  return {
    baseTotal: round2(baseTotal),
    interestTotal: round2(interestTotal),
    installmentsTotal: round2(installmentsTotal),
    vinicius: round2(baseTotal * 0.66666),
    douglas: round2(baseTotal * 0.33333),
  };
}

async function fetchPaymentsInRange(dateFrom: string, dateTo: string): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("id, loan_id, amount, payment_date, payment_type, created_at")
    .gte("payment_date", dateFrom)
    .lte("payment_date", dateTo)
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((p: Record<string, unknown>) => ({
    id: String(p.id),
    loan_id: String(p.loan_id),
    amount: parseFloat(String(p.amount || 0)),
    payment_date: toYmd(String(p.payment_date || p.created_at || "")),
    payment_type: String(p.payment_type || ""),
    created_at: String(p.created_at || ""),
  }));
}

async function fetchClientNamesByLoanIds(loanIds: string[]): Promise<Record<string, string>> {
  if (loanIds.length === 0) return {};
  const { data: loansData, error: loansErr } = await supabase
    .from("loans")
    .select("id, client_id")
    .in("id", loanIds);
  if (loansErr) throw loansErr;
  const clientIds = [...new Set((loansData || []).map((l: any) => String(l.client_id || "")).filter(Boolean))];
  const { data: clientsData, error: clientsErr } = await supabase
    .from("clients")
    .select("id, name")
    .in("id", clientIds);
  if (clientsErr) throw clientsErr;

  const clientById: Record<string, string> = {};
  for (const c of clientsData || []) clientById[String((c as any).id)] = String((c as any).name || "—");

  const clientByLoan: Record<string, string> = {};
  for (const l of loansData || []) {
    const row = l as any;
    clientByLoan[String(row.id)] = clientById[String(row.client_id)] ?? "—";
  }
  return clientByLoan;
}

async function fetchInstallmentPaymentsInRange(dateFrom: string, dateTo: string): Promise<Array<{
  id: string;
  paid_date: string;
  paid_amount: number;
  amount: number;
  client_name: string;
  installment_id: string;
  installment_number: number;
}>> {
  // Busca parcelas pagas no período + nome do cliente via relacionamento installments -> clients
  const { data, error } = await supabase
    .from("installment_payments")
    .select(
      "id, installment_id, installment_number, amount, paid_amount, paid_date, status, installments (id, client_id, clients (name))",
    )
    .gte("paid_date", dateFrom)
    .lte("paid_date", dateTo)
    .in("status", ["paid", "partial"])
    .order("paid_date", { ascending: true });
  if (error) throw error;

  return (data || []).map((r: any) => {
    const inst = r.installments || {};
    const cl = (inst.clients || {}) as { name?: string };
    return {
      id: String(r.id),
      installment_id: String(r.installment_id),
      installment_number: Number(r.installment_number || 0),
      amount: parseFloat(String(r.amount || 0)),
      paid_amount: r.paid_amount != null ? parseFloat(String(r.paid_amount)) : parseFloat(String(r.amount || 0)),
      paid_date: toYmd(String(r.paid_date || "")),
      client_name: String(cl.name || "—"),
    };
  });
}

async function fetchPaidLoansInRange(
  dateFrom: string,
  dateTo: string,
): Promise<Array<{ loan_id: string; client_id: string; paid_date: string }>> {
  const { data, error } = await supabase
    .from("paid_loans")
    .select("loan_id, client_id, paid_date")
    .gte("paid_date", dateFrom)
    .lte("paid_date", dateTo);
  if (error) throw error;
  return (data || [])
    .map((r: any) => ({
      loan_id: String(r.loan_id || ""),
      client_id: String(r.client_id || ""),
      paid_date: toYmd(String(r.paid_date || "")),
    }))
    .filter((r: any) => r.loan_id && r.client_id && r.paid_date);
}

async function fetchClientNames(clientIds: string[]): Promise<Record<string, string>> {
  if (clientIds.length === 0) return {};
  const { data, error } = await supabase.from("clients").select("id, name").in("id", clientIds);
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const c of data || []) map[String((c as any).id)] = String((c as any).name || "—");
  return map;
}

export async function fetchCommissionRows(dateFrom: string, dateTo: string): Promise<CommissionRow[]> {
  const from = toYmd(dateFrom);
  const to = toYmd(dateTo);

  const paymentsInRange = await fetchPaymentsInRange(from, to);
  const loanIds = [...new Set(paymentsInRange.map((p) => p.loan_id).filter(Boolean))];

  const clientByLoan = await fetchClientNamesByLoanIds(loanIds);
  const loanMap = await fetchLoanMap(loanIds);
  const allPaysUpToTo = await fetchPaymentsUpTo(to, loanIds);
  const paysByLoan: Record<string, PaymentRow[]> = {};
  for (const p of allPaysUpToTo) {
    if (!paysByLoan[p.loan_id]) paysByLoan[p.loan_id] = [];
    paysByLoan[p.loan_id].push(p);
  }

  // Juros: precisamos calcular o pedaço de juros de cada pagamento no período
  const interestRows: CommissionRow[] = [];
  for (const p of paymentsInRange) {
    const loan = loanMap[p.loan_id];
    if (!loan) continue;

    // Recalcula juros "por pagamento" até encontrar este pagamento e extrair a parcela de juros dele
    let currentCapital = Math.max(
      0,
      parseFloat(String(loan.original_amount ?? loan.amount ?? 0)) || 0,
    );
    const rate = parseRate(loan.interest_rate);

    const ordered = paysByLoan[p.loan_id] || [];
    let interestPortionForThis = 0;
    for (const x of ordered) {
      const amt = x.amount;
      if (!Number.isFinite(amt) || amt <= 0) continue;
      const type = String(x.payment_type || "");
      if (type === "loan_renewal") continue;

      let interestPortion = 0;
      if ((INTEREST_ONLY_TYPES as readonly string[]).includes(type)) {
        interestPortion = amt;
      } else {
        const currentInterest = currentCapital * (rate / 100);
        interestPortion = Math.min(amt, currentInterest);
        const capitalReduction = Math.max(0, amt - currentInterest);
        currentCapital = Math.max(0, currentCapital - capitalReduction);
      }

      if (x.id === p.id) {
        interestPortionForThis = interestPortion;
        break;
      }
    }

    if (interestPortionForThis <= 0) continue;

    const clientName = clientByLoan[p.loan_id] ?? "—";
    interestRows.push({
      tipo: "Juros",
      valor: round2(interestPortionForThis),
      data: p.payment_date,
      situacao: "Recebido",
      origem: `Pagamento de juros - ${clientName}`,
    });
  }

  const instPays = await fetchInstallmentPaymentsInRange(from, to);
  const installmentRows: CommissionRow[] = instPays
    .filter((p) => Number.isFinite(p.paid_amount) && p.paid_amount > 0)
    .map((p) => ({
      tipo: "Parcela",
      valor: round2(p.paid_amount),
      data: p.paid_date,
      situacao: "Recebido",
      origem: `Parcela ${p.installment_number} - ${p.client_name}`,
      multa: null,
    }));

  const paidLoans = await fetchPaidLoansInRange(from, to);
  const paidClientIds = [...new Set(paidLoans.map((x) => x.client_id))];
  const paidClientById = await fetchClientNames(paidClientIds);

  // Último valor pago na quitação: pega o último pagamento (amount > 0) até a data de quitação.
  const paidLoanIds = [...new Set(paidLoans.map((x) => x.loan_id))];
  const lastPayByLoan: Record<string, { amount: number; payment_date: string; created_at: string }> = {};
  if (paidLoanIds.length > 0) {
    const { data: payRows, error: payErr } = await supabase
      .from("payments")
      .select("loan_id, amount, payment_date, created_at")
      .in("loan_id", paidLoanIds)
      .order("payment_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (payErr) throw payErr;
    for (const r of payRows || []) {
      const row = r as any;
      const loanId = String(row.loan_id || "");
      if (!loanId) continue;
      const amt = parseFloat(String(row.amount || 0));
      if (!Number.isFinite(amt) || amt <= 0) continue;
      lastPayByLoan[loanId] = {
        amount: amt,
        payment_date: toYmd(String(row.payment_date || row.created_at || "")),
        created_at: String(row.created_at || ""),
      };
    }
  }

  const quitadoRows: CommissionRow[] = paidLoans.map((x) => {
    const last = lastPayByLoan[x.loan_id];
    const lastAmt = last?.amount ?? 0;
    return {
      tipo: "Quitado",
      valor: round2(lastAmt),
      data: x.paid_date,
      situacao: "Quitado",
      origem: `Empréstimo finalizado - ${paidClientById[x.client_id] ?? "—"}`,
      multa: "EMPRÉSTIMO FINALIZADO",
    };
  });

  return [...interestRows, ...installmentRows, ...quitadoRows].sort((a, b) => b.data.localeCompare(a.data));
}

