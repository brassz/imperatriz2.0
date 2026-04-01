import { supabase } from "@/lib/supabase";
import { PAGE_SIZE } from "@/lib/constants";

const INTEREST_ONLY_TYPES = [
  "renewal",
  "interest_renewal",
  "early_payment_partial_interest",
  "early_payment_interest_renewal",
  "partial_interest",
];

function computeRemaining(
  originalCapital: number,
  interestRate: number,
  payments: Array<{ amount: number; payment_type: string; fine_amount: number }>
): number {
  let rate = interestRate;
  if (rate > 100) rate = rate / 100;
  const realPayments = payments.filter((p) => p.amount > 0);
  let capitalPaid = 0;
  let currentCapital = originalCapital;
  for (const payment of realPayments) {
    const amt = payment.amount;
    const type = String(payment.payment_type || "");
    if (!INTEREST_ONLY_TYPES.includes(type)) {
      const currentInterest = currentCapital * (rate / 100);
      if (amt > currentInterest) {
        capitalPaid += amt - currentInterest;
        currentCapital = Math.max(0, currentCapital - (amt - currentInterest));
      }
    }
  }
  const remainingCapital = Math.max(0, originalCapital - capitalPaid);
  const remainingInterest = remainingCapital * (rate / 100);
  return remainingCapital + remainingInterest;
}

async function attachRemainingAmounts(
  items: Array<Record<string, unknown>>
): Promise<void> {
  const nonPaid = items.filter(
    (r) => r.status !== "paid" && r.status !== "cancelled" && r.status !== "installments"
  );
  if (nonPaid.length === 0) return;
  const loanIds = nonPaid.map((r) => String(r.id));
  const { data: paymentsData } = await supabase
    .from("payments")
    .select("loan_id, amount, payment_type, fine_amount")
    .in("loan_id", loanIds)
    .order("created_at", { ascending: true });

  const byLoan: Record<string, Array<{ amount: number; payment_type: string; fine_amount: number }>> = {};
  for (const p of paymentsData || []) {
    const row = p as { loan_id: string; amount: number; payment_type: string; fine_amount?: number };
    if (!byLoan[row.loan_id]) byLoan[row.loan_id] = [];
    byLoan[row.loan_id].push({
      amount: parseFloat(String(row.amount || 0)),
      payment_type: String(row.payment_type || ""),
      fine_amount: parseFloat(String(row.fine_amount || 0)),
    });
  }

  for (const item of nonPaid) {
    const cap = parseFloat(String(item.amount || 0));
    const rate = parseFloat(String(item.interest_rate || 0));
    const payments = byLoan[String(item.id)] || [];
    item.remaining_amount = computeRemaining(cap, rate, payments);
  }
  for (const item of items) {
    if (item.status === "paid" || item.status === "cancelled") {
      item.remaining_amount = 0;
    }
    if (item.status === "installments") {
      (item as Record<string, unknown>).remaining_amount = undefined;
    }
  }
}

function mapLoanRow(loan: Record<string, unknown>, client: (c: unknown) => { name?: string; cpf?: string; phone?: string; email?: string }) {
  const cl = client(loan.clients);
  return {
    id: loan.id,
    client_id: loan.client_id,
    client_name: cl.name || "—",
    client_phone: cl.phone || "",
    client_cpf: cl.cpf || "",
    client_email: cl.email || "",
    amount: parseFloat(String(loan.amount || 0)),
    interest_rate: parseFloat(String(loan.interest_rate || 0)),
    loan_date: loan.loan_date,
    due_date: loan.due_date,
    status: loan.status,
    created_at: loan.created_at,
  };
}

async function hydrateClientsForLoans(rows: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  // Alguns ambientes retornam `clients: null` no join (RLS/relacionamento).
  // Para não perder empréstimos na busca por nome, carregamos os clientes por client_id.
  const clientIds = [...new Set(rows.map((r) => String(r.client_id || "")).filter(Boolean))];
  let clientById: Record<string, { name?: string; cpf?: string; phone?: string; email?: string }> = {};
  if (clientIds.length > 0) {
    const { data, error } = await supabase
      .from("clients")
      .select("id, name, cpf, phone, email")
      .in("id", clientIds);
    if (error) throw error;
    for (const c of data || []) {
      const r = c as Record<string, unknown>;
      clientById[String(r.id)] = {
        name: String(r.name || ""),
        cpf: String(r.cpf || ""),
        phone: String(r.phone || ""),
        email: String(r.email || ""),
      };
    }
  }

  return rows.map((loan) => {
    const cl = ((loan.clients as unknown) as { name?: string; cpf?: string; phone?: string; email?: string }) || {};
    const fallback = clientById[String(loan.client_id || "")] || {};
    const mergedClient = {
      name: cl.name || fallback.name,
      cpf: cl.cpf || fallback.cpf,
      phone: cl.phone || fallback.phone,
      email: cl.email || fallback.email,
    };
    return {
      id: loan.id,
      client_id: loan.client_id,
      client_name: mergedClient.name || "—",
      client_phone: mergedClient.phone || "",
      client_cpf: mergedClient.cpf || "",
      client_email: mergedClient.email || "",
      amount: parseFloat(String(loan.amount || 0)),
      interest_rate: parseFloat(String(loan.interest_rate || 0)),
      loan_date: loan.loan_date,
      due_date: loan.due_date,
      status: loan.status,
      created_at: loan.created_at,
    } as Record<string, unknown>;
  });
}

/**
 * Nomes para linhas de paid_loans: usa `paid_loans.client_id` quando existir (registros antigos ou RLS em `loans`),
 * senão faz fallback pelo empréstimo em `loans`.
 */
export async function resolvePaidLoanClientNames(paidRows: Array<Record<string, unknown>>): Promise<{
  clientNameByLoanId: Record<string, string>;
  clientIdByLoanId: Record<string, string>;
}> {
  const clientIdByLoanId: Record<string, string> = {};
  const loanIdsNeedingLookup: string[] = [];

  for (const p of paidRows) {
    const lid = String(p.loan_id ?? "");
    if (!lid) continue;
    const fromRow = p.client_id != null && String(p.client_id).trim() !== "" ? String(p.client_id) : "";
    if (fromRow) {
      clientIdByLoanId[lid] = fromRow;
    } else {
      loanIdsNeedingLookup.push(lid);
    }
  }

  const uniqueNeed = [...new Set(loanIdsNeedingLookup)];
  if (uniqueNeed.length > 0) {
    const { data: loansData } = await supabase.from("loans").select("id, client_id").in("id", uniqueNeed);
    for (const l of loansData || []) {
      const row = l as Record<string, unknown>;
      const lid = String(row.id);
      const cid = row.client_id != null && String(row.client_id).trim() !== "" ? String(row.client_id) : "";
      if (cid && !clientIdByLoanId[lid]) {
        clientIdByLoanId[lid] = cid;
      }
    }
  }

  const uniqueClientIds = [...new Set(Object.values(clientIdByLoanId).filter(Boolean))];
  const clientByName: Record<string, string> = {};
  if (uniqueClientIds.length > 0) {
    const { data: clientsData } = await supabase.from("clients").select("id, name").in("id", uniqueClientIds);
    for (const c of clientsData || []) {
      const row = c as Record<string, unknown>;
      clientByName[String(row.id)] = String(row.name ?? "—");
    }
  }

  const clientNameByLoanId: Record<string, string> = {};
  for (const p of paidRows) {
    const lid = String(p.loan_id ?? "");
    const cid = clientIdByLoanId[lid];
    clientNameByLoanId[lid] = cid ? (clientByName[cid] ?? "—") : "—";
  }

  return { clientNameByLoanId, clientIdByLoanId };
}

export async function fetchLoans(
  statusFilter?: string,
  page = 1,
  search?: string,
  opts?: { periodFrom?: string; periodTo?: string }
) {
  const client = (c: unknown) => (c as { name?: string; cpf?: string; phone?: string; email?: string }) || {};

  let items: Array<Record<string, unknown>> = [];
  let total = 0;

  // Lote que respeita limite por requisição do Supabase (ex.: 50); múltiplas requisições até trazer tudo
  const CHUNK = 50;
  const searchTerm = (search || "").trim();
  const periodFrom = String(opts?.periodFrom || "").trim();
  const periodTo = String(opts?.periodTo || "").trim();
  const todayYmd = new Date().toISOString().split("T")[0];
  const tomorrowYmd = (() => {
    const d = new Date(todayYmd + "T12:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  })();

  function applyCommonLoanFilters<T extends ReturnType<typeof supabase.from>>(
    q: any,
    extra?: { includeInstallments?: boolean }
  ) {
    let query = q;
    // normal: não listar empréstimos já vinculados a parcelamento
    if (!extra?.includeInstallments) query = query.neq("status", "installments");
    if (periodFrom) query = query.gte("loan_date", periodFrom);
    if (periodTo) query = query.lte("loan_date", periodTo);
    if (searchClientIds) query = query.in("client_id", searchClientIds);
    return query;
  }

  async function resolveClientIdsForSearch(): Promise<string[] | null> {
    if (!searchTerm) return null;
    const digits = searchTerm.replace(/\D/g, "");
    const isCpf = digits.length === 11;

    let q = supabase.from("clients").select("id");
    if (isCpf) {
      q = q.eq("cpf", digits);
    } else {
      q = q.ilike("name", `%${searchTerm}%`);
    }
    const { data, error } = await q.limit(500);
    if (error) throw error;
    const ids = (data || []).map((r: Record<string, unknown>) => String(r.id)).filter(Boolean);
    return ids.length ? ids : [];
  }

  const searchClientIds = await resolveClientIdsForSearch();

  if (statusFilter === "paid") {
    let q = supabase
      .from("paid_loans")
      .select("loan_id, client_id, original_amount, interest_rate, loan_date, due_date, paid_date")
      .order("paid_date", { ascending: false })
      .limit(10000);
    if (periodFrom) q = q.gte("loan_date", periodFrom);
    if (periodTo) q = q.lte("loan_date", periodTo);
    // paid_loans tem client_id (usado em markLoanAsPaid); filtra para busca por cliente
    if (searchClientIds) q = q.in("client_id", searchClientIds);
    const { data: paidData, error: paidErr } = await q;

    if (paidErr) throw paidErr;

    const paidList = (paidData || []) as Array<Record<string, unknown>>;
    const { clientNameByLoanId, clientIdByLoanId } = await resolvePaidLoanClientNames(paidList);

    const paidItems = paidList.map((p: Record<string, unknown>) => {
      const lid = String(p.loan_id ?? "");
      const cid = clientIdByLoanId[lid] ?? "";
      const clientName = clientNameByLoanId[lid] ?? "—";
      return {
        id: p.loan_id,
        client_id: cid,
        client_name: clientName,
        client_phone: "",
        client_cpf: "",
        client_email: "",
        amount: parseFloat(String(p.original_amount || 0)),
        interest_rate: parseFloat(String(p.interest_rate || 0)),
        loan_date: p.loan_date,
        due_date: p.due_date,
        status: "paid",
        created_at: p.paid_date,
      };
    });
    total = paidItems.length;
    const start = (page - 1) * PAGE_SIZE;
    items = paidItems.slice(start, start + PAGE_SIZE);
  } else if (statusFilter === "all") {
    let allLoans: Array<Record<string, unknown>> = [];
    let allPaid: Array<Record<string, unknown>> = [];
    let offsetLoans = 0;
    let offsetPaid = 0;
    let hasMoreLoans = true;
    let hasMorePaid = true;

    while (hasMoreLoans || hasMorePaid) {
      if (hasMoreLoans) {
        let q = supabase
          .from("loans")
          .select("id, client_id, amount, interest_rate, loan_date, due_date, status, created_at, clients (name, cpf, email, phone)")
          .neq("status", "installments")
          .order("created_at", { ascending: false });
        if (periodFrom) q = q.gte("loan_date", periodFrom);
        if (periodTo) q = q.lte("loan_date", periodTo);
        if (searchClientIds) q = q.in("client_id", searchClientIds);
        const { data: chunk, error } = await q.range(offsetLoans, offsetLoans + CHUNK - 1);
        if (error) throw error;
        const list = chunk || [];
        allLoans = allLoans.concat(list);
        hasMoreLoans = list.length === CHUNK;
        offsetLoans += CHUNK;
      }
      if (hasMorePaid) {
        let q = supabase
          .from("paid_loans")
          .select("loan_id, client_id, original_amount, interest_rate, loan_date, due_date, paid_date")
          .order("paid_date", { ascending: false });
        if (periodFrom) q = q.gte("loan_date", periodFrom);
        if (periodTo) q = q.lte("loan_date", periodTo);
        // paid_loans tem client_id (usado em markLoanAsPaid); filtra para busca por cliente
        if (searchClientIds) q = q.in("client_id", searchClientIds);
        const { data: chunk, error } = await q.range(offsetPaid, offsetPaid + CHUNK - 1);
        if (error) throw error;
        const list = chunk || [];
        allPaid = allPaid.concat(list);
        hasMorePaid = list.length === CHUNK;
        offsetPaid += CHUNK;
      }
    }

    const paidRows = allPaid as Array<Record<string, unknown>>;
    const { clientNameByLoanId, clientIdByLoanId } = await resolvePaidLoanClientNames(paidRows);

    const byId = new Map<string, Record<string, unknown>>();
    const hydratedAllLoans = await hydrateClientsForLoans(allLoans as Array<Record<string, unknown>>);
    for (const row of hydratedAllLoans) {
      byId.set(String(row.id), row);
    }
    for (const p of allPaid) {
      const pid = String((p as Record<string, unknown>).loan_id);
      if (byId.has(pid)) continue;
      const rec = p as Record<string, unknown>;
      const cid = clientIdByLoanId[pid] ?? "";
      const clientName = clientNameByLoanId[pid] ?? "—";
      byId.set(pid, {
        id: rec.loan_id,
        client_id: cid,
        client_name: clientName,
        client_phone: "",
        client_cpf: "",
        client_email: "",
        amount: parseFloat(String(rec.original_amount || 0)),
        interest_rate: parseFloat(String(rec.interest_rate || 0)),
        loan_date: rec.loan_date,
        due_date: rec.due_date,
        status: "paid",
        created_at: rec.paid_date,
      });
    }
    // Ordem global:
    // 1) vence hoje (não quitado/cancelado)
    // 2) próximos vencimentos (due_date >= amanhã)
    // 3) vencidos (due_date < hoje)
    // 4) paid/cancelled por created_at desc (paid_date / created_at)
    const merged = Array.from(byId.values()).sort((a, b) => {
      const aStatus = String(a.status || "");
      const bStatus = String(b.status || "");
      const aDue = String(a.due_date || "").split("T")[0];
      const bDue = String(b.due_date || "").split("T")[0];
      const aClosed = aStatus === "paid" || aStatus === "cancelled";
      const bClosed = bStatus === "paid" || bStatus === "cancelled";
      const aIsDueToday = !aClosed && aDue === todayYmd;
      const bIsDueToday = !bClosed && bDue === todayYmd;
      if (aIsDueToday !== bIsDueToday) return aIsDueToday ? -1 : 1;

      const aIsFuture = !aClosed && aDue >= tomorrowYmd;
      const bIsFuture = !bClosed && bDue >= tomorrowYmd;
      if (aIsFuture !== bIsFuture) return aIsFuture ? -1 : 1;

      const aIsPast = !aClosed && aDue !== "" && aDue < todayYmd;
      const bIsPast = !bClosed && bDue !== "" && bDue < todayYmd;
      if (aIsPast !== bIsPast) return aIsPast ? -1 : 1;

      // dentro do futuro: por vencimento asc
      if (aIsFuture && bIsFuture) {
        if (aDue !== bDue) return aDue.localeCompare(bDue);
      }

      // dentro do passado: vencimento desc (mais recente primeiro)
      if (aIsPast && bIsPast) {
        if (aDue !== bDue) return bDue.localeCompare(aDue);
      }

      const dA = new Date(String(a.created_at || "")).getTime() || 0;
      const dB = new Date(String(b.created_at || "")).getTime() || 0;
      return dB - dA;
    });
    total = merged.length;
    const start = (page - 1) * PAGE_SIZE;
    items = merged.slice(start, start + PAGE_SIZE);
  } else if (statusFilter === "overdue") {
    const today = new Date().toISOString().split("T")[0];
    let allData: Array<Record<string, unknown>> = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      let q = supabase
        .from("loans")
        .select(
          "id, client_id, amount, interest_rate, loan_date, due_date, status, created_at, clients (name, cpf, email, phone)"
        )
        .in("status", ["active", "partial_paid", "overdue"])
        .lt("due_date", today)
        .order("due_date", { ascending: true });
      if (periodFrom) q = q.gte("loan_date", periodFrom);
      if (periodTo) q = q.lte("loan_date", periodTo);
      if (searchClientIds) q = q.in("client_id", searchClientIds);
      const { data: chunk, error } = await q.range(offset, offset + CHUNK - 1);
      if (error) throw error;
      const list = chunk || [];
      allData = allData.concat(list);
      hasMore = list.length === CHUNK;
      offset += CHUNK;
    }

    const overdueItems = await hydrateClientsForLoans(allData as Array<Record<string, unknown>>);
    total = overdueItems.length;
    const start = (page - 1) * PAGE_SIZE;
    items = overdueItems.slice(start, start + PAGE_SIZE);
  } else {
    // Ordenação global com paginação:
    // - 1) vence hoje (hoje <= due_date < amanhã)
    // - 2) próximos vencimentos (due_date >= amanhã) por due_date asc (e created_at desc)
    // - 3) vencidos (due_date < hoje) por due_date desc (mais recente primeiro)
    // Para suportar paginação, buscamos buckets separadamente.

    const statusScope =
      statusFilter === "active"
        ? ["active", "overdue", "partial_paid"]
        : statusFilter
          ? [statusFilter]
          : null;

    // Bucket 1: vence hoje
    let dueTodayQ = supabase
      .from("loans")
      .select(
        "id, client_id, amount, interest_rate, loan_date, due_date, status, created_at, clients (name, cpf, email, phone)",
        { count: "exact" }
      );
    dueTodayQ = applyCommonLoanFilters(dueTodayQ);
    if (statusScope) dueTodayQ = dueTodayQ.in("status", statusScope);
    dueTodayQ = dueTodayQ
      .neq("status", "paid")
      .neq("status", "cancelled")
      .gte("due_date", todayYmd)
      .lt("due_date", tomorrowYmd)
      .order("created_at", { ascending: false });

    const { count: dueTodayCount, error: dueTodayErr } = await dueTodayQ.range(0, 0);
    if (dueTodayErr) throw dueTodayErr;
    const totalDueToday = dueTodayCount ?? 0;

    // Bucket 2: próximos vencimentos (>= amanhã)
    let futureQ = supabase
      .from("loans")
      .select(
        "id, client_id, amount, interest_rate, loan_date, due_date, status, created_at, clients (name, cpf, email, phone)",
        { count: "exact" }
      );
    futureQ = applyCommonLoanFilters(futureQ);
    if (statusScope) futureQ = futureQ.in("status", statusScope);
    futureQ = futureQ
      .neq("status", "paid")
      .neq("status", "cancelled")
      .gte("due_date", tomorrowYmd)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: false });

    const { count: futureCount, error: futureErr } = await futureQ.range(0, 0);
    if (futureErr) throw futureErr;
    const totalFuture = futureCount ?? 0;

    // Bucket 3: vencidos (< hoje)
    let pastQ = supabase
      .from("loans")
      .select(
        "id, client_id, amount, interest_rate, loan_date, due_date, status, created_at, clients (name, cpf, email, phone)",
        { count: "exact" }
      );
    pastQ = applyCommonLoanFilters(pastQ);
    if (statusScope) pastQ = pastQ.in("status", statusScope);
    pastQ = pastQ
      .neq("status", "paid")
      .neq("status", "cancelled")
      .lt("due_date", todayYmd)
      .order("due_date", { ascending: false })
      .order("created_at", { ascending: false });

    const { count: pastCount, error: pastErr } = await pastQ.range(0, 0);
    if (pastErr) throw pastErr;
    const totalPast = pastCount ?? 0;

    total = totalDueToday + totalFuture + totalPast;

    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;

    const pageItems: Array<Record<string, unknown>> = [];

    // Puxar do bucket 1
    if (start < totalDueToday) {
      const a = start;
      const b = Math.min(end, totalDueToday - 1);
      const { data: dueTodayData, error: e1 } = await dueTodayQ.range(a, b);
      if (e1) throw e1;
      pageItems.push(...((dueTodayData || []) as Array<Record<string, unknown>>));
    }

    // Bucket 2 (future)
    let remainingSlots = PAGE_SIZE - pageItems.length;
    if (remainingSlots > 0) {
      const futureStart = Math.max(0, start - totalDueToday);
      const futureEnd = futureStart + remainingSlots - 1;
      if (futureStart < totalFuture) {
        const { data: futureData, error: e2 } = await futureQ.range(
          futureStart,
          Math.min(futureEnd, totalFuture - 1),
        );
        if (e2) throw e2;
        pageItems.push(...((futureData || []) as Array<Record<string, unknown>>));
      }
    }

    // Bucket 3 (past)
    remainingSlots = PAGE_SIZE - pageItems.length;
    if (remainingSlots > 0) {
      const pastStart = Math.max(0, start - totalDueToday - totalFuture);
      const pastEnd = pastStart + remainingSlots - 1;
      if (pastStart < totalPast) {
        const { data: pastData, error: e3 } = await pastQ.range(
          pastStart,
          Math.min(pastEnd, totalPast - 1),
        );
        if (e3) throw e3;
        pageItems.push(...((pastData || []) as Array<Record<string, unknown>>));
      }
    }

    items = await hydrateClientsForLoans(pageItems);
  }

  await attachRemainingAmounts(items);
  return { data: items, total };
}

/** Empréstimos do cliente elegíveis para vincular a um novo parcelamento (sem quitados/cancelados e sem já vinculados). */
export async function fetchClientLoansForParcelamentoLink(clientId: string) {
  const { data: loans, error } = await supabase
    .from("loans")
    .select("id, amount, interest_rate, due_date, status, created_at")
    .eq("client_id", clientId)
    .in("status", ["active", "overdue", "partial_paid"])
    .order("created_at", { ascending: false });

  if (error) throw error;
  const list = (loans || []) as Array<{ id: string }>;
  if (list.length === 0) return [];

  const ids = list.map((l) => String(l.id));
  const { data: linkedRows } = await supabase
    .from("installments")
    .select("loan_id")
    .in("loan_id", ids)
    .eq("status", "active");

  const linked = new Set((linkedRows || []).map((r) => String((r as { loan_id: string }).loan_id)));
  return list.filter((l) => !linked.has(String(l.id)));
}

export async function fetchActiveLoansForSelect() {
  const { data, error } = await supabase
    .from("loans")
    .select("id, amount, interest_rate, due_date, clients (name)")
    .in("status", ["active", "overdue", "partial_paid"])
    .order("due_date", { ascending: true })
    .limit(200);

  if (error) throw error;

  return (data || []).map((loan: Record<string, unknown>) => {
    const cl = (loan.clients as { name?: string }) || {};
    const amt = parseFloat(String(loan.amount || 0));
    const rate = parseFloat(String(loan.interest_rate || 0));
    const total = amt + amt * (rate / 100);
    return {
      id: loan.id,
      client_name: cl.name || "—",
      amount: amt,
      total,
      due_date: loan.due_date,
    };
  });
}

export async function createLoan(data: {
  client_id: string;
  amount: number;
  interest_rate: number;
  loan_date: string;
  due_date: string;
}) {
  const row = {
    client_id: data.client_id,
    amount: data.amount,
    original_amount: data.amount,
    interest_rate: data.interest_rate,
    loan_date: data.loan_date,
    due_date: data.due_date,
    status: "active",
  };
  const { data: inserted, error } = await supabase.from("loans").insert([row]).select("id").single();
  if (error) {
    let msg = error.message || "Erro ao criar empréstimo";
    if (error.details) msg += ` | ${String(error.details)}`;
    if (error.hint) msg += ` (${error.hint})`;
    throw new Error(msg);
  }
  return inserted;
}

export async function updateLoan(
  id: string,
  data: { amount?: number; interest_rate?: number; loan_date?: string; due_date?: string; status?: string; client_id?: string }
) {
  const { error } = await supabase.from("loans").update(data).eq("id", id);
  if (error) throw error;
}

export async function markLoanAsPaid(loanId: string, paidDate: string) {
  const { data: loan, error: loanErr } = await supabase
    .from("loans")
    .select("id, client_id, amount, interest_rate, loan_date, due_date")
    .eq("id", loanId)
    .single();

  if (loanErr || !loan) throw loanErr || new Error("Empréstimo não encontrado");

  const principal = parseFloat(String(loan.amount || 0));
  const rate = parseFloat(String(loan.interest_rate || 0));
  const totalWithInterest = principal + principal * (rate / 100);

  const { data: payments } = await supabase
    .from("payments")
    .select("amount")
    .eq("loan_id", loanId);

  const totalPaid = (payments || []).reduce((s, p) => s + parseFloat(String(p.amount || 0)), 0);

  const paidPayload = {
    loan_id: loanId,
    client_id: loan.client_id,
    original_amount: principal,
    interest_rate: rate,
    total_with_interest: totalWithInterest,
    loan_date: loan.loan_date,
    due_date: loan.due_date,
    paid_date: paidDate,
    total_paid: totalPaid,
    payment_method: "Sistema",
    notes: "Quitado pelo sistema",
  };

  const { data: existing } = await supabase
    .from("paid_loans")
    .select("id")
    .eq("loan_id", loanId)
    .maybeSingle();

  if (existing?.id) {
    await supabase.from("paid_loans").update(paidPayload).eq("id", existing.id);
  } else {
    await supabase.from("paid_loans").insert([paidPayload]);
  }

  const { error: updateErr } = await supabase
    .from("loans")
    .update({ status: "paid" })
    .eq("id", loanId);

  if (updateErr) {
    throw updateErr;
  }
}

export async function fetchLoanById(id: string) {
  const { data, error } = await supabase
    .from("loans")
    .select(`
      id,
      client_id,
      amount,
      interest_rate,
      loan_date,
      due_date,
      status,
      created_at,
      clients (name, cpf, email, phone, address, rg)
    `)
    .eq("id", id)
    .single();

  if (error) throw error;
  const cl = (data?.clients as Record<string, unknown>) || {};
  return {
    ...data,
    client_name: cl.name || "—",
    client_phone: cl.phone || "",
    client_cpf: cl.cpf || "",
    client_email: cl.email || "",
    client_address: cl.address || "",
    client_rg: cl.rg || "",
  };
}

export type LoanForPdf = {
  id: string;
  client_name: string;
  amount: number;
  interest_rate: number;
  loan_date: string;
  due_date: string;
  status: string;
};

export async function fetchLoansByDateRange(dateFrom: string, dateTo: string): Promise<LoanForPdf[]> {
  const { data, error } = await supabase
    .from("loans")
    .select("id, amount, interest_rate, loan_date, due_date, status, clients (name)")
    .gte("loan_date", dateFrom)
    .lte("loan_date", dateTo)
    .order("loan_date", { ascending: true });

  if (error) throw error;

  return (data || []).map((l: Record<string, unknown>) => {
    const cl = (l.clients as { name?: string }) || {};
    return {
      id: String(l.id),
      client_name: cl.name || "—",
      amount: parseFloat(String(l.amount || 0)),
      interest_rate: parseFloat(String(l.interest_rate || 0)),
      loan_date: (l.loan_date as string)?.split("T")[0] ?? "",
      due_date: (l.due_date as string)?.split("T")[0] ?? "",
      status: String(l.status || ""),
    };
  });
}

export async function fetchPaidLoansByDateRange(dateFrom: string, dateTo: string): Promise<LoanForPdf[]> {
  const { data, error } = await supabase
    .from("paid_loans")
    .select("loan_id, client_id, original_amount, interest_rate, loan_date, due_date, paid_date")
    .gte("paid_date", dateFrom)
    .lte("paid_date", dateTo + "T23:59:59")
    .order("paid_date", { ascending: true });

  if (error) throw error;

  const list = (data || []) as Array<Record<string, unknown>>;
  const { clientNameByLoanId } = await resolvePaidLoanClientNames(list);

  return list.map((p: Record<string, unknown>) => {
    const lid = String(p.loan_id ?? "");
    return {
      id: lid,
      client_name: clientNameByLoanId[lid] ?? "—",
      amount: parseFloat(String(p.original_amount || 0)),
      interest_rate: parseFloat(String(p.interest_rate || 0)),
      loan_date: (p.loan_date as string)?.split("T")[0] ?? "",
      due_date: (p.due_date as string)?.split("T")[0] ?? "",
      status: "paid",
    };
  });
}

export async function fetchOverdueLoans(): Promise<LoanForPdf[]> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("loans")
    .select("id, amount, interest_rate, loan_date, due_date, status, clients (name)")
    .in("status", ["active", "partial_paid", "overdue"])
    .lt("due_date", today)
    .order("due_date", { ascending: true });

  if (error) throw error;

  return (data || []).map((l: Record<string, unknown>) => {
    const cl = (l.clients as { name?: string }) || {};
    return {
      id: String(l.id),
      client_name: cl.name || "—",
      amount: parseFloat(String(l.amount || 0)),
      interest_rate: parseFloat(String(l.interest_rate || 0)),
      loan_date: (l.loan_date as string)?.split("T")[0] ?? "",
      due_date: (l.due_date as string)?.split("T")[0] ?? "",
      status: String(l.status || ""),
    };
  });
}

export async function fetchLoansStats() {
  const [activeRes, paidRes, overdueRes, cancelledRes] = await Promise.all([
    supabase
      .from("loans")
      .select("id", { count: "exact", head: true })
      .in("status", ["active", "partial_paid", "overdue"]),
    supabase.from("loans").select("id", { count: "exact", head: true }).eq("status", "paid"),
    supabase.from("loans").select("id", { count: "exact", head: true }).eq("status", "overdue"),
    supabase.from("loans").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
  ]);

  return {
    active: activeRes.count ?? 0,
    paid: paidRes.count ?? 0,
    overdue: overdueRes.count ?? 0,
    cancelled: cancelledRes.count ?? 0,
  };
}
