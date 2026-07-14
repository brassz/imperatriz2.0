import { supabase } from "@/lib/supabase";
import { PAGE_SIZE } from "@/lib/constants";

export async function fetchPayments(
  page = 1,
  filters?: { dateFrom?: string; dateTo?: string }
) {
  let query = supabase
    .from("payments")
    .select("id, loan_id, amount, payment_date, payment_type, notes, fine_amount, created_at", {
      count: "exact",
    })
    .order("payment_date", { ascending: false });

  if (filters?.dateFrom) {
    query = query.gte("payment_date", filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte("payment_date", filters.dateTo);
  }

  const { data, error, count } = await query.range(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE - 1
  );

  if (error) throw error;

  const list = data || [];
  if (list.length === 0) return { data: [], total: count ?? 0 };

  const loanIds = [...new Set(list.map((p: Record<string, unknown>) => p.loan_id).filter(Boolean))];
  const { data: loansData } = await supabase.from("loans").select("id, client_id").in("id", loanIds);
  const clientIds = [...new Set((loansData || []).map((l: Record<string, unknown>) => l.client_id).filter(Boolean))];
  const { data: clientsData } = await supabase.from("clients").select("id, name").in("id", clientIds);

  const clientById: Record<string, string> = {};
  (clientsData || []).forEach((c: Record<string, unknown>) => {
    clientById[String(c.id)] = String(c.name || "—");
  });

  const clientByLoan: Record<string, string> = {};
  (loansData || []).forEach((l: Record<string, unknown>) => {
    clientByLoan[String(l.id)] = clientById[String(l.client_id)] ?? "—";
  });

  const items = list.map((p: Record<string, unknown>) => ({
    id: p.id,
    loan_id: p.loan_id,
    client_name: clientByLoan[String(p.loan_id)] ?? "—",
    amount: parseFloat(String(p.amount || 0)),
    fine_amount: parseFloat(String((p as { fine_amount?: number }).fine_amount || 0)),
    payment_date: (p.payment_date || p.created_at || "").toString().split("T")[0],
    payment_type: p.payment_type || "—",
    notes: p.notes || "",
  }));
  return { data: items, total: count ?? 0 };
}

export async function fetchPaymentsTotalForPeriod(dateFrom: string, dateTo: string): Promise<number> {
  const { data, error } = await supabase
    .from("payments")
    .select("amount, fine_amount")
    .gte("payment_date", dateFrom)
    .lte("payment_date", dateTo);

  if (error) throw error;

  const list = data || [];
  return list.reduce(
    (s, p) =>
      s +
      parseFloat(String(p.amount || 0)) +
      parseFloat(String((p as { fine_amount?: number }).fine_amount || 0)),
    0
  );
}

export async function fetchPaymentsByDateRange(dateFrom: string, dateTo: string) {
  const { data, error } = await supabase
    .from("payments")
    .select("id, loan_id, amount, payment_date, payment_type, notes, fine_amount, created_at")
    .gte("payment_date", dateFrom)
    .lte("payment_date", dateTo)
    .order("payment_date", { ascending: true });

  if (error) throw error;

  const list = data || [];
  if (list.length === 0) return [];

  const loanIds = [...new Set(list.map((p: Record<string, unknown>) => p.loan_id).filter(Boolean))];
  const { data: loansData } = await supabase.from("loans").select("id, client_id").in("id", loanIds);
  const clientIds = [...new Set((loansData || []).map((l: Record<string, unknown>) => l.client_id).filter(Boolean))];
  const { data: clientsData } = await supabase.from("clients").select("id, name").in("id", clientIds);

  const clientById: Record<string, string> = {};
  (clientsData || []).forEach((c: Record<string, unknown>) => {
    clientById[String(c.id)] = String(c.name || "—");
  });

  const clientByLoan: Record<string, string> = {};
  (loansData || []).forEach((l: Record<string, unknown>) => {
    clientByLoan[String(l.id)] = clientById[String(l.client_id)] ?? "—";
  });

  return list.map((p: Record<string, unknown>) => ({
    id: p.id,
    loan_id: p.loan_id,
    client_name: clientByLoan[String(p.loan_id)] ?? "—",
    amount: parseFloat(String(p.amount || 0)),
    fine_amount: parseFloat(String((p as { fine_amount?: number }).fine_amount || 0)),
    payment_date: (p.payment_date || p.created_at || "").toString().split("T")[0],
    payment_type: p.payment_type || "—",
    notes: p.notes || "",
  }));
}

export async function fetchPaymentsByLoanId(loanId: string) {
  const { data, error } = await supabase
    .from("payments")
    .select("id, loan_id, amount, payment_date, payment_type, notes, fine_amount, created_at")
    .eq("loan_id", loanId)
    .order("payment_date", { ascending: false });

  if (error) throw error;

  return (data || []).map((p: Record<string, unknown>) => ({
    id: p.id,
    loan_id: p.loan_id,
    amount: parseFloat(String(p.amount || 0)),
    fine_amount: parseFloat(String((p as { fine_amount?: number }).fine_amount || 0)),
    payment_date: (p.payment_date || p.created_at || "").toString().split("T")[0],
    /** ISO completo do servidor (data e hora do registro). */
    created_at: String(p.created_at || ""),
    payment_type: p.payment_type || "—",
    notes: p.notes || "",
  }));
}

function throwPaymentInsertError(error: { message?: string; code?: string; details?: string }, action: string): never {
  const msg = String(error.message || "");
  const code = String(error.code || "");
  if (code === "23514" || msg.includes("payments_payment_type_check")) {
    throw new Error(
      `${action}: o banco rejeitou o tipo de pagamento (CHECK payments_payment_type_check). ` +
        `No SQL Editor do Supabase, execute ` +
        `supabase/migrations/20260714140000_imperatriz_fix_payments_quitacao.sql. Detalhe: ${msg}`,
    );
  }
  throw new Error(msg || `${action}: erro ao gravar pagamento`);
}

export async function createRenewalPayment(data: {
  loan_id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  notes: string;
  fine_amount?: number;
  new_due_date: string;
}) {
  const { loan_id, amount, payment_date, payment_type, notes, fine_amount } = data;
  const { error: payErr } = await supabase.from("payments").insert([{
    loan_id,
    amount,
    payment_date,
    payment_type,
    notes,
    fine_amount: fine_amount ?? 0,
  }]);
  if (payErr) throwPaymentInsertError(payErr, "Registrar pagamento");

  const { error: loanErr } = await supabase
    .from("loans")
    .update({ due_date: data.new_due_date, status: "active" })
    .eq("id", loan_id);
  if (loanErr) throw loanErr;

  const renewalNote = `EMPRÉSTIMO RENOVADO: Data de vencimento estendida. Nova data: ${data.new_due_date.split("T")[0]}. ${notes}`;
  const { error: renewalErr } = await supabase.from("payments").insert([{
    loan_id,
    amount: 0,
    payment_date,
    payment_type: "loan_renewal",
    notes: renewalNote,
    fine_amount: 0,
  }]);
  if (renewalErr) throwPaymentInsertError(renewalErr, "Registrar renovação");
}

export async function deletePayment(paymentId: string) {
  const { error } = await supabase.from("payments").delete().eq("id", paymentId);
  if (error) throw error;
}

export async function createPayment(data: {
  loan_id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  notes?: string;
  fine_amount?: number;
}) {
  const { error } = await supabase.from("payments").insert([{
    loan_id: data.loan_id,
    amount: data.amount,
    payment_date: data.payment_date,
    payment_type: data.payment_type,
    notes: data.notes || null,
    fine_amount: data.fine_amount ?? 0,
  }]);
  if (error) throwPaymentInsertError(error, "Registrar pagamento");
}
