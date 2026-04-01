import { supabase } from "@/lib/supabase";

export type InstallmentPayment = {
  id: string;
  installment_id: string;
  installment_number: number;
  amount: number;
  due_date: string;
  paid_date: string | null;
  paid_amount: number | null;
  status: string;
  payment_method: string | null;
  notes: string | null;
};

export type InstallmentRow = {
  id: string;
  client_id: string;
  client_name: string;
  client_phone?: string;
  total_amount: number;
  total_installments: number;
  installment_amount: number;
  first_due_date: string;
  interest_rate: number;
  status: string;
  notes: string | null;
  created_at: string;
  installment_payments: Array<{
    id: string;
    status: string;
    due_date: string;
    paid_date: string | null;
    amount: number;
    paid_amount?: number;
  }>;
};

export async function fetchInstallments(): Promise<InstallmentRow[]> {
  const { data, error } = await supabase
    .from("installments")
    .select(
      `
      id,
      client_id,
      total_amount,
      total_installments,
      installment_amount,
      first_due_date,
      interest_rate,
      status,
      notes,
      created_at,
      clients (name, phone),
      installment_payments (id, status, due_date, paid_date, amount, paid_amount)
    `
    )
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).map((row: Record<string, unknown>) => {
    const clients = (row.clients as { name?: string; phone?: string }) || {};
    const payments = (row.installment_payments as Array<Record<string, unknown>>) || [];
    return {
      id: row.id,
      client_id: row.client_id,
      client_name: clients.name || "—",
      client_phone: clients.phone || "",
      total_amount: parseFloat(String(row.total_amount || 0)),
      total_installments: Number(row.total_installments || 0),
      installment_amount: parseFloat(String(row.installment_amount || 0)),
      first_due_date: row.first_due_date || "",
      interest_rate: parseFloat(String(row.interest_rate || 0)),
      status: row.status || "active",
      notes: row.notes as string | null,
      created_at: row.created_at || "",
      installment_payments: payments.map((p) => ({
        id: p.id,
        status: p.status || "pending",
        due_date: p.due_date || "",
        paid_date: p.paid_date,
        amount: parseFloat(String(p.amount || 0)),
        paid_amount: p.paid_amount != null ? parseFloat(String(p.paid_amount)) : undefined,
      })),
    };
  });
}

export async function fetchInstallmentById(id: string) {
  const { data, error } = await supabase
    .from("installments")
    .select(
      `
      *,
      clients (name, cpf, phone),
      installment_payments (*)
    `
    )
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function createInstallment(params: {
  client_id: string;
  total_amount: number;
  total_installments: number;
  installment_amount: number;
  first_due_date: string;
  interest_rate?: number;
  notes?: string;
  loan_id?: string | null;
}) {
  const loanId = params.loan_id?.trim() || null;
  if (loanId) {
    const { data: loan, error: loanErr } = await supabase
      .from("loans")
      .select("id, client_id, status")
      .eq("id", loanId)
      .single();
    if (loanErr || !loan) throw new Error("Empréstimo não encontrado");
    if (String(loan.client_id) !== String(params.client_id)) {
      throw new Error("O empréstimo selecionado não pertence a este cliente");
    }
    const st = String(loan.status || "");
    if (st === "paid" || st === "cancelled" || st === "installments") {
      throw new Error("Este empréstimo não pode ser vinculado a um parcelamento");
    }
    const { data: existingInst } = await supabase
      .from("installments")
      .select("id")
      .eq("loan_id", loanId)
      .eq("status", "active")
      .maybeSingle();
    if (existingInst?.id) {
      throw new Error("Já existe um parcelamento ativo vinculado a este empréstimo");
    }
  }

  const { data: installment, error: instErr } = await supabase
    .from("installments")
    .insert([
      {
        client_id: params.client_id,
        total_amount: params.total_amount,
        total_installments: params.total_installments,
        installment_amount: params.installment_amount,
        first_due_date: params.first_due_date,
        interest_rate: params.interest_rate ?? 0,
        notes: params.notes || null,
        loan_id: loanId,
      },
    ])
    .select()
    .single();

  if (instErr) throw instErr;

  if (loanId) {
    const { error: upLoanErr } = await supabase.from("loans").update({ status: "installments" }).eq("id", loanId);
    if (upLoanErr) throw upLoanErr;
  }

  const firstDate = new Date(params.first_due_date);
  const payments: Array<{ installment_id: string; installment_number: number; amount: number; due_date: string }> = [];

  for (let i = 1; i <= params.total_installments; i++) {
    const d = new Date(firstDate);
    d.setMonth(d.getMonth() + (i - 1));
    payments.push({
      installment_id: installment.id,
      installment_number: i,
      amount: params.installment_amount,
      due_date: d.toISOString().split("T")[0],
    });
  }

  const { error: payErr } = await supabase.from("installment_payments").insert(payments);
  if (payErr) throw payErr;

  return installment;
}

export async function recordInstallmentPayment(
  paymentId: string,
  params: {
    paid_amount: number;
    paid_date: string;
    payment_method: string;
    notes?: string;
  }
) {
  const { data: payment, error: fetchErr } = await supabase
    .from("installment_payments")
    .select("amount")
    .eq("id", paymentId)
    .single();

  if (fetchErr) throw fetchErr;

  const status = params.paid_amount >= parseFloat(String(payment.amount)) ? "paid" : "partial";

  const { error } = await supabase
    .from("installment_payments")
    .update({
      paid_amount: params.paid_amount,
      paid_date: params.paid_date,
      status,
      payment_method: params.payment_method,
      notes: params.notes || null,
    })
    .eq("id", paymentId);

  if (error) throw error;
}

export async function cancelInstallment(id: string) {
  const { data: row, error: fetchErr } = await supabase
    .from("installments")
    .select("loan_id")
    .eq("id", id)
    .single();
  if (fetchErr) throw fetchErr;

  const { error } = await supabase.from("installments").update({ status: "cancelled" }).eq("id", id);
  if (error) throw error;

  const lid = row?.loan_id ? String(row.loan_id) : "";
  if (lid) {
    const { error: loanErr } = await supabase.from("loans").update({ status: "active" }).eq("id", lid);
    if (loanErr) throw loanErr;
  }
}
