import { supabase } from "@/lib/supabase";
import { PAGE_SIZE } from "@/lib/constants";
import { calculateClientScore } from "@/api/client-score";

/** `search` filtra no servidor (nome, CPF ou e-mail), com paginação sobre o resultado. */
export async function fetchClients(page = 1, search = "") {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("clients")
    .select("id, name, cpf, phone, email, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  const q = search.trim();
  if (q) {
    const esc = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const pattern = `%${esc}%`;
    const quoted = `"${pattern.replace(/"/g, '""')}"`;
    query = query.or(`name.ilike.${quoted},cpf.ilike.${quoted},email.ilike.${quoted}`);
  }

  const { data, error, count } = await query.range(from, to);

  if (error) throw error;

  const clients = data || [];
  const clientIds = clients.map((c: Record<string, unknown>) => c.id).filter(Boolean);
  const { data: loansData } =
    clientIds.length > 0
      ? await supabase.from("loans").select("client_id, status").in("client_id", clientIds).in("status", ["active", "overdue", "partial_paid"])
      : { data: [] };
  const loanCountByClient: Record<string, number> = {};
  const overdueByClient: Record<string, boolean> = {};
  (loansData || []).forEach((l: Record<string, unknown>) => {
    const cid = String(l.client_id);
    loanCountByClient[cid] = (loanCountByClient[cid] || 0) + 1;
    if (l.status === "overdue") overdueByClient[cid] = true;
  });

  const items = clients.map((c: Record<string, unknown>) => ({
    id: c.id,
    name: c.name,
    cpf: c.cpf,
    phone: c.phone,
    email: c.email,
    loans: loanCountByClient[String(c.id)] || 0,
    status: overdueByClient[String(c.id)] ? "overdue" : "active",
  }));
  return { data: items, total: count ?? 0 };
}

export async function fetchClientsForPdf(dateFrom?: string, dateTo?: string) {
  let query = supabase
    .from("clients")
    .select("id, name, cpf, phone, email, created_at")
    .order("name", { ascending: true })
    .limit(1000);

  if (dateFrom) {
    query = query.gte("created_at", dateFrom + "T00:00:00");
  }
  if (dateTo) {
    query = query.lte("created_at", dateTo + "T23:59:59");
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((c: Record<string, unknown>) => ({
    id: c.id,
    name: (c.name as string) || "—",
    cpf: (c.cpf as string) || "—",
    phone: (c.phone as string) || "—",
    email: (c.email as string) || "—",
    created_at: (c.created_at as string)?.split("T")[0] ?? "",
  }));
}

export async function fetchClientsForSelect() {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(500);

  if (error) throw error;
  return (data || []).map((c: Record<string, unknown>) => ({
    id: c.id,
    name: (c.name as string) || "—",
  }));
}

export async function fetchClientById(id: string) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function fetchClientHistory(clientId: string) {
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .single();

  if (clientErr || !client) throw clientErr || new Error("Cliente não encontrado");

  const loansRes = await supabase
    .from("loans")
    .select("id, amount, interest_rate, loan_date, due_date, status, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1000);

  const loans = loansRes.data || [];
  const loanIdsFromLoans = loans.map((l: Record<string, unknown>) => l.id).filter(Boolean);

  let paidRes = await supabase
    .from("paid_loans")
    .select("loan_id, original_amount, interest_rate, loan_date, due_date, paid_date")
    .eq("client_id", clientId)
    .order("paid_date", { ascending: false })
    .limit(1000);
  let paidLoans = paidRes.error ? [] : (paidRes.data || []);

  if (paidLoans.length === 0 && loanIdsFromLoans.length > 0) {
    paidRes = await supabase
      .from("paid_loans")
      .select("loan_id, original_amount, interest_rate, loan_date, due_date, paid_date")
      .in("loan_id", loanIdsFromLoans)
      .order("paid_date", { ascending: false })
      .limit(1000);
    paidLoans = paidRes.error ? [] : (paidRes.data || []);
  }
  const loanIds = [...new Set([
    ...loans.map((l: Record<string, unknown>) => l.id).filter(Boolean),
    ...paidLoans.map((p: Record<string, unknown>) => p.loan_id).filter(Boolean),
  ])];

  let payments: Array<Record<string, unknown>> = [];
  if (loanIds.length > 0) {
    const { data: paymentsData } = await supabase
      .from("payments")
      .select("id, loan_id, amount, payment_date, payment_type, fine_amount, notes, created_at")
      .in("loan_id", loanIds)
      .order("payment_date", { ascending: false });
    payments = paymentsData || [];
  }

  const loanById: Record<string, Record<string, unknown>> = {};
  for (const l of loans) {
    loanById[String(l.id)] = l;
  }
  for (const p of paidLoans) {
    const row = p as Record<string, unknown>;
    if (!loanById[String(row.loan_id)]) {
      loanById[String(row.loan_id)] = {
        id: row.loan_id,
        amount: row.original_amount,
        interest_rate: row.interest_rate,
        loan_date: row.loan_date,
        due_date: row.due_date,
        status: "paid",
        created_at: row.paid_date,
        paid_date: row.paid_date,
      };
    }
  }

  const loansList = Object.values(loanById).sort((a, b) => {
    const da = new Date(String(a.created_at || "")).getTime();
    const db = new Date(String(b.created_at || "")).getTime();
    return db - da;
  });

  const totalPaid = payments.reduce(
    (s: number, p: Record<string, unknown>) =>
      s + parseFloat(String(p.amount || 0)) + parseFloat(String((p as { fine_amount?: number }).fine_amount || 0)),
    0
  );

  const score = calculateClientScore({
    loans: loansList.map((l: Record<string, unknown>) => ({
      id: String(l.id),
      amount: parseFloat(String(l.amount || 0)),
      interest_rate: parseFloat(String(l.interest_rate || 0)),
      due_date: l.due_date,
      status: String(l.status || ""),
      paid_date: l.paid_date,
    })),
    totalLoans: Object.keys(loanById).length,
    totalPaid,
  });

  return {
    client,
    loans: loansList,
    payments: payments.map((p: Record<string, unknown>) => ({
      ...p,
      loan_amount: loanById[String(p.loan_id)]?.amount,
    })),
    totalLoans: Object.keys(loanById).length,
    totalPayments: payments.length,
    totalPaid,
    score,
  };
}

export async function fetchClientScore(clientId: string) {
  const loansRes = await supabase
    .from("loans")
    .select("id, amount, interest_rate, due_date, status, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1000);

  const loans = loansRes.data || [];
  const loanIdsFromLoans = loans.map((l: Record<string, unknown>) => l.id).filter(Boolean);

  let paidRes = await supabase
    .from("paid_loans")
    .select("loan_id, original_amount, interest_rate, due_date, paid_date")
    .eq("client_id", clientId)
    .order("paid_date", { ascending: false })
    .limit(1000);
  let paidLoans = paidRes.error ? [] : (paidRes.data || []);

  if (paidLoans.length === 0 && loanIdsFromLoans.length > 0) {
    paidRes = await supabase
      .from("paid_loans")
      .select("loan_id, original_amount, interest_rate, due_date, paid_date")
      .in("loan_id", loanIdsFromLoans)
      .order("paid_date", { ascending: false })
      .limit(1000);
    paidLoans = paidRes.error ? [] : (paidRes.data || []);
  }

  const loanIds = [...new Set([
    ...loans.map((l: Record<string, unknown>) => l.id).filter(Boolean),
    ...paidLoans.map((p: Record<string, unknown>) => p.loan_id).filter(Boolean),
  ])];

  let payments: Array<Record<string, unknown>> = [];
  if (loanIds.length > 0) {
    const { data: paymentsData } = await supabase
      .from("payments")
      .select("loan_id, amount, fine_amount")
      .in("loan_id", loanIds);
    payments = paymentsData || [];
  }

  const loanById: Record<string, Record<string, unknown>> = {};
  for (const l of loans) loanById[String(l.id)] = l;
  for (const p of paidLoans) {
    const row = p as Record<string, unknown>;
    if (!loanById[String(row.loan_id)]) {
      loanById[String(row.loan_id)] = {
        id: row.loan_id,
        amount: row.original_amount,
        interest_rate: row.interest_rate,
        due_date: row.due_date,
        status: "paid",
        created_at: row.paid_date,
        paid_date: row.paid_date,
      };
    } else {
      loanById[String(row.loan_id)] = {
        ...loanById[String(row.loan_id)],
        status: "paid",
        paid_date: row.paid_date,
      };
    }
  }

  const loansList = Object.values(loanById).sort((a, b) => {
    const da = new Date(String(a.created_at || "")).getTime();
    const db = new Date(String(b.created_at || "")).getTime();
    return db - da;
  });

  const totalPaid = payments.reduce(
    (s: number, p: Record<string, unknown>) =>
      s
      + parseFloat(String(p.amount || 0))
      + parseFloat(String((p as { fine_amount?: number }).fine_amount || 0)),
    0
  );

  return calculateClientScore({
    loans: loansList.map((l: Record<string, unknown>) => ({
      id: String(l.id),
      amount: parseFloat(String(l.amount || 0)),
      interest_rate: parseFloat(String(l.interest_rate || 0)),
      due_date: l.due_date,
      status: String(l.status || ""),
      paid_date: l.paid_date,
    })),
    totalLoans: Object.keys(loanById).length,
    totalPaid,
  });
}
