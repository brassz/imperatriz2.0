import { supabase } from "@/lib/supabase";
import { allocateWaterfallPerPayment, effectiveLoanPrincipal, type AmortizationPayment } from "@/api/loan-calc";

type PaymentRow = {
  id: string;
  loan_id: string;
  amount: number;
  fine_amount: number;
  payment_date: string;
  payment_type: string;
  created_at?: string;
};

const PAYMENTS_PAGE = 500;
const LOAN_ID_CHUNK = 150;

const VINICIUS_RATIO = 0.66666;
const DOUGLAS_RATIO = 0.33333;

export type CommissionSummary = {
  /** Soma apenas da parcela de *juros* dos pagamentos de empréstimo no período (sem capital). */
  baseTotal: number;
  /** Igual a `baseTotal` (compatível com a UI que exibia “pagamentos empréstimos”). */
  interestTotal: number;
  /** Parcelamentos não entram na base de comissão (sempre 0). */
  installmentsTotal: number;
  vinicius: number;
  douglas: number;
  /** Soma de `fine_amount` no período (fora da base de comissão de juros). */
  fineTotal: number;
};

/** Agrupa linhas no Excel/PDF por cor (sem expor `interest_renewal` / `capital_interest_renewal` no texto). */
export type CommissionRowCategory =
  | "installment"
  | "renewal"
  | "loan_finalized"
  | "loan_other"
  | "fine_payment";

export const COMMISSION_ROW_CATEGORY_META: Record<
  CommissionRowCategory,
  { label: string; excelFill: string; pdfRgb: [number, number, number] }
> = {
  installment: {
    label: "Parcelamento",
    excelFill: "E0F2FE",
    pdfRgb: [224, 242, 254],
  },
  renewal: {
    label: "Renovação (juros)",
    excelFill: "FEF3C7",
    pdfRgb: [254, 243, 199],
  },
  loan_finalized: {
    label: "Empréstimo finalizado ou quitado",
    excelFill: "DCFCE7",
    pdfRgb: [167, 243, 208],
  },
  loan_other: {
    label: "Pagamento (empréstimo)",
    excelFill: "F1F5F9",
    pdfRgb: [241, 245, 249],
  },
  fine_payment: {
    label: "Multa",
    excelFill: "FCE7F3",
    pdfRgb: [252, 231, 243],
  },
};

/** Prazo civil do contrato (dias entre criação e vencimento), alinhado à regra de 20/30 dias do sistema. */
export type ContractTermLabel = "20" | "30" | "outro";

export type CommissionRow = {
  /** "Pagamento" | "Multa" */
  tipo: string;
  /** Parcela de juros que entra na base de comissão (mesmo conceito antigo de "Valor" no export). */
  valor: number;
  /** YYYY-MM-DD */
  data: string;
  /** Ex.: "Recebido" */
  situacao: string;
  /** Texto livre (cliente / referência) */
  origem: string;
  /** Texto para coluna Multa no Excel/PDF (ex.: "R$ 50,00") ou vazio */
  multa: string | null;
  /** Cor / grupo no Excel e PDF */
  category: CommissionRowCategory;
  valorPagamento: number;
  valorMulta: number;
  capital: number;
  juros: number;
  vinicius: number;
  douglas: number;
  termoContrato: ContractTermLabel;
  paymentId: string;
};

function toYmd(s: string): string {
  return String(s || "").split("T")[0];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Chave estável para cruzar `payments.loan_id` com `loans.id` (JS diferencia maiúsculas em UUID). */
function normLoanId(id: string): string {
  return String(id || "").trim().toLowerCase();
}

function normalizeLoanStatus(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Cor verde no export: `loans.status` finalizado/pago OU contrato presente em `paid_loans` (quitado no histórico).
 */
function isLoanGreenCategory(statusRaw: unknown, loanIdInPaidLoans: boolean): boolean {
  const s = normalizeLoanStatus(statusRaw);
  if (s === "finalized" || s === "paid") return true;
  if (loanIdInPaidLoans) return true;
  return false;
}

/** IDs normalizados que constam em `paid_loans` (quitados). */
async function fetchQuitadoLoanIdSet(loanIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (loanIds.length === 0) return set;
  for (let i = 0; i < loanIds.length; i += LOAN_ID_CHUNK) {
    const batch = loanIds.slice(i, i + LOAN_ID_CHUNK);
    const { data, error } = await supabase.from("paid_loans").select("loan_id").in("loan_id", batch);
    if (error) throw error;
    for (const row of data || []) {
      const lid = normLoanId(String((row as { loan_id?: string }).loan_id || ""));
      if (lid) set.add(lid);
    }
  }
  return set;
}

/** Entra na base de comissão (juros): valor > 0 e não é linha interna de renovação (amount 0). */
function countsTowardCommissionBase(p: PaymentRow): boolean {
  if (p.payment_type === "loan_renewal") return false;
  return Number.isFinite(p.amount) && p.amount > 0;
}

export function contractTermDays(loanDateYmd: string, dueDateYmd: string): number | null {
  const a = toYmd(loanDateYmd);
  const b = toYmd(dueDateYmd);
  if (!a || !b) return null;
  const d1 = new Date(a);
  const d2 = new Date(b);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export function contractTermLabel(loanDateYmd: string, dueDateYmd: string): ContractTermLabel {
  const diff = contractTermDays(loanDateYmd, dueDateYmd);
  if (diff == null) return "outro";
  if (diff >= 18 && diff <= 22) return "20";
  if (diff >= 28 && diff <= 32) return "30";
  return "outro";
}

async function fetchPaymentsInRange(dateFrom: string, dateTo: string): Promise<PaymentRow[]> {
  const list: PaymentRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("payments")
      .select("id, loan_id, amount, fine_amount, payment_date, payment_type, created_at")
      .gte("payment_date", dateFrom)
      .lte("payment_date", dateTo)
      .order("payment_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + PAYMENTS_PAGE - 1);
    if (error) throw error;
    const chunk = data || [];
    for (const p of chunk) {
      const r = p as Record<string, unknown>;
      list.push({
        id: String(r.id),
        loan_id: normLoanId(String(r.loan_id || "")),
        amount: parseFloat(String(r.amount || 0)),
        fine_amount: parseFloat(String(r.fine_amount || 0)),
        payment_date: toYmd(String(r.payment_date || r.created_at || "")),
        payment_type: String(r.payment_type || ""),
        created_at: String(r.created_at || ""),
      });
    }
    if (chunk.length < PAYMENTS_PAGE) break;
    offset += PAYMENTS_PAGE;
  }
  return list;
}

type PaymentAllocRow = {
  id: string;
  loan_id: string;
  amount: number;
  payment_type: string;
  payment_date: string;
  created_at: string;
};

function sortPaymentsForAllocation(rows: PaymentAllocRow[]): PaymentAllocRow[] {
  return [...rows].sort((a, b) => {
    if (a.payment_date !== b.payment_date) return a.payment_date.localeCompare(b.payment_date);
    if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
    return a.id.localeCompare(b.id);
  });
}

async function fetchAllPaymentsForLoanIds(loanIds: string[]): Promise<PaymentAllocRow[]> {
  const out: PaymentAllocRow[] = [];
  if (loanIds.length === 0) return out;
  for (let i = 0; i < loanIds.length; i += LOAN_ID_CHUNK) {
    const batch = loanIds.slice(i, i + LOAN_ID_CHUNK);
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("payments")
        .select("id, loan_id, amount, payment_type, payment_date, created_at")
        .in("loan_id", batch)
        .range(offset, offset + PAYMENTS_PAGE - 1);
      if (error) throw error;
      const chunk = data || [];
      for (const p of chunk) {
        const r = p as Record<string, unknown>;
        out.push({
          id: String(r.id),
          loan_id: normLoanId(String(r.loan_id || "")),
          amount: parseFloat(String(r.amount || 0)),
          payment_type: String(r.payment_type || ""),
          payment_date: toYmd(String(r.payment_date || r.created_at || "")),
          created_at: String(r.created_at || ""),
        });
      }
      if (chunk.length < PAYMENTS_PAGE) break;
      offset += PAYMENTS_PAGE;
    }
  }
  return out;
}

async function fetchLoansForInterestAllocation(loanIds: string[]): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < loanIds.length; i += LOAN_ID_CHUNK) {
    const batch = loanIds.slice(i, i + LOAN_ID_CHUNK);
    const { data, error } = await supabase
      .from("loans")
      .select("id, amount, original_amount, interest_rate, loan_date, due_date")
      .in("id", batch);
    if (error) throw error;
    rows.push(...((data || []) as Array<Record<string, unknown>>));
  }
  return rows;
}

async function buildJurosCapitalByPaymentId(
  loanIds: string[],
): Promise<{ interest: Map<string, number>; capital: Map<string, number> }> {
  const interest = new Map<string, number>();
  const capital = new Map<string, number>();
  if (loanIds.length === 0) return { interest, capital };

  const [allPayments, loansData] = await Promise.all([
    fetchAllPaymentsForLoanIds(loanIds),
    fetchLoansForInterestAllocation(loanIds),
  ]);

  const loanById = new Map<string, Record<string, unknown>>();
  for (const l of loansData) {
    loanById.set(normLoanId(String((l as { id?: unknown }).id || "")), l);
  }

  const byLoan = new Map<string, PaymentAllocRow[]>();
  for (const p of allPayments) {
    if (!byLoan.has(p.loan_id)) byLoan.set(p.loan_id, []);
    byLoan.get(p.loan_id)!.push(p);
  }

  for (const [, rows] of byLoan) {
    const sorted = sortPaymentsForAllocation(rows);
    if (sorted.length === 0) continue;
    const lid = sorted[0].loan_id;
    const loan = loanById.get(lid) || {};
    const principal = effectiveLoanPrincipal(loan);
    const rate = parseFloat(String(loan.interest_rate ?? 0));
    const amortRows: AmortizationPayment[] = sorted.map((r) => ({
      amount: r.amount,
      payment_type: r.payment_type,
    }));
    const parts = allocateWaterfallPerPayment(principal, rate, amortRows);
    for (let i = 0; i < sorted.length; i++) {
      interest.set(sorted[i].id, round2(parts[i]?.interest ?? 0));
      capital.set(sorted[i].id, round2(parts[i]?.capital ?? 0));
    }
  }

  return { interest, capital };
}

async function loadCommissionInterestContext(
  dateFrom: string,
  dateTo: string,
): Promise<{
  paymentsInRange: PaymentRow[];
  interestByPaymentId: Map<string, number>;
  capitalByPaymentId: Map<string, number>;
}> {
  const from = toYmd(dateFrom);
  const to = toYmd(dateTo);
  const paymentsInRange = await fetchPaymentsInRange(from, to);
  const loanIds = [...new Set(paymentsInRange.map((p) => p.loan_id).filter(Boolean))];
  const { interest, capital } = await buildJurosCapitalByPaymentId(loanIds);
  return { paymentsInRange, interestByPaymentId: interest, capitalByPaymentId: capital };
}

export async function fetchCommissionSummary(dateFrom: string, dateTo: string): Promise<CommissionSummary> {
  const from = toYmd(dateFrom);
  const to = toYmd(dateTo);

  const { paymentsInRange, interestByPaymentId } = await loadCommissionInterestContext(from, to);
  let jurosTotal = 0;
  let fineTotal = 0;
  for (const p of paymentsInRange) {
    const f = Number.isFinite(p.fine_amount) ? p.fine_amount : 0;
    if (f > 0) fineTotal += f;
    if (!countsTowardCommissionBase(p)) continue;
    jurosTotal += interestByPaymentId.get(p.id) ?? 0;
  }
  jurosTotal = round2(jurosTotal);
  fineTotal = round2(fineTotal);

  return {
    baseTotal: jurosTotal,
    interestTotal: jurosTotal,
    installmentsTotal: 0,
    vinicius: round2(jurosTotal * VINICIUS_RATIO),
    douglas: round2(jurosTotal * DOUGLAS_RATIO),
    fineTotal,
  };
}

/** Tipos de pagamento tratados como renovação: não aparecem como texto na origem; destaque só por cor no export. */
const RENEWAL_COMMISSION_PAYMENT_TYPES = new Set(["interest_renewal", "capital_interest_renewal"]);

function formatPaymentTypeLabel(paymentType: string): string {
  const pt = String(paymentType || "").trim().toLowerCase();
  if (!pt) return "Pagamento";
  const map: Record<string, string> = {
    pix: "PIX",
    boleto: "Boleto",
    dinheiro: "Dinheiro",
    cartao: "Cartão",
    transferencia: "Transferência",
    ted: "TED",
    doc: "DOC",
    cheque: "Cheque",
    outros: "Outros",
  };
  if (map[pt]) return map[pt];
  return pt.replace(/_/g, " ");
}

function fmtMultaCell(n: number): string | null {
  if (!(n > 0)) return null;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function fetchLoanCommissionMeta(loanIds: string[]): Promise<{
  clientByLoan: Record<string, string>;
  statusByLoan: Record<string, string>;
  loanDateByLoan: Record<string, string>;
  dueDateByLoan: Record<string, string>;
}> {
  const clientByLoan: Record<string, string> = {};
  const statusByLoan: Record<string, string> = {};
  const loanDateByLoan: Record<string, string> = {};
  const dueDateByLoan: Record<string, string> = {};
  if (loanIds.length === 0) return { clientByLoan, statusByLoan, loanDateByLoan, dueDateByLoan };

  for (let i = 0; i < loanIds.length; i += LOAN_ID_CHUNK) {
    const batch = loanIds.slice(i, i + LOAN_ID_CHUNK);
    const { data: loansData, error: loansErr } = await supabase
      .from("loans")
      .select("id, client_id, status, loan_date, due_date")
      .in("id", batch);
    if (loansErr) throw loansErr;
    const clientIds = [...new Set((loansData || []).map((l: any) => String(l.client_id || "")).filter(Boolean))];
    const clientById: Record<string, string> = {};
    if (clientIds.length > 0) {
      const { data: clientsData, error: clientsErr } = await supabase
        .from("clients")
        .select("id, name")
        .in("id", clientIds);
      if (clientsErr) throw clientsErr;
      for (const c of clientsData || []) {
        clientById[String((c as any).id)] = String((c as any).name || "—");
      }
    }
    for (const l of loansData || []) {
      const row = l as any;
      const id = normLoanId(String(row.id || ""));
      if (!id) continue;
      clientByLoan[id] = clientById[String(row.client_id)] ?? "—";
      statusByLoan[id] = String(row.status ?? "");
      loanDateByLoan[id] = toYmd(String(row.loan_date || ""));
      dueDateByLoan[id] = toYmd(String(row.due_date || ""));
    }
  }
  return { clientByLoan, statusByLoan, loanDateByLoan, dueDateByLoan };
}

export async function fetchCommissionRows(dateFrom: string, dateTo: string): Promise<CommissionRow[]> {
  const from = toYmd(dateFrom);
  const to = toYmd(dateTo);

  const { paymentsInRange, interestByPaymentId, capitalByPaymentId } = await loadCommissionInterestContext(from, to);
  const loanIds = [...new Set(paymentsInRange.map((p) => p.loan_id).filter(Boolean))];
  const [{ clientByLoan, statusByLoan, loanDateByLoan, dueDateByLoan }, quitadoLoanIds] = await Promise.all([
    fetchLoanCommissionMeta(loanIds),
    fetchQuitadoLoanIdSet(loanIds),
  ]);

  const paymentRows: CommissionRow[] = [];

  for (const p of paymentsInRange) {
    const fine = round2(Number.isFinite(p.fine_amount) ? p.fine_amount : 0);
    const loanDate = loanDateByLoan[p.loan_id] || "";
    const dueDate = dueDateByLoan[p.loan_id] || "";
    const termo = contractTermLabel(loanDate, dueDate);
    const clientName = clientByLoan[p.loan_id] ?? "—";

    if (countsTowardCommissionBase(p)) {
      const juros = interestByPaymentId.get(p.id) ?? 0;
      const cap = capitalByPaymentId.get(p.id) ?? 0;
      const tipoPag = (p.payment_type || "").trim();
      const isRenewal = RENEWAL_COMMISSION_PAYMENT_TYPES.has(tipoPag);
      const st = statusByLoan[p.loan_id] ?? "";
      const inPaidLoans = quitadoLoanIds.has(p.loan_id);
      let category: CommissionRowCategory;
      if (isRenewal) category = "renewal";
      else if (isLoanGreenCategory(st, inPaidLoans)) category = "loan_finalized";
      else category = "loan_other";

      const origem = isRenewal ? clientName : `${clientName} · ${formatPaymentTypeLabel(tipoPag)}`;
      const vi = round2(juros * VINICIUS_RATIO);
      const dg = round2(juros * DOUGLAS_RATIO);

      paymentRows.push({
        tipo: "Pagamento",
        valor: round2(juros),
        juros: round2(juros),
        capital: round2(cap),
        valorPagamento: round2(p.amount),
        valorMulta: fine,
        vinicius: vi,
        douglas: dg,
        termoContrato: termo,
        data: p.payment_date,
        situacao: "Recebido",
        origem,
        multa: fmtMultaCell(fine),
        category,
        paymentId: p.id,
      });
    } else if (fine > 0) {
      paymentRows.push({
        tipo: "Multa",
        valor: 0,
        juros: 0,
        capital: 0,
        valorPagamento: round2(p.amount),
        valorMulta: fine,
        vinicius: 0,
        douglas: 0,
        termoContrato: termo,
        data: p.payment_date,
        situacao: p.amount > 0 ? "Recebido" : "Multa",
        origem: `${clientName} · multa (sem rateio de comissão)`,
        multa: fmtMultaCell(fine),
        category: "fine_payment",
        paymentId: p.id,
      });
    }
  }

  return paymentRows.sort((a, b) => {
    if (b.data !== a.data) return b.data.localeCompare(a.data);
    return b.paymentId.localeCompare(a.paymentId);
  });
}
