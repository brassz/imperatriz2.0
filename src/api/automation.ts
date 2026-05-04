import { supabase } from "@/lib/supabase";
import { calendarDateInBrazil, tomorrowCalendarDateBrazil } from "@/lib/brazil-date";
import {
  computeOverdueDailyFineBrl,
  DAILY_OVERDUE_FINE_BRL,
  listOverdueFineCalendarDates,
} from "@/lib/loan-overdue-fine";
import { computeLoanRemainingFromData } from "./loan-calc";
import type { LoanForMessage } from "@/lib/whatsapp-messages";

export type AutomationLoan = {
  id: string;
  client_id: string;
  type: "cobranca" | "lembrete_hoje" | "lembrete_amanha";
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
};

/**
 * Lista empréstimos elegíveis para cobrança/lembrete (vencido, hoje, amanhã).
 * Otimizado: filtra `due_date` no SQL; um único fetch de pagamentos; cálculo em memória
 * (evita N×2 round-trips do `calculateLoanRemaining` por empréstimo).
 */
export async function fetchLoansForAutomation(
  options?: FetchLoansForAutomationOptions,
): Promise<AutomationLoan[]> {
  const requirePhone = options?.requirePhone !== false;
  const includeInstallments = options?.includeInstallments === true;
  const today = calendarDateInBrazil();
  const tomorrow = tomorrowCalendarDateBrazil();

  const { data: loans, error } = await supabase
    .from("loans")
    .select("id, client_id, amount, interest_rate, due_date, status, original_amount, is_authorized")
    .in("status", ["active", "overdue", "partial_paid"])
    .lte("due_date", tomorrow)
    .order("due_date", { ascending: true });

  if (error) throw error;

  const rows = (loans || []) as Record<string, unknown>[];

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

  const candidates: Array<{ row: Record<string, unknown>; type: AutomationLoan["type"] }> = [];
  for (const r of rows) {
    if ((r as any).is_authorized === false) continue;
    const due = String(r.due_date || "").split("T")[0];
    if (!due) continue;

    let type: AutomationLoan["type"] | null = null;
    if (due < today) type = "cobranca";
    else if (due === today) type = "lembrete_hoje";
    else if (due === tomorrow) type = "lembrete_amanha";
    else continue;

    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };
    if (requirePhone && !client.phone) continue;

    candidates.push({ row: r, type });
  }

  if (candidates.length === 0) return [];

  const loanIds = candidates.map((c) => String(c.row.id));

  const { data: payRows, error: payErr } = await supabase
    .from("payments")
    .select("loan_id, amount, payment_type, fine_amount, created_at")
    .in("loan_id", loanIds)
    .order("created_at", { ascending: true });

  if (payErr) throw payErr;

  const waiverByLoan = new Map<string, Set<string>>();
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
    /* tabela pode não existir em ambientes antigos */
  }

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
    const due = String(r.due_date || "").split("T")[0];
    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };

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
