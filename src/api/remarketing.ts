import { supabase } from "@/lib/supabase";
import { fetchClientScore } from "@/api/clients";
import { resolvePaidLoanClientNames } from "@/api/loans";
import type { ClientScoreResult } from "@/api/client-score";

export type RemarketingPaymentRow = {
  id: string;
  loan_id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  fine_amount: number;
  notes: string | null;
  created_at: string;
};

export type RemarketingQuitadoRow = {
  paidLoanId: string;
  loanId: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientCpf: string | null;
  clientEmail: string | null;
  clientAddress: string | null;
  originalAmount: number;
  interestRate: number;
  loanDate: string;
  dueDate: string;
  paidDate: string;
  totalPaid: number | null;
  paymentMethod: string | null;
  quitadoNotes: string | null;
  payments: RemarketingPaymentRow[];
  clientScore: ClientScoreResult | null;
};

/**
 * Quitados sem embed `clients` no PostgREST: o 400 ocorre se não houver FK
 * paid_loans → clients. Buscamos clientes em segunda query e mesclamos.
 */
export async function fetchRemarketingQuitados(): Promise<RemarketingQuitadoRow[]> {
  const { data: paidRows, error } = await supabase
    .from("paid_loans")
    .select(
      `
      id,
      loan_id,
      client_id,
      original_amount,
      interest_rate,
      loan_date,
      due_date,
      paid_date,
      total_paid,
      payment_method,
      notes
    `,
    )
    .order("paid_date", { ascending: false })
    .limit(5000);

  if (error) throw error;

  const rows = (paidRows || []) as Array<Record<string, unknown>>;
  const { clientIdByLoanId } = await resolvePaidLoanClientNames(rows);
  const clientIds = [
    ...new Set(
      rows
        .map((r) => {
          const lid = String(r.loan_id ?? "");
          return (clientIdByLoanId[lid] || String(r.client_id || "")).trim();
        })
        .filter(Boolean),
    ),
  ];

  const clientMap: Record<
    string,
    { name: string; phone: string; cpf: string | null; email: string | null; address: string | null }
  > = {};

  if (clientIds.length > 0) {
    const { data: clientsData, error: clientsErr } = await supabase
      .from("clients")
      .select("id, name, phone, cpf, email, address")
      .in("id", clientIds);

    if (clientsErr) throw clientsErr;

    for (const c of clientsData || []) {
      const row = c as Record<string, unknown>;
      const id = String(row.id || "");
      if (!id) continue;
      clientMap[id] = {
        name: String(row.name || "—"),
        phone: String(row.phone || ""),
        cpf: row.cpf != null ? String(row.cpf) : null,
        email: row.email != null ? String(row.email) : null,
        address: row.address != null ? String(row.address) : null,
      };
    }
  }

  const loanIds = [...new Set(rows.map((r) => String(r.loan_id || "")).filter(Boolean))];

  const paymentsByLoan: Record<string, RemarketingPaymentRow[]> = {};
  if (loanIds.length > 0) {
    const { data: payData, error: payErr } = await supabase
      .from("payments")
      .select("id, loan_id, amount, payment_date, payment_type, fine_amount, notes, created_at")
      .in("loan_id", loanIds)
      .order("payment_date", { ascending: false });

    if (payErr) throw payErr;
    for (const p of payData || []) {
      const row = p as Record<string, unknown>;
      const lid = String(row.loan_id || "");
      if (!lid) continue;
      if (!paymentsByLoan[lid]) paymentsByLoan[lid] = [];
      paymentsByLoan[lid].push({
        id: String(row.id || ""),
        loan_id: lid,
        amount: parseFloat(String(row.amount || 0)),
        payment_date: String(row.payment_date || row.created_at || ""),
        payment_type: String(row.payment_type || ""),
        fine_amount: parseFloat(String(row.fine_amount || 0)),
        notes: row.notes != null ? String(row.notes) : null,
        created_at: String(row.created_at || ""),
      });
    }
  }

  const scores: Record<string, ClientScoreResult | null> = {};
  await Promise.all(
    clientIds.map(async (cid) => {
      try {
        scores[cid] = await fetchClientScore(cid);
      } catch {
        scores[cid] = null;
      }
    }),
  );

  return rows.map((r) => {
    const lid = String(r.loan_id || "");
    const cid = clientIdByLoanId[lid] || String(r.client_id || "");
    const c = clientMap[cid] || {
      name: "—",
      phone: "",
      cpf: null as string | null,
      email: null as string | null,
      address: null as string | null,
    };
    return {
      paidLoanId: String(r.id || ""),
      loanId: lid,
      clientId: cid,
      clientName: c.name,
      clientPhone: c.phone,
      clientCpf: c.cpf,
      clientEmail: c.email,
      clientAddress: c.address,
      originalAmount: parseFloat(String(r.original_amount || 0)),
      interestRate: parseFloat(String(r.interest_rate || 0)),
      loanDate: String(r.loan_date || "").split("T")[0],
      dueDate: String(r.due_date || "").split("T")[0],
      paidDate: String(r.paid_date || "").split("T")[0],
      totalPaid: r.total_paid != null ? parseFloat(String(r.total_paid)) : null,
      paymentMethod: r.payment_method != null ? String(r.payment_method) : null,
      quitadoNotes: r.notes != null ? String(r.notes) : null,
      payments: paymentsByLoan[lid] || [],
      clientScore: scores[cid] ?? null,
    };
  });
}
