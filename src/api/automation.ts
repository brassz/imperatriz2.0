import { supabase, getSupabaseCompany } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyId } from "@/lib/companies";
import { addCalendarDays, calendarDateInBrazil, tomorrowCalendarDateBrazil } from "@/lib/brazil-date";
import {
  computeOverdueDailyFineBrl,
  DAILY_OVERDUE_FINE_BRL,
  listOverdueFineCalendarDates,
} from "@/lib/loan-overdue-fine";
import { computeLoanRemainingFromData } from "./loan-calc";
import type { LoanForMessage } from "@/lib/whatsapp-messages";
import {
  isWeeklyLoanProduct,
  resolveUnaiWeeklyForAutomation,
  supportsWeeklyLoanProducts,
  type UnaiWeeklyInstallmentRow,
} from "@/lib/unai-cred";

export type AutomationLoan = {
  id: string;
  client_id: string;
  type: "cobranca" | "lembrete_hoje" | "lembrete_amanha" | "lembrete_pagamento";
  /** Dias até o vencimento (somente lembrete_pagamento). */
  days_until_due?: number;
  loan: LoanForMessage;
  /** Origem do destinatário (empréstimo ou parcelamento). */
  source?: "loan" | "installment";
  installment_id?: string;
  installment_payment_id?: string;
};

export type FetchLoansForAutomationOptions = {
  /** Padrão true: só entra na fila de envio quem tem telefone. False: inclui na prévia (Config. WhatsApp). */
  requirePhone?: boolean;
  /** Inclui parcelamentos (próxima parcela pendente) na lista. */
  includeInstallments?: boolean;
  /** Empresa do banco consultado (obrigatório ao passar `db` customizado, ex.: cobrança 24H). */
  companyId?: CompanyId;
};

const LOAN_AUTOMATION_SELECT_BASE =
  "id, client_id, amount, interest_rate, due_date, status, original_amount";

function loanAutomationSelect(companyId: CompanyId): string {
  return supportsWeeklyLoanProducts(companyId)
    ? `${LOAN_AUTOMATION_SELECT_BASE}, loan_product`
    : LOAN_AUTOMATION_SELECT_BASE;
}

/**
 * Lista empréstimos elegíveis para cobrança/lembrete (vencido, hoje, amanhã).
 * Otimizado: filtra `due_date` no SQL; um único fetch de pagamentos; cálculo em memória
 * (evita N×2 round-trips do `calculateLoanRemaining` por empréstimo).
 */
export async function fetchLoansForAutomation(
  options?: FetchLoansForAutomationOptions,
  db: SupabaseClient = supabase,
): Promise<AutomationLoan[]> {
  const requirePhone = options?.requirePhone !== false;
  const includeInstallments = options?.includeInstallments === true;
  const companyId = options?.companyId ?? getSupabaseCompany();
  const isUnaiCred = supportsWeeklyLoanProducts(companyId);
  const today = calendarDateInBrazil();
  const tomorrow = tomorrowCalendarDateBrazil();

  let loansQuery = db
    .from("loans")
    .select(loanAutomationSelect(companyId))
    .in("status", ["active", "overdue", "partial_paid"])
    .order("due_date", { ascending: true });

  if (!isUnaiCred) {
    loansQuery = loansQuery.lte("due_date", tomorrow);
  }

  const { data: loans, error } = await loansQuery;

  if (error) throw error;

  const rows = (loans || []) as Record<string, unknown>[];

  const weeklyLoanIds = isUnaiCred
    ? rows.filter((r) => isWeeklyLoanProduct(String(r.loan_product || ""))).map((r) => String(r.id))
    : [];

  const weeklyByLoan: Record<string, UnaiWeeklyInstallmentRow[]> = {};
  if (isUnaiCred && weeklyLoanIds.length > 0) {
    try {
      const { data: weeklyRows, error: weeklyErr } = await db
        .from("loan_weekly_installments")
        .select("loan_id, week_number, due_date, amount, status")
        .in("loan_id", weeklyLoanIds)
        .order("week_number", { ascending: true });
      if (!weeklyErr && weeklyRows) {
        for (const wr of weeklyRows as Array<Record<string, unknown>>) {
          const lid = String(wr.loan_id || "");
          if (!lid) continue;
          if (!weeklyByLoan[lid]) weeklyByLoan[lid] = [];
          weeklyByLoan[lid].push({
            week_number: Number(wr.week_number || 0),
            due_date: String(wr.due_date || "").split("T")[0],
            amount: parseFloat(String(wr.amount || 0)),
            status: String(wr.status || "pending") === "paid" ? "paid" : "pending",
          });
        }
      }
    } catch {
      /* tabela pode não existir */
    }
  }

  const clientIds = [...new Set(rows.map((l) => String(l.client_id || "")).filter(Boolean))];

  const allLoanIds = rows.map((r) => String(r.id));
  const waiverByLoan = new Map<string, Set<string>>();
  if (allLoanIds.length > 0) {
    try {
      const { data: waiverRows, error: wErr } = await db
        .from("loan_fine_waivers")
        .select("loan_id, waive_date")
        .in("loan_id", allLoanIds);
      if (!wErr && waiverRows) {
        for (const wr of waiverRows as Array<{ loan_id?: string; waive_date?: string }>) {
          const lid = String(wr.loan_id || "");
          const d = String(wr.waive_date || "").split("T")[0];
          if (!lid || !d) continue;
          if (!waiverByLoan.has(lid)) waiverByLoan.set(lid, new Set());
          waiverByLoan.get(lid)!.add(d);
        }
      }
    } catch {
      /* tabela pode não existir em ambientes antigos */
    }
  }

  const { data: clients } = await db.from("clients").select("id, name, phone").in("id", clientIds);
  const clientMap: Record<string, { name: string; phone: string }> = {};
  for (const c of clients || []) {
    const r = c as Record<string, unknown>;
    clientMap[String(r.id)] = {
      name: String(r.name || "—"),
      phone: String(r.phone || "").replace(/\D/g, "") ? String(r.phone || "") : "",
    };
  }

  const candidates: Array<{ row: Record<string, unknown>; type: AutomationLoan["type"] }> = [];
  for (const r of rows) {
    const id = String(r.id);
    const product = String(r.loan_product || "");
    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };
    if (requirePhone && !client.phone) continue;

    if (isUnaiCred && isWeeklyLoanProduct(product)) {
      const installments = weeklyByLoan[id] || [];
      if (installments.length === 0) continue;
      const waived = waiverByLoan.get(id) ?? new Set<string>();
      const resolved = resolveUnaiWeeklyForAutomation(installments, today, tomorrow, waived);
      if (!resolved) continue;
      candidates.push({ row: r, type: resolved.type });
      continue;
    }

    const due = String(r.due_date || "").split("T")[0];
    if (!due || due > tomorrow) continue;

    let type: AutomationLoan["type"] | null = null;
    if (due < today) type = "cobranca";
    else if (due === today) type = "lembrete_hoje";
    else if (due === tomorrow) type = "lembrete_amanha";
    else continue;

    candidates.push({ row: r, type });
  }

  if (candidates.length === 0) return [];

  const loanIds = candidates.map((c) => String(c.row.id));

  const { data: payRows, error: payErr } = await db
    .from("payments")
    .select("loan_id, amount, payment_type, fine_amount, created_at")
    .in("loan_id", loanIds)
    .order("created_at", { ascending: true });

  if (payErr) throw payErr;

  const paymentsByLoan: Record<string, Array<{ amount: unknown; payment_type?: unknown; fine_amount?: unknown }>> = {};
  for (const p of payRows || []) {
    const pr = p as Record<string, unknown>;
    const lid = String(pr.loan_id || "");
    if (!lid) continue;
    if (!paymentsByLoan[lid]) paymentsByLoan[lid] = [];
    paymentsByLoan[lid].push({
      amount: pr.amount,
      payment_type: pr.payment_type,
      fine_amount: pr.fine_amount,
    });
  }

  const result: AutomationLoan[] = [];

  for (const { row: r, type } of candidates) {
    const id = String(r.id);
    const product = String(r.loan_product || "");
    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };

    if (isUnaiCred && isWeeklyLoanProduct(product)) {
      const installments = weeklyByLoan[id] || [];
      const waived = waiverByLoan.get(id) ?? new Set<string>();
      const resolved = resolveUnaiWeeklyForAutomation(installments, today, tomorrow, waived);
      if (!resolved) continue;

      const { ctx } = resolved;
      const loanForMsg: LoanForMessage = {
        client_name: client.name,
        client_phone: client.phone,
        amount: ctx.weeks_amount_due + ctx.fine,
        capital: ctx.weeks_amount_due,
        interest: 0,
        fine: ctx.fine,
        due_date: ctx.primary_due_date,
        minimumPayment: ctx.weeks_amount_due,
        unai_weekly: ctx,
      };

      result.push({
        id,
        client_id: String(r.client_id || ""),
        type,
        loan: loanForMsg,
        source: "loan",
      });
      continue;
    }

    const due = String(r.due_date || "").split("T")[0];

    let rem: { capital: number; interestAmount: number; totalAmount: number; minimumPayment: number };
    try {
      rem = computeLoanRemainingFromData(
        {
          amount: r.amount,
          interest_rate: r.interest_rate,
          original_amount: r.original_amount,
        },
        paymentsByLoan[id] || [],
      );
    } catch {
      const amt = parseFloat(String(r.amount || 0));
      const rate = parseFloat(String(r.interest_rate || 0)) / 100;
      const interest = amt * rate;
      rem = {
        capital: amt,
        interestAmount: interest,
        totalAmount: amt + interest,
        minimumPayment: interest,
      };
    }

    const overdueDates = due < today ? listOverdueFineCalendarDates(due, today) : [];
    const waived = waiverByLoan.get(id) ?? new Set<string>();
    const fine = overdueDates.length > 0 ? computeOverdueDailyFineBrl(overdueDates, waived) : 0;

    const loanForMsg: LoanForMessage = {
      client_name: client.name,
      client_phone: client.phone,
      amount: rem.totalAmount + fine,
      capital: rem.capital,
      interest: rem.interestAmount,
      fine,
      due_date: due,
      minimumPayment: rem.minimumPayment,
    };

    result.push({
      id,
      client_id: String(r.client_id || ""),
      type,
      loan: loanForMsg,
      source: "loan",
    });
  }

  if (includeInstallments) {
    // Parcelamentos ativos: usa a próxima parcela pendente como "vencimento".
    const { data: installments, error: instErr } = await db
      .from("installments")
      .select(
        `
        id,
        client_id,
        clients (name, phone),
        installment_payments (id, status, due_date, amount)
      `,
      )
      .eq("status", "active");

    if (instErr) throw instErr;

    for (const inst of (installments || []) as Array<Record<string, unknown>>) {
      const payments = (inst.installment_payments as Array<Record<string, unknown>>) || [];
      const pending = payments
        .filter((p) => String(p.status || "") === "pending")
        .sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")));
      const next = pending[0];
      const due = next ? String(next.due_date || "").split("T")[0] : "";
      if (!due) continue;

      let type: AutomationLoan["type"] | null = null;
      if (due < today) type = "cobranca";
      else if (due === today) type = "lembrete_hoje";
      else if (due === tomorrow) type = "lembrete_amanha";
      else continue;

      const cl = (inst.clients as { name?: unknown; phone?: unknown }) || {};
      const clientName = String(cl.name || "—");
      const clientPhone = String(cl.phone || "").replace(/\D/g, "") ? String(cl.phone || "") : "";
      if (requirePhone && !clientPhone) continue;

      const amt = parseFloat(String(next.amount || 0));
      const instOverdue = due < today ? listOverdueFineCalendarDates(due, today) : [];
      const instFine = instOverdue.length > 0 ? instOverdue.length * DAILY_OVERDUE_FINE_BRL : 0;
      const loanForMsg: LoanForMessage = {
        client_name: clientName,
        client_phone: clientPhone,
        amount: amt + instFine,
        capital: amt,
        interest: 0,
        fine: instFine,
        due_date: due,
        minimumPayment: amt,
      };

      const instId = String(inst.id || "");
      const payId = String(next.id || "");
      result.push({
        id: `inst:${instId}:${payId}`,
        client_id: String(inst.client_id || ""),
        type,
        loan: loanForMsg,
        source: "installment",
        installment_id: instId,
        installment_payment_id: payId,
      });
    }
  }

  return result;
}

function buildLoanForAutomationMessage(
  row: Record<string, unknown>,
  client: { name: string; phone: string },
  paymentsByLoan: Record<string, Array<{ amount: unknown; payment_type?: unknown; fine_amount?: unknown }>>,
  waiverByLoan: Map<string, Set<string>>,
  today: string,
): LoanForMessage {
  const id = String(row.id);
  const due = String(row.due_date || "").split("T")[0];

  let rem: { capital: number; interestAmount: number; totalAmount: number; minimumPayment: number };
  try {
    rem = computeLoanRemainingFromData(
      {
        amount: row.amount,
        interest_rate: row.interest_rate,
        original_amount: row.original_amount,
      },
      paymentsByLoan[id] || [],
    );
  } catch {
    const amt = parseFloat(String(row.amount || 0));
    const rate = parseFloat(String(row.interest_rate || 0)) / 100;
    const interest = amt * rate;
    rem = {
      capital: amt,
      interestAmount: interest,
      totalAmount: amt + interest,
      minimumPayment: interest,
    };
  }

  const overdueDates = due < today ? listOverdueFineCalendarDates(due, today) : [];
  const waived = waiverByLoan.get(id) ?? new Set<string>();
  const fine = overdueDates.length > 0 ? computeOverdueDailyFineBrl(overdueDates, waived) : 0;

  return {
    client_name: client.name,
    client_phone: client.phone,
    amount: rem.totalAmount + fine,
    capital: rem.capital,
    interest: rem.interestAmount,
    fine,
    due_date: due,
    minimumPayment: rem.minimumPayment,
  };
}

/**
 * Lembretes de pagamento: clientes com vencimento em N dias (ex.: 3 dias → vence em DD/MM daqui a 3 dias).
 */
export async function fetchLoansForPaymentReminder(
  daysAhead: number,
  options?: FetchLoansForAutomationOptions,
): Promise<AutomationLoan[]> {
  const requirePhone = options?.requirePhone !== false;
  const includeInstallments = options?.includeInstallments !== false;
  const companyId = options?.companyId ?? getSupabaseCompany();
  const isUnaiCred = supportsWeeklyLoanProducts(companyId);
  const days = Math.max(0, Math.floor(daysAhead));
  const today = calendarDateInBrazil();
  const targetDue = addCalendarDays(today, days);
  const tomorrow = tomorrowCalendarDateBrazil();

  let reminderQuery = supabase
    .from("loans")
    .select(loanAutomationSelect(companyId))
    .in("status", ["active", "overdue", "partial_paid"])
    .order("due_date", { ascending: true });

  if (!isUnaiCred) {
    reminderQuery = reminderQuery.eq("due_date", targetDue);
  }

  const { data: loans, error } = await reminderQuery;

  if (error) throw error;

  const rows = (loans || []) as Record<string, unknown>[];

  const weeklyLoanIds = isUnaiCred
    ? rows.filter((r) => isWeeklyLoanProduct(String(r.loan_product || ""))).map((r) => String(r.id))
    : [];

  const weeklyByLoan: Record<string, UnaiWeeklyInstallmentRow[]> = {};
  if (isUnaiCred && weeklyLoanIds.length > 0) {
    try {
      const { data: weeklyRows, error: weeklyErr } = await supabase
        .from("loan_weekly_installments")
        .select("loan_id, week_number, due_date, amount, status")
        .in("loan_id", weeklyLoanIds)
        .order("week_number", { ascending: true });
      if (!weeklyErr && weeklyRows) {
        for (const wr of weeklyRows as Array<Record<string, unknown>>) {
          const lid = String(wr.loan_id || "");
          if (!lid) continue;
          if (!weeklyByLoan[lid]) weeklyByLoan[lid] = [];
          weeklyByLoan[lid].push({
            week_number: Number(wr.week_number || 0),
            due_date: String(wr.due_date || "").split("T")[0],
            amount: parseFloat(String(wr.amount || 0)),
            status: String(wr.status || "pending") === "paid" ? "paid" : "pending",
          });
        }
      }
    } catch {
      /* optional table */
    }
  }

  const clientIds = [...new Set(rows.map((l) => String(l.client_id || "")).filter(Boolean))];

  const { data: clients } = await supabase.from("clients").select("id, name, phone").in("id", clientIds);
  const clientMap: Record<string, { name: string; phone: string }> = {};
  for (const c of clients || []) {
    const r = c as Record<string, unknown>;
    clientMap[String(r.id)] = {
      name: String(r.name || "—"),
      phone: String(r.phone || "").replace(/\D/g, "") ? String(r.phone || "") : "",
    };
  }

  const candidates: Record<string, unknown>[] = [];
  for (const r of rows) {
    const id = String(r.id);
    const product = String(r.loan_product || "");
    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };
    if (requirePhone && !client.phone) continue;

    if (isUnaiCred && isWeeklyLoanProduct(product)) {
      const installments = weeklyByLoan[id] || [];
      const hasTargetWeek = installments.some(
        (i) => i.status === "pending" && String(i.due_date).split("T")[0] === targetDue,
      );
      if (hasTargetWeek) candidates.push(r);
      continue;
    }

    const due = String(r.due_date || "").split("T")[0];
    if (due === targetDue) candidates.push(r);
  }

  if (candidates.length === 0 && !includeInstallments) return [];

  const loanIds = candidates.map((r) => String(r.id));
  const paymentsByLoan: Record<string, Array<{ amount: unknown; payment_type?: unknown; fine_amount?: unknown }>> = {};

  if (loanIds.length > 0) {
    const { data: payRows, error: payErr } = await supabase
      .from("payments")
      .select("loan_id, amount, payment_type, fine_amount, created_at")
      .in("loan_id", loanIds)
      .order("created_at", { ascending: true });
    if (payErr) throw payErr;
    for (const p of payRows || []) {
      const pr = p as Record<string, unknown>;
      const lid = String(pr.loan_id || "");
      if (!lid) continue;
      if (!paymentsByLoan[lid]) paymentsByLoan[lid] = [];
      paymentsByLoan[lid].push({
        amount: pr.amount,
        payment_type: pr.payment_type,
        fine_amount: pr.fine_amount,
      });
    }
  }

  const waiverByLoan = new Map<string, Set<string>>();
  if (loanIds.length > 0) {
    try {
      const { data: waiverRows, error: wErr } = await supabase
        .from("loan_fine_waivers")
        .select("loan_id, waive_date")
        .in("loan_id", loanIds);
      if (!wErr && waiverRows) {
        for (const wr of waiverRows as Array<{ loan_id?: string; waive_date?: string }>) {
          const lid = String(wr.loan_id || "");
          const d = String(wr.waive_date || "").split("T")[0];
          if (!lid || !d) continue;
          if (!waiverByLoan.has(lid)) waiverByLoan.set(lid, new Set());
          waiverByLoan.get(lid)!.add(d);
        }
      }
    } catch {
      /* optional table */
    }
  }

  const result: AutomationLoan[] = [];

  for (const r of candidates) {
    const id = String(r.id);
    const product = String(r.loan_product || "");
    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };

    if (isUnaiCred && isWeeklyLoanProduct(product)) {
      const installments = weeklyByLoan[id] || [];
      const waived = waiverByLoan.get(id) ?? new Set<string>();
      const resolved = resolveUnaiWeeklyForAutomation(installments, today, tomorrow, waived);
      if (!resolved || resolved.ctx.primary_due_date !== targetDue) {
        const pendingTarget = installments.find(
          (i) => i.status === "pending" && String(i.due_date).split("T")[0] === targetDue,
        );
        if (!pendingTarget) continue;
        const loanForMsg: LoanForMessage = {
          client_name: client.name,
          client_phone: client.phone,
          amount: pendingTarget.amount,
          capital: pendingTarget.amount,
          interest: 0,
          fine: 0,
          due_date: targetDue,
          minimumPayment: pendingTarget.amount,
          unai_weekly: {
            installments,
            overdue_weeks: installments
              .filter((i) => i.status === "pending" && String(i.due_date).split("T")[0] < today)
              .map((i) => i.week_number),
            focus_week: pendingTarget.week_number,
            primary_due_date: targetDue,
            weeks_amount_due: pendingTarget.amount,
            fine: 0,
          },
        };
        result.push({
          id,
          client_id: String(r.client_id || ""),
          type: "lembrete_pagamento",
          loan: loanForMsg,
          source: "loan",
          days_until_due: days,
        });
        continue;
      }
      const { ctx } = resolved;
      result.push({
        id,
        client_id: String(r.client_id || ""),
        type: "lembrete_pagamento",
        loan: {
          client_name: client.name,
          client_phone: client.phone,
          amount: ctx.weeks_amount_due + ctx.fine,
          capital: ctx.weeks_amount_due,
          interest: 0,
          fine: ctx.fine,
          due_date: ctx.primary_due_date,
          minimumPayment: ctx.weeks_amount_due,
          unai_weekly: ctx,
        },
        source: "loan",
        days_until_due: days,
      });
      continue;
    }

    result.push({
      id,
      client_id: String(r.client_id || ""),
      type: "lembrete_pagamento",
      loan: buildLoanForAutomationMessage(r, client, paymentsByLoan, waiverByLoan, today),
      source: "loan",
      days_until_due: days,
    });
  }

  if (includeInstallments) {
    const { data: installments, error: instErr } = await supabase
      .from("installments")
      .select(
        `
        id,
        client_id,
        clients (name, phone),
        installment_payments (id, status, due_date, amount)
      `,
      )
      .eq("status", "active");

    if (instErr) throw instErr;

    for (const inst of (installments || []) as Array<Record<string, unknown>>) {
      const payments = (inst.installment_payments as Array<Record<string, unknown>>) || [];
      const pending = payments
        .filter((p) => String(p.status || "") === "pending")
        .sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")));
      const next = pending.find((p) => String(p.due_date || "").split("T")[0] === targetDue);
      if (!next) continue;

      const cl = (inst.clients as { name?: unknown; phone?: unknown }) || {};
      const clientName = String(cl.name || "—");
      const clientPhone = String(cl.phone || "").replace(/\D/g, "") ? String(cl.phone || "") : "";
      if (requirePhone && !clientPhone) continue;

      const amt = parseFloat(String(next.amount || 0));
      const loanForMsg: LoanForMessage = {
        client_name: clientName,
        client_phone: clientPhone,
        amount: amt,
        capital: amt,
        interest: 0,
        fine: 0,
        due_date: targetDue,
        minimumPayment: amt,
      };

      const instId = String(inst.id || "");
      const payId = String(next.id || "");
      result.push({
        id: `inst:${instId}:${payId}`,
        client_id: String(inst.client_id || ""),
        type: "lembrete_pagamento",
        loan: loanForMsg,
        source: "installment",
        installment_id: instId,
        installment_payment_id: payId,
        days_until_due: days,
      });
    }
  }

  return result;
}

/** Data de vencimento alvo para lembrete com N dias de antecedência. */
export function paymentReminderTargetDate(daysAhead: number): string {
  return addCalendarDays(calendarDateInBrazil(), Math.max(0, Math.floor(daysAhead)));
}
