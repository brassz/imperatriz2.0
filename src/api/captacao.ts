import { supabase } from "@/lib/supabase";
import {
  allocateWaterfallPerPayment,
  effectiveLoanPrincipal,
  type AmortizationPayment,
} from "@/api/loan-calc";

export type CapitalRaise = {
  id: string;
  nome: string;
  investidor: string | null;
  valor_levantado: number;
  juros_percent_total: number;
  prazo_meses: number;
  parcelas: number;
  data_inicio: string;
  data_vencimento: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

export type CapitalRaiseLoanLink = {
  id: string;
  client_id: string;
  client_name: string;
  amount: number;
  original_amount?: number;
  interest_rate: number;
  loan_date: string;
  due_date: string;
  status: string;
  created_at: string;
  capital_raise_id: string | null;
  capital_raise_capital: number;
  capital_raise_interest: number;
};

export type CapitalRaiseLoanProgress = {
  loanId: string;
  clientName: string;
  allocatedTotal: number;
  receivedTotal: number;
  receivedInterest: number;
  receivedCapital: number;
  remainingInterest: number;
  remainingCapital: number;
};

export type CapitalRaiseProgress = {
  raise: CapitalRaise;
  totalQuitacao: number;
  received: number;
  remaining: number;
  pct: number;
  receivedCapitalOnly: number;
  remainingPrincipal: number;
  pctPrincipal: number;
  byLoan: CapitalRaiseLoanProgress[];
};

function toYmd(s: string): string {
  return String(s || "").split("T")[0];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeCapitalRaiseTotalQuitacao(raise: Pick<CapitalRaise, "valor_levantado" | "juros_percent_total">): number {
  const principal = Number(raise.valor_levantado || 0);
  const pct = Number(raise.juros_percent_total || 0);
  return round2(principal * (1 + pct / 100));
}

export function computeCapitalRaiseParcelaValue(raise: Pick<CapitalRaise, "valor_levantado" | "parcelas">): number {
  const principal = Number(raise.valor_levantado || 0);
  const p = Math.max(1, Math.floor(Number(raise.parcelas || 1)));
  return round2(principal / p);
}

export async function fetchCapitalRaises(): Promise<CapitalRaise[]> {
  const { data, error } = await supabase
    .from("capital_raises")
    .select(
      "id, nome, investidor, valor_levantado, juros_percent_total, prazo_meses, parcelas, data_inicio, data_vencimento, ativo, created_at, updated_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: String(r.id),
    nome: String(r.nome || ""),
    investidor: r.investidor != null ? String(r.investidor) : null,
    valor_levantado: parseFloat(String(r.valor_levantado || 0)),
    juros_percent_total: parseFloat(String(r.juros_percent_total || 0)),
    prazo_meses: Number(r.prazo_meses || 0),
    parcelas: Number(r.parcelas || 1),
    data_inicio: toYmd(String(r.data_inicio || "")),
    data_vencimento: r.data_vencimento ? toYmd(String(r.data_vencimento)) : null,
    ativo: Boolean(r.ativo),
    created_at: String(r.created_at || ""),
    updated_at: String(r.updated_at || ""),
  }));
}

export async function createCapitalRaise(input: {
  nome: string;
  investidor?: string | null;
  valor_levantado: number;
  juros_percent_total: number;
  prazo_meses: number;
  parcelas: number;
  data_inicio: string;
  data_vencimento?: string | null;
  ativo?: boolean;
}): Promise<{ id: string }> {
  const row = {
    nome: String(input.nome || "").trim(),
    investidor: input.investidor != null ? String(input.investidor) : null,
    valor_levantado: input.valor_levantado,
    juros_percent_total: input.juros_percent_total,
    prazo_meses: input.prazo_meses,
    parcelas: Math.max(1, Math.floor(Number(input.parcelas || 1))),
    data_inicio: toYmd(input.data_inicio),
    data_vencimento: input.data_vencimento ? toYmd(input.data_vencimento) : null,
    ativo: input.ativo !== false,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("capital_raises").insert([row]).select("id").single();
  if (error) throw error;
  return { id: String((data as any)?.id) };
}

export async function updateCapitalRaise(
  id: string,
  patch: Partial<{
    nome: string;
    investidor: string | null;
    valor_levantado: number;
    juros_percent_total: number;
    prazo_meses: number;
    parcelas: number;
    data_inicio: string;
    data_vencimento: string | null;
    ativo: boolean;
  }>,
): Promise<void> {
  const payload: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (payload.nome != null) payload.nome = String(payload.nome).trim();
  if (payload.data_inicio != null) payload.data_inicio = toYmd(String(payload.data_inicio));
  if (payload.data_vencimento != null) {
    const v = String(payload.data_vencimento || "").trim();
    payload.data_vencimento = v ? toYmd(v) : null;
  }
  if (payload.parcelas != null) payload.parcelas = Math.max(1, Math.floor(Number(payload.parcelas || 1)));
  const { error } = await supabase.from("capital_raises").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteCapitalRaise(id: string): Promise<void> {
  const { error } = await supabase.from("capital_raises").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchLoansLinkedToCapitalRaise(raiseId: string): Promise<CapitalRaiseLoanLink[]> {
  const { data, error } = await supabase
    .from("loans")
    .select(
      `
      id,
      client_id,
      amount,
      original_amount,
      interest_rate,
      loan_date,
      due_date,
      status,
      created_at,
      capital_raise_id,
      capital_raise_capital,
      capital_raise_interest,
      clients (name)
    `,
    )
    .eq("capital_raise_id", raiseId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data || []).map((r: any) => ({
    id: String(r.id),
    client_id: String(r.client_id || ""),
    client_name: String(r?.clients?.name || "—"),
    amount: parseFloat(String(r.amount || 0)),
    original_amount: r.original_amount != null ? parseFloat(String(r.original_amount || 0)) : undefined,
    interest_rate: parseFloat(String(r.interest_rate || 0)),
    loan_date: toYmd(String(r.loan_date || "")),
    due_date: toYmd(String(r.due_date || "")),
    status: String(r.status || ""),
    created_at: String(r.created_at || ""),
    capital_raise_id: r.capital_raise_id != null ? String(r.capital_raise_id) : null,
    capital_raise_capital: parseFloat(String(r.capital_raise_capital || 0)),
    capital_raise_interest: parseFloat(String(r.capital_raise_interest || 0)),
  }));
}

type PaymentRow = { loan_id: string; amount: number; payment_type: string; fine_amount?: number; created_at?: string };

async function fetchPaymentsForLoans(loanIds: string[]): Promise<Record<string, PaymentRow[]>> {
  if (loanIds.length === 0) return {};
  const { data, error } = await supabase
    .from("payments")
    .select("loan_id, amount, payment_type, fine_amount, created_at")
    .in("loan_id", loanIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const byLoan: Record<string, PaymentRow[]> = {};
  for (const r of data || []) {
    const row = r as any;
    const lid = String(row.loan_id || "");
    if (!lid) continue;
    if (!byLoan[lid]) byLoan[lid] = [];
    byLoan[lid].push({
      loan_id: lid,
      amount: parseFloat(String(row.amount || 0)),
      payment_type: String(row.payment_type || ""),
      fine_amount: row.fine_amount != null ? parseFloat(String(row.fine_amount || 0)) : 0,
      created_at: String(row.created_at || ""),
    });
  }
  return byLoan;
}

/**
 * Calcula quitação do levantamento a partir do rateio (juros/capital) dos pagamentos
 * dos empréstimos vinculados, respeitando os limites alocados em cada empréstimo.
 *
 * Regra: juros pagos abatem `capital_raise_interest` primeiro; capital pago abate `capital_raise_capital` depois.
 */
export async function fetchCapitalRaiseProgress(raise: CapitalRaise): Promise<CapitalRaiseProgress> {
  const linkedLoans = await fetchLoansLinkedToCapitalRaise(raise.id);
  const loanIds = linkedLoans.map((l) => l.id);
  const paymentsByLoan = await fetchPaymentsForLoans(loanIds);

  const byLoan: CapitalRaiseLoanProgress[] = [];
  let received = 0;
  let receivedCapitalOnly = 0;

  for (const loan of linkedLoans) {
    const allocatedInterest0 = round2(Number(loan.capital_raise_interest || 0));
    const allocatedCapital0 = round2(Number(loan.capital_raise_capital || 0));
    const allocatedTotal = round2(allocatedInterest0 + allocatedCapital0);

    let remainingInterest = allocatedInterest0;
    let remainingCapital = allocatedCapital0;
    let receivedInterest = 0;
    let receivedCapital = 0;

    const payments = (paymentsByLoan[loan.id] || []).filter((p) => String(p.payment_type || "") !== "loan_renewal");
    const capBase = effectiveLoanPrincipal({ original_amount: loan.original_amount, amount: loan.amount });
    const parts = allocateWaterfallPerPayment(
      capBase,
      loan.interest_rate,
      payments.map((p) => ({ amount: p.amount, payment_type: p.payment_type, fine_amount: p.fine_amount } satisfies AmortizationPayment)),
    );

    for (const part of parts) {
      if (remainingInterest > 0 && part.interest > 0) {
        const x = Math.min(remainingInterest, part.interest);
        remainingInterest = round2(remainingInterest - x);
        receivedInterest = round2(receivedInterest + x);
      }
      if (remainingCapital > 0 && part.capital > 0) {
        const x = Math.min(remainingCapital, part.capital);
        remainingCapital = round2(remainingCapital - x);
        receivedCapital = round2(receivedCapital + x);
      }
      if (remainingInterest <= 0 && remainingCapital <= 0) break;
    }

    const receivedTotal = round2(receivedInterest + receivedCapital);
    received = round2(received + receivedTotal);
    receivedCapitalOnly = round2(receivedCapitalOnly + receivedCapital);

    byLoan.push({
      loanId: loan.id,
      clientName: loan.client_name,
      allocatedTotal,
      receivedTotal,
      receivedInterest,
      receivedCapital,
      remainingInterest,
      remainingCapital,
    });
  }

  const totalQuitacao = computeCapitalRaiseTotalQuitacao(raise);
  const remaining = round2(Math.max(0, totalQuitacao - received));
  const pct = totalQuitacao > 0 ? Math.max(0, Math.min(100, Math.round((received / totalQuitacao) * 100))) : 0;

  const remainingPrincipal = round2(Math.max(0, Number(raise.valor_levantado || 0) - receivedCapitalOnly));
  const pctPrincipal =
    Number(raise.valor_levantado || 0) > 0
      ? Math.max(0, Math.min(100, Math.round((receivedCapitalOnly / Number(raise.valor_levantado || 0)) * 100)))
      : 0;

  return { raise, totalQuitacao, received, remaining, pct, receivedCapitalOnly, remainingPrincipal, pctPrincipal, byLoan };
}

