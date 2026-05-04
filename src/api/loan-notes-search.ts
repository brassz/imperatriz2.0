import { supabase } from "@/lib/supabase";

/**
 * Busca textual na coluna `notes` da tabela `payments` e, se escopo permitir, na coluna `notes` de `paid_loans`.
 */

/** Remove caracteres que quebrariam o padrão ILIKE. */
function sanitizeIlikeTerm(term: string): string {
  return term.replace(/\\/g, "").replace(/%/g, "").replace(/_/g, "").trim();
}

export type LoanNotesSearchScope = "payments" | "paid_loans" | "all";

export type PaymentNoteHit = {
  id: string;
  loan_id: string;
  client_name: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  notes: string;
};

export type PaidLoanNoteHit = {
  id: string;
  loan_id: string;
  client_name: string;
  paid_date: string;
  notes: string;
  original_amount: number;
};

const FETCH_CHUNK = 500;
/** Limite de segurança por origem (evita loop infinito). */
const MAX_ROWS_PER_SOURCE = 5000;

async function fetchPaymentsNotesMatching(pattern: string): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  let offset = 0;
  while (offset < MAX_ROWS_PER_SOURCE) {
    const { data: chunk, error } = await supabase
      .from("payments")
      .select("id, loan_id, amount, payment_date, payment_type, notes, created_at")
      .not("notes", "is", null)
      .ilike("notes", pattern)
      .order("payment_date", { ascending: false })
      .range(offset, offset + FETCH_CHUNK - 1);

    if (error) throw error;
    const rows = chunk || [];
    all.push(...rows);
    if (rows.length < FETCH_CHUNK) break;
    offset += FETCH_CHUNK;
  }
  return all;
}

async function fetchPaidLoansNotesMatching(pattern: string): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  let offset = 0;
  while (offset < MAX_ROWS_PER_SOURCE) {
    const { data: chunk, error } = await supabase
      .from("paid_loans")
      .select("id, loan_id, client_id, notes, paid_date, original_amount")
      .not("notes", "is", null)
      .ilike("notes", pattern)
      .order("paid_date", { ascending: false })
      .range(offset, offset + FETCH_CHUNK - 1);

    if (error) throw error;
    const rows = chunk || [];
    all.push(...rows);
    if (rows.length < FETCH_CHUNK) break;
    offset += FETCH_CHUNK;
  }
  return all;
}

export async function searchLoanNotesAndObservations(
  rawTerm: string,
  scope: LoanNotesSearchScope
): Promise<{ payments: PaymentNoteHit[]; paidLoans: PaidLoanNoteHit[] }> {
  const term = sanitizeIlikeTerm(rawTerm);
  if (!term) {
    return { payments: [], paidLoans: [] };
  }
  const pattern = `%${term}%`;

  const out: { payments: PaymentNoteHit[]; paidLoans: PaidLoanNoteHit[] } = {
    payments: [],
    paidLoans: [],
  };

  if (scope === "payments" || scope === "all") {
    const payRows = await fetchPaymentsNotesMatching(pattern);
    const list = payRows.filter((p: { notes?: string | null }) => String(p.notes || "").trim() !== "");
    const loanIds = [...new Set(list.map((p: { loan_id: string }) => p.loan_id).filter(Boolean))];
    const clientByLoan = await resolveClientNamesByLoanIds(loanIds);

    out.payments = list.map((p: Record<string, unknown>) => ({
      id: String(p.id),
      loan_id: String(p.loan_id),
      client_name: clientByLoan[String(p.loan_id)] ?? "—",
      amount: parseFloat(String(p.amount || 0)),
      payment_date: String(p.payment_date || p.created_at || "").split("T")[0],
      payment_type: String(p.payment_type || "—"),
      notes: String(p.notes || ""),
    }));
  }

  if (scope === "paid_loans" || scope === "all") {
    const paidRows = await fetchPaidLoansNotesMatching(pattern);
    const list = paidRows.filter((p: { notes?: string | null }) => String(p.notes || "").trim() !== "");
    const clientIds = [...new Set(list.map((p: { client_id: string }) => p.client_id).filter(Boolean))];
    const clientById = await resolveClientNamesByIds(clientIds);

    out.paidLoans = list.map((p: Record<string, unknown>) => {
      const cid = String(p.client_id || "");
      return {
        id: String(p.id),
        loan_id: String(p.loan_id),
        client_name: clientById[cid] ?? "—",
        paid_date: String(p.paid_date || "").split("T")[0],
        notes: String(p.notes || ""),
        original_amount: parseFloat(String(p.original_amount || 0)),
      };
    });
  }

  return out;
}

const IN_CHUNK = 150;

function chunkIds(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    out.push(ids.slice(i, i + IN_CHUNK));
  }
  return out;
}

async function resolveClientNamesByLoanIds(loanIds: string[]): Promise<Record<string, string>> {
  if (loanIds.length === 0) return {};
  const map: Record<string, string> = {};
  for (const batch of chunkIds(loanIds)) {
    const { data: loansData, error } = await supabase.from("loans").select("id, client_id").in("id", batch);
    if (error) throw error;
    const clientIds = [...new Set((loansData || []).map((l: { client_id: string }) => l.client_id).filter(Boolean))];
    const clientById = await resolveClientNamesByIds(clientIds);
    for (const l of loansData || []) {
      const row = l as { id: string; client_id: string };
      map[String(row.id)] = clientById[String(row.client_id)] ?? "—";
    }
  }
  return map;
}

async function resolveClientNamesByIds(clientIds: string[]): Promise<Record<string, string>> {
  if (clientIds.length === 0) return {};
  const map: Record<string, string> = {};
  for (const batch of chunkIds(clientIds)) {
    const { data, error } = await supabase.from("clients").select("id, name").in("id", batch);
    if (error) throw error;
    for (const c of data || []) {
      const row = c as { id: string; name?: string };
      map[String(row.id)] = String(row.name || "—");
    }
  }
  return map;
}
