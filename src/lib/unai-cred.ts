import { addCalendarDays } from "@/lib/brazil-date";
import { computeOverdueDailyFineBrl, listOverdueFineCalendarDates } from "@/lib/loan-overdue-fine";
import type { CompanyId } from "@/lib/companies";
import { getSupabaseCompany } from "@/lib/supabase";

export type UnaiLoanProduct = "mensal" | "20_dias" | "semanal_1" | "semanal_2";

export const UNAI_LOAN_PRODUCT_OPTIONS: Array<{ id: UnaiLoanProduct; label: string; description: string }> = [
  {
    id: "semanal_1",
    label: "Semanal 1",
    description: "Valor total do contrato dividido em 4 parcelas semanais iguais",
  },
  {
    id: "semanal_2",
    label: "Semanal 2",
    description: "Juros em 4 parcelas; na última semana o cliente paga juros + capital",
  },
  {
    id: "mensal",
    label: "Mensal",
    description: "Empréstimo mensal (30 dias), como nas demais empresas",
  },
  {
    id: "20_dias",
    label: "20 dias",
    description: "Empréstimo de 20 dias, como nas demais empresas",
  },
];

/** Empresa com produtos Semanal 1, Semanal 2 e Mensal. */
export function supportsWeeklyLoanProducts(companyId?: CompanyId): boolean {
  return (companyId ?? getSupabaseCompany()) === "imperatriz";
}

/** @deprecated Use supportsWeeklyLoanProducts */
export function isUnaiCredCompany(companyId?: CompanyId): boolean {
  return supportsWeeklyLoanProducts(companyId);
}

/** Opções de empréstimo CRED CARD - IMPERATRIZ (sem 20 dias). */
export const IMPERATRIZ_LOAN_PRODUCT_OPTIONS = UNAI_LOAN_PRODUCT_OPTIONS.filter(
  (o) => o.id !== "20_dias",
);

export function isWeeklyLoanProduct(product: string | null | undefined): product is "semanal_1" | "semanal_2" {
  return product === "semanal_1" || product === "semanal_2";
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type WeeklyInstallmentDraft = {
  week_number: number;
  due_date: string;
  amount: number;
};

/** Monta as 4 parcelas semanais conforme o tipo Unaí Cred. */
export function buildUnaiWeeklyInstallments(
  product: "semanal_1" | "semanal_2",
  capital: number,
  interestRatePercent: number,
  loanDateYmd: string,
): WeeklyInstallmentDraft[] {
  const capitalAmt = Math.max(0, capital);
  const interest = capitalAmt * (Math.max(0, interestRatePercent) / 100);
  const rows: WeeklyInstallmentDraft[] = [];

  if (product === "semanal_1") {
    const total = capitalAmt + interest;
    const base = roundMoney(total / 4);
    let allocated = 0;
    for (let week = 1; week <= 4; week++) {
      const amount = week === 4 ? roundMoney(total - allocated) : base;
      allocated += amount;
      rows.push({
        week_number: week,
        due_date: addCalendarDays(loanDateYmd, week * 7),
        amount,
      });
    }
    return rows;
  }

  const weeklyInterest = roundMoney(interest / 4);
  for (let week = 1; week <= 4; week++) {
    const amount = week < 4 ? weeklyInterest : roundMoney(weeklyInterest + capitalAmt);
    rows.push({
      week_number: week,
      due_date: addCalendarDays(loanDateYmd, week * 7),
      amount,
    });
  }
  return rows;
}

export function unaiLoanProductLabel(product: string | null | undefined): string {
  const found = UNAI_LOAN_PRODUCT_OPTIONS.find((o) => o.id === product);
  return found?.label || "Mensal";
}

export function computeUnaiDueDate(product: UnaiLoanProduct, loanDateYmd: string): string {
  if (product === "20_dias") return addCalendarDays(loanDateYmd, 20);
  if (product === "semanal_1" || product === "semanal_2") return addCalendarDays(loanDateYmd, 28);
  return addCalendarDays(loanDateYmd, 30);
}

export type UnaiWeeklyInstallmentRow = {
  week_number: number;
  due_date: string;
  amount: number;
  status: "pending" | "paid";
};

export type UnaiWeeklyMessageContext = {
  installments: UnaiWeeklyInstallmentRow[];
  /** Semanas pendentes com vencimento anterior a hoje. */
  overdue_weeks: number[];
  /** Semana em foco na cobrança/lembrete. */
  focus_week: number;
  primary_due_date: string;
  weeks_amount_due: number;
  fine: number;
};

function formatDateBrYmd(ymd: string): string {
  const [y, m, d] = String(ymd || "").split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : ymd;
}

function formatCurrencyBr(n: number): string {
  return "R$ " + n.toFixed(2).replace(".", ",");
}

/** Texto do cronograma semanal para WhatsApp (cobrança / lembrete). */
export function formatUnaiWeeklyScheduleTable(
  installments: UnaiWeeklyInstallmentRow[],
  today: string,
): string {
  const sorted = [...installments].sort((a, b) => a.week_number - b.week_number);
  const lines = sorted.map((row) => {
    const due = String(row.due_date || "").split("T")[0];
    const val = formatCurrencyBr(row.amount);
    const date = formatDateBrYmd(due);
    if (row.status === "paid") {
      return `✅ Semana ${row.week_number} — ${date} — ${val} (paga)`;
    }
    if (due < today) {
      return `🔴 Semana ${row.week_number} — ${date} — ${val} ← EM ATRASO`;
    }
    if (due === today) {
      return `🟡 Semana ${row.week_number} — ${date} — ${val} ← vence hoje`;
    }
    return `⏳ Semana ${row.week_number} — ${date} — ${val}`;
  });
  return `📋 Cronograma semanal:\n${lines.join("\n")}`;
}

function formatOverdueWeeksLabel(weeks: number[]): string {
  if (weeks.length === 0) return "";
  if (weeks.length === 1) return `Semana ${weeks[0]} em atraso`;
  return `Semanas ${weeks.join(", ")} em atraso`;
}

/** Monta contexto semanal para automação (vencido / hoje / amanhã). */
export function resolveUnaiWeeklyForAutomation(
  installments: UnaiWeeklyInstallmentRow[],
  today: string,
  tomorrow: string,
  waivedDates: Iterable<string>,
): { type: "cobranca" | "lembrete_hoje" | "lembrete_amanha"; ctx: UnaiWeeklyMessageContext } | null {
  const sorted = [...installments].sort((a, b) => a.week_number - b.week_number);
  const pending = sorted.filter((i) => i.status === "pending");
  if (pending.length === 0) return null;

  const actionable = pending.filter((i) => String(i.due_date).split("T")[0] <= tomorrow);
  if (actionable.length === 0) return null;

  const overduePending = pending.filter((i) => String(i.due_date).split("T")[0] < today);
  const first = actionable[0];
  const due = String(first.due_date).split("T")[0];

  let type: "cobranca" | "lembrete_hoje" | "lembrete_amanha";
  if (overduePending.length > 0) type = "cobranca";
  else if (due === today) type = "lembrete_hoje";
  else type = "lembrete_amanha";

  const overdueWeeks = overduePending.map((i) => i.week_number);
  const weeksAmountDue =
    overduePending.length > 0
      ? overduePending.reduce((s, i) => s + i.amount, 0)
      : first.amount;

  const earliestOverdueDue = overduePending.length
    ? String(overduePending[0].due_date).split("T")[0]
    : due;
  const fineDates =
    type === "cobranca" && overduePending.length > 0
      ? listOverdueFineCalendarDates(earliestOverdueDue, today)
      : [];
  const fine =
    fineDates.length > 0 ? computeOverdueDailyFineBrl(fineDates, waivedDates) : 0;

  return {
    type,
    ctx: {
      installments: sorted,
      overdue_weeks: overdueWeeks,
      focus_week: overduePending.length > 0 ? overduePending[0].week_number : first.week_number,
      primary_due_date: due,
      weeks_amount_due: weeksAmountDue,
      fine,
    },
  };
}

/** Contexto para cobrança manual (botão COBRANÇA na aba empréstimos). */
export function resolveUnaiWeeklyForCobranca(
  installments: UnaiWeeklyInstallmentRow[],
  today: string,
  waivedDates: Iterable<string>,
): UnaiWeeklyMessageContext | null {
  const sorted = [...installments].sort((a, b) => a.week_number - b.week_number);
  const pending = sorted.filter((i) => i.status === "pending");
  if (pending.length === 0) return null;

  const overduePending = pending.filter((i) => String(i.due_date).split("T")[0] < today);
  const focus = overduePending.length > 0 ? overduePending[0] : pending[0];
  const due = String(focus.due_date).split("T")[0];
  const overdueWeeks = overduePending.map((i) => i.week_number);
  const weeksAmountDue =
    overduePending.length > 0
      ? overduePending.reduce((s, i) => s + i.amount, 0)
      : focus.amount;

  const earliestOverdueDue = overduePending.length
    ? String(overduePending[0].due_date).split("T")[0]
    : due;
  const fineDates =
    overduePending.length > 0
      ? listOverdueFineCalendarDates(earliestOverdueDue, today)
      : [];
  const fine =
    fineDates.length > 0 ? computeOverdueDailyFineBrl(fineDates, waivedDates) : 0;

  return {
    installments: sorted,
    overdue_weeks: overdueWeeks,
    focus_week: focus.week_number,
    primary_due_date: due,
    weeks_amount_due: weeksAmountDue,
    fine,
  };
}

export { formatOverdueWeeksLabel, formatDateBrYmd as formatUnaiDateBr, formatCurrencyBr as formatUnaiCurrencyBr };
