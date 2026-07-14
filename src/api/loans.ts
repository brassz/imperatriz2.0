import { supabase } from "@/lib/supabase";
import type { UnaiLoanProduct } from "@/lib/unai-cred";
import { isWeeklyLoanProduct, supportsWeeklyLoanProducts } from "@/lib/unai-cred";
import { createUnaiWeeklySchedule } from "./loan-weekly-installments";
import { PAGE_SIZE } from "@/lib/constants";
import { computeLoanRemainingTotal, effectiveLoanPrincipal } from "@/api/loan-calc";

/** Ordenação da listagem de empréstimos (além do modo padrão do sistema). */
export type LoanSortOption =
  | "default"
  | "due_date_asc"
  | "due_date_desc"
  | "loan_date_asc"
  | "loan_date_desc"
  | "created_at_asc"
  | "created_at_desc";

function parseLoanSort(sort: LoanSortOption | undefined): {
  field: "due_date" | "loan_date" | "created_at";
  asc: boolean;
} | null {
  if (!sort || sort === "default") return null;
  const m = sort.match(/^(due_date|loan_date|created_at)_(asc|desc)$/);
  if (!m) return null;
  return { field: m[1] as "due_date" | "loan_date" | "created_at", asc: m[2] === "asc" };
}

function sortLoanRows(
  rows: Array<Record<string, unknown>>,
  field: "due_date" | "loan_date" | "created_at",
  asc: boolean
): Array<Record<string, unknown>> {
  const mul = asc ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (field === "created_at") {
      const ta = new Date(String(a.created_at || "")).getTime() || 0;
      const tb = new Date(String(b.created_at || "")).getTime() || 0;
      if (ta !== tb) return (ta - tb) * mul;
    } else {
      const va = String(a[field] || "").split("T")[0];
      const vb = String(b[field] || "").split("T")[0];
      if (va !== vb) return va.localeCompare(vb) * mul;
    }
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
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
    const cap = effectiveLoanPrincipal(item as { original_amount?: unknown; amount?: unknown });
    const rate = parseFloat(String(item.interest_rate || 0));
    const payments = byLoan[String(item.id)] || [];
    item.remaining_amount = computeLoanRemainingTotal(cap, rate, payments);
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

/** Soma `fine_amount` (multas) e `amount` (pagamentos) por empréstimo — para listagem. */
async function attachPaymentAndFineTotals(items: Array<Record<string, unknown>>): Promise<void> {
  if (items.length === 0) return;
  const loanIds = [...new Set(items.map((r) => String(r.id || "")).filter(Boolean))];
  if (loanIds.length === 0) return;

  const { data: paymentsData, error } = await supabase
    .from("payments")
    .select("loan_id, amount, fine_amount")
    .in("loan_id", loanIds);

  if (error) throw error;

  const byLoan: Record<string, { fines: number; paid: number }> = {};
  for (const id of loanIds) {
    byLoan[id] = { fines: 0, paid: 0 };
  }
  for (const p of paymentsData || []) {
    const row = p as { loan_id: string; amount?: unknown; fine_amount?: unknown };
    const lid = String(row.loan_id || "");
    if (!byLoan[lid]) continue;
    const amt = parseFloat(String(row.amount || 0));
    const fine = parseFloat(String(row.fine_amount || 0));
    byLoan[lid].fines += fine;
    byLoan[lid].paid += amt;
  }

  for (const item of items) {
    const id = String(item.id || "");
    const t = byLoan[id] || { fines: 0, paid: 0 };
    item.total_fines_amount = t.fines;
    item.total_paid_amount = t.paid;
  }
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
    const rawLoan = loan as Record<string, unknown>;
    const amt = parseFloat(String(loan.amount || 0));
    const orig = effectiveLoanPrincipal({
      original_amount: rawLoan.original_amount,
      amount: rawLoan.amount,
    });
    return {
      id: loan.id,
      client_id: loan.client_id,
      client_name: mergedClient.name || "—",
      client_phone: mergedClient.phone || "",
      client_cpf: mergedClient.cpf || "",
      client_email: mergedClient.email || "",
      amount: amt,
      original_amount: orig,
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
  opts?: { periodFrom?: string; periodTo?: string; sort?: LoanSortOption }
) {
  const client = (c: unknown) => (c as { name?: string; cpf?: string; phone?: string; email?: string }) || {};
  const normalizePhoneDigits = (value: unknown) => {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
    return digits;
  };

  let items: Array<Record<string, unknown>> = [];
  let total = 0;

  const sortOpt = parseLoanSort(opts?.sort);

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
    extra?: { includeInstallments?: boolean; excludeFinalized?: boolean }
  ) {
    let query = q;
    // normal: não listar empréstimos já vinculados a parcelamento
    if (!extra?.includeInstallments) query = query.neq("status", "installments");
    if (extra?.excludeFinalized !== false) query = query.neq("status", "finalized");
    if (periodFrom) query = query.gte("loan_date", periodFrom);
    if (periodTo) query = query.lte("loan_date", periodTo);
    if (searchClientIds) query = query.in("client_id", searchClientIds);
    return query;
  }

  async function resolveClientIdsForSearch(): Promise<string[] | null> {
    if (!searchTerm) return null;
    const digits = searchTerm.replace(/\D/g, "");
    const isCpf = digits.length === 11;
    const looksLikePhone = digits.length >= 8 && digits.length !== 11;

    let q = supabase.from("clients").select("id");
    if (isCpf) {
      q = q.eq("cpf", digits);
    } else if (looksLikePhone) {
      const { data, error } = await supabase
        .from("clients")
        .select("id, phone")
        .limit(3000);
      if (error) throw error;
      const ids = (data || [])
        .filter((row: Record<string, unknown>) => {
          const phoneDigits = normalizePhoneDigits(row.phone);
          return phoneDigits === digits || phoneDigits.endsWith(digits) || digits.endsWith(phoneDigits);
        })
        .map((row: Record<string, unknown>) => String(row.id))
        .filter(Boolean);
      return ids.length ? ids : [];
    } else {
      q = q.ilike("name", `%${searchTerm}%`);
    }
    const { data, error } = await q.limit(500);
    if (error) throw error;
    const ids = (data || []).map((r: Record<string, unknown>) => String(r.id)).filter(Boolean);
    return ids.length ? ids : [];
  }

  const searchClientIds = await resolveClientIdsForSearch();

  if (statusFilter === "finalized") {
    let q = supabase
      .from("loans")
      .select(
        "id, client_id, amount, original_amount, interest_rate, loan_date, due_date, status, created_at, capital_raise_id, capital_raise_capital, capital_raise_interest, clients (name, cpf, email, phone)",
        { count: "exact" }
      )
      .eq("status", "finalized");
    if (periodFrom) q = q.gte("loan_date", periodFrom);
    if (periodTo) q = q.lte("loan_date", periodTo);
    if (searchClientIds) q = q.in("client_id", searchClientIds);
    const orderField = sortOpt?.field ?? "created_at";
    const orderAsc = sortOpt ? sortOpt.asc : false;
    q = q.order(orderField, { ascending: orderAsc }).order("id", { ascending: true });
    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;
    const { data, error, count } = await q.range(start, end);
    if (error) throw error;
    total = count ?? 0;
    items = await hydrateClientsForLoans((data || []) as Array<Record<string, unknown>>);
  } else if (statusFilter === "paid") {
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

    let paidItems = paidList.map((p: Record<string, unknown>) => {
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
    if (sortOpt) {
      paidItems = sortLoanRows(paidItems, sortOpt.field, sortOpt.asc);
    }
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
          .select("id, client_id, amount, original_amount, interest_rate, loan_date, due_date, status, created_at, capital_raise_id, capital_raise_capital, capital_raise_interest, clients (name, cpf, email, phone)")
          .neq("status", "installments")
          .neq("status", "finalized")
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
    // Ordem global (padrão):
    // 1) vence hoje (não quitado/cancelado)
    // 2) próximos vencimentos (due_date >= amanhã)
    // 3) vencidos (due_date < hoje)
    // 4) paid/cancelled por created_at desc (paid_date / created_at)
    let merged: Array<Record<string, unknown>>;
    if (sortOpt) {
      merged = sortLoanRows(Array.from(byId.values()), sortOpt.field, sortOpt.asc);
    } else {
      merged = Array.from(byId.values()).sort((a, b) => {
        const aStatus = String(a.status || "");
        const bStatus = String(b.status || "");
        const aDue = String(a.due_date || "").split("T")[0];
        const bDue = String(b.due_date || "").split("T")[0];
        const aClosed = aStatus === "paid" || aStatus === "cancelled" || aStatus === "finalized";
        const bClosed = bStatus === "paid" || bStatus === "cancelled" || bStatus === "finalized";
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
    }
    total = merged.length;
    const start = (page - 1) * PAGE_SIZE;
    items = merged.slice(start, start + PAGE_SIZE);
  } else if (statusFilter === "overdue") {
    const today = new Date().toISOString().split("T")[0];
    const overdueOrderField = sortOpt ? sortOpt.field : "due_date";
    const overdueAsc = sortOpt ? sortOpt.asc : true;
    let allData: Array<Record<string, unknown>> = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      let q = supabase
        .from("loans")
        .select(
          "id, client_id, amount, original_amount, interest_rate, loan_date, due_date, status, created_at, clients (name, cpf, email, phone)"
        )
        .neq("status", "finalized")
        .in("status", ["active", "partial_paid", "overdue"])
        .lt("due_date", today)
        .order(overdueOrderField, { ascending: overdueAsc })
        .order("id", { ascending: true });
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
    const statusScope =
      statusFilter === "active"
        ? ["active", "overdue", "partial_paid"]
        : statusFilter
          ? [statusFilter]
          : null;

    if (sortOpt) {
      let q = supabase.from("loans").select(
        "id, client_id, amount, original_amount, interest_rate, loan_date, due_date, status, created_at, capital_raise_id, capital_raise_capital, capital_raise_interest, clients (name, cpf, email, phone)",
        { count: "exact" }
      );
      q = applyCommonLoanFilters(q);
      if (statusScope) q = q.in("status", statusScope);
      q = q.order(sortOpt.field, { ascending: sortOpt.asc }).order("id", { ascending: true });

      const start = (page - 1) * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;
      const { data, error, count } = await q.range(start, end);
      if (error) throw error;
      total = count ?? 0;
      items = await hydrateClientsForLoans((data || []) as Array<Record<string, unknown>>);
    } else {
    // Ordenação global com paginação (padrão):
    // - 1) vence hoje (hoje <= due_date < amanhã)
    // - 2) próximos vencimentos (due_date >= amanhã) por due_date asc (e created_at desc)
    // - 3) vencidos (due_date < hoje) por due_date desc (mais recente primeiro)
    // Para suportar paginação, buscamos buckets separadamente.

    // Bucket 1: vence hoje
    let dueTodayQ = supabase
      .from("loans")
      .select(
        "id, client_id, amount, original_amount, interest_rate, loan_date, due_date, status, created_at, capital_raise_id, capital_raise_capital, capital_raise_interest, clients (name, cpf, email, phone)",
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
        "id, client_id, amount, original_amount, interest_rate, loan_date, due_date, status, created_at, capital_raise_id, capital_raise_capital, capital_raise_interest, clients (name, cpf, email, phone)",
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
        "id, client_id, amount, original_amount, interest_rate, loan_date, due_date, status, created_at, capital_raise_id, capital_raise_capital, capital_raise_interest, clients (name, cpf, email, phone)",
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
  }

  await attachRemainingAmounts(items);
  await attachPaymentAndFineTotals(items);
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

export type LoanClientContact = {
  client_id: string;
  client_name: string;
  client_phone: string;
};

/** Clientes únicos com empréstimo ativo (active, overdue, partial_paid). */
export async function fetchLoanClientContacts(): Promise<LoanClientContact[]> {
  const CHUNK = 50;
  const openStatuses = ["active", "overdue", "partial_paid"];
  let offset = 0;
  let hasMore = true;
  const byClient = new Map<string, LoanClientContact>();

  while (hasMore) {
    const { data, error } = await supabase
      .from("loans")
      .select("client_id, clients (name, phone)")
      .in("status", openStatuses)
      .order("client_id")
      .range(offset, offset + CHUNK - 1);
    if (error) throw error;
    const list = data || [];
    for (const row of list) {
      const rec = row as Record<string, unknown>;
      const clientId = String(rec.client_id || "");
      if (!clientId || byClient.has(clientId)) continue;
      const cl = (rec.clients as { name?: string; phone?: string }) || {};
      byClient.set(clientId, {
        client_id: clientId,
        client_name: String(cl.name || "—").trim(),
        client_phone: String(cl.phone || "").trim(),
      });
    }
    hasMore = list.length === CHUNK;
    offset += CHUNK;
  }

  return Array.from(byClient.values()).sort((a, b) =>
    a.client_name.localeCompare(b.client_name, "pt-BR", { sensitivity: "base" }),
  );
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
  loan_product?: UnaiLoanProduct;
  capital_raise_id?: string | null;
  capital_raise_capital?: number;
  capital_raise_interest?: number;
}) {
  const row: Record<string, unknown> = {
    client_id: data.client_id,
    amount: data.amount,
    original_amount: data.amount,
    interest_rate: data.interest_rate,
    loan_date: data.loan_date,
    due_date: data.due_date,
    status: "active",
    capital_raise_id: data.capital_raise_id ?? null,
    capital_raise_capital: data.capital_raise_capital ?? null,
    capital_raise_interest: data.capital_raise_interest ?? null,
  };
  if (supportsWeeklyLoanProducts()) {
    const product = data.loan_product || "mensal";
    row.loan_product = product;
    row.loan_format = isWeeklyLoanProduct(product) ? "semanal" : "mensal";
  }
  const { data: inserted, error } = await supabase.from("loans").insert([row]).select("id").single();
  if (error) {
    let msg = error.message || "Erro ao criar empréstimo";
    if (error.details) msg += ` | ${String(error.details)}`;
    if (error.hint) msg += ` (${error.hint})`;
    throw new Error(msg);
  }

  const loanId = String(inserted?.id || "");
  const product = data.loan_product || "mensal";
  if (supportsWeeklyLoanProducts() && loanId && isWeeklyLoanProduct(product)) {
    try {
      await createUnaiWeeklySchedule(loanId, product, data.amount, data.interest_rate, data.loan_date);
    } catch (weeklyErr) {
      await supabase.from("loans").delete().eq("id", loanId);
      throw weeklyErr instanceof Error ? weeklyErr : new Error("Erro ao criar parcelas semanais");
    }
  }

  return inserted;
}

type PgLikeError = { message?: string; code?: string; details?: string; hint?: string };

/** Converte 400 do PostgREST em mensagem útil (CHECK em status, RLS, etc.). */
function throwLoanUpdateError(error: PgLikeError, action: string): never {
  const msg = String(error.message || "");
  const code = String(error.code || "");
  const lower = msg.toLowerCase();
  const statusCheck =
    code === "23514" ||
    msg.includes("loans_status_check") ||
    (lower.includes("check constraint") && lower.includes("status"));
  if (statusCheck) {
    throw new Error(
      `${action}: o banco rejeitou o status do empréstimo (CHECK ou trigger antigo). ` +
        `No Supabase desta empresa, abra o SQL Editor e execute o arquivo ` +
        `supabase/migrations/20260403100000_loans_finalize_check_and_trigger.sql ` +
        `(alinha CHECK em loans.status e a função calculate_loan_status). Detalhe: ${msg}`,
    );
  }
  if (
    code === "42P10" ||
    lower.includes("no unique or exclusion constraint matching the on conflict")
  ) {
    throw new Error(
      `${action}: falta índice UNIQUE em paid_loans(loan_id) para o trigger de quitação. ` +
        `No SQL Editor do Supabase, execute ` +
        `supabase/migrations/20260714140000_imperatriz_fix_payments_quitacao.sql. Detalhe: ${msg}`,
    );
  }
  if (code === "42501" || lower.includes("permission denied") || lower.includes("row-level security")) {
    throw new Error(`${action}: atualização bloqueada por RLS/permissões em public.loans. ${msg}`);
  }
  const err = new Error(msg || "Erro ao atualizar empréstimo");
  (err as Error & { cause?: unknown }).cause = error;
  throw err;
}

export async function updateLoan(
  id: string,
  data: {
    amount?: number;
    interest_rate?: number;
    loan_date?: string;
    due_date?: string;
    status?: string;
    client_id?: string;
    capital_raise_id?: string | null;
    capital_raise_capital?: number | null;
    capital_raise_interest?: number | null;
  }
) {
  const payload: Record<string, unknown> = {};
  if (data.amount !== undefined) payload.amount = data.amount;
  if (data.interest_rate !== undefined) payload.interest_rate = data.interest_rate;
  if (data.loan_date !== undefined) payload.loan_date = data.loan_date;
  if (data.due_date !== undefined) payload.due_date = data.due_date;
  if (data.client_id !== undefined) payload.client_id = data.client_id;
  if (data.status !== undefined && String(data.status).trim() !== "") payload.status = data.status;
  if (data.capital_raise_id !== undefined) payload.capital_raise_id = data.capital_raise_id;
  if (data.capital_raise_capital !== undefined) payload.capital_raise_capital = data.capital_raise_capital;
  if (data.capital_raise_interest !== undefined) payload.capital_raise_interest = data.capital_raise_interest;

  const { error } = await supabase.from("loans").update(payload).eq("id", id);
  if (error) throwLoanUpdateError(error, "Atualizar empréstimo");
}

/**
 * Encerra o empréstimo na operação (some das abas normais). Não remove linhas em `payments` nem altera quitados.
 */
export async function finalizeLoan(loanId: string): Promise<void> {
  const { data: row, error } = await supabase.from("loans").select("id, status").eq("id", loanId).maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Empréstimo não encontrado");
  const st = String((row as Record<string, unknown>).status || "");
  if (st === "paid" || st === "cancelled" || st === "finalized" || st === "installments") {
    throw new Error("Este empréstimo não pode ser finalizado neste estado.");
  }
  const { data: updatedRows, error: upErr } = await supabase
    .from("loans")
    .update({ status: "finalized" })
    .eq("id", loanId)
    .select("id, status");
  if (upErr) throwLoanUpdateError(upErr, "Finalizar empréstimo");
  const row0 = (updatedRows || [])[0] as { status?: string } | undefined;
  if (!row0 || String(row0.status) !== "finalized") {
    throw new Error(
      "O status não ficou como finalizado (comum: trigger calculate_loan_status no banco sobrescreve o status, ou CHECK em loans.status não inclui finalized). Aplique a migração supabase/migrations/20260403100000_loans_finalize_check_and_trigger.sql no projeto Supabase (SQL Editor ou supabase db push). Se o erro persistir, verifique RLS em UPDATE/SELECT em loans."
    );
  }

  // Finalizar ≠ quitar: remove registro em paid_loans (triggers legados ou dados antigos),
  // senão o cliente aparece como "quitado" no score e em relatórios que leem paid_loans.
  await supabase.from("paid_loans").delete().eq("loan_id", loanId);
}

export async function markLoanAsPaid(loanId: string, paidDate: string) {
  const { data: loan, error: loanErr } = await supabase
    .from("loans")
    .select("id, client_id, amount, original_amount, interest_rate, loan_date, due_date")
    .eq("id", loanId)
    .single();

  if (loanErr || !loan) throw loanErr || new Error("Empréstimo não encontrado");

  const principal = parseFloat(
    String((loan as { original_amount?: number }).original_amount || loan.amount || 0),
  );
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
    throwLoanUpdateError(updateErr, "Marcar empréstimo como quitado");
  }
}

export async function fetchLoanById(id: string) {
  const unaiFields = supportsWeeklyLoanProducts()
    ? `
      loan_product,`
    : "";
  const { data, error } = await supabase
    .from("loans")
    .select(`
      id,
      client_id,
      amount,
      original_amount,
      interest_rate,
      loan_date,
      due_date,
      status,${unaiFields}
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
