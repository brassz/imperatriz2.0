/** Score do cliente 1–100 baseado em pagamentos, vencimentos e valores pagos */

/** Dias em atraso até o contrato em aberto atingir penalidade máxima de pontualidade (antes disso o impacto sobe gradualmente). */
const OVERDUE_FULL_PENALTY_DAYS = 30;

function calendarDaysBetween(startYmd: string, endYmd: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return NaN;
    return Date.UTC(y, m - 1, d);
  };
  const a = parse(startYmd);
  const b = parse(endYmd);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

export type ClientScoreResult = {
  score: number;
  label: "Excelente" | "Bom" | "Razoável" | "Risco";
  details: {
    paidLoans: number;
    totalLoans: number;
    overdueCount: number;
    onTimeCount: number;
    totalPaid: number;
    totalExpected: number;
  };
};

type LoanForScore = {
  id: string;
  amount: number;
  interest_rate: number;
  due_date?: string;
  status: string;
  paid_date?: string;
};

type HistoryForScore = {
  loans: LoanForScore[];
  totalLoans: number;
  totalPaid: number;
};

export function calculateClientScore(history: HistoryForScore): ClientScoreResult {
  const { loans, totalLoans, totalPaid } = history;
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  if (totalLoans === 0) {
    return {
      score: 50,
      label: "Razoável",
      details: {
        paidLoans: 0,
        totalLoans: 0,
        overdueCount: 0,
        onTimeCount: 0,
        totalPaid: 0,
        totalExpected: 0,
      },
    };
  }

  let paidLoans = 0;
  let overdueCount = 0;
  let onTimeCount = 0;
  let totalExpected = 0;
  /** Soma 0–1 por contrato: atraso em aberto sobe com os dias; quitado com atraso conta 1. */
  let punctualityPenaltySum = 0;

  for (const loan of loans) {
    const amt = parseFloat(String(loan.amount || 0));
    const rate = parseFloat(String(loan.interest_rate || 0)) || 0;
    const rateNorm = rate > 100 ? rate / 100 : rate;
    totalExpected += amt + amt * (rateNorm / 100);

    if (loan.status === "paid") {
      paidLoans++;
      const paidDate = String(loan.paid_date || "").split("T")[0];
      const dueDate = String(loan.due_date || "").split("T")[0];
      if (paidDate && dueDate && paidDate <= dueDate) {
        onTimeCount++;
      } else if (paidDate && dueDate && paidDate > dueDate) {
        overdueCount++;
        punctualityPenaltySum += 1;
      }
    } else if (loan.status === "cancelled" || loan.status === "finalized") {
      // não conta como pagamento nem vencido em aberto
    } else {
      const dueDate = String(loan.due_date || "").split("T")[0];
      if (dueDate < todayStr) {
        overdueCount++;
        const daysOver = calendarDaysBetween(dueDate, todayStr);
        const gradual = Math.min(1, daysOver / OVERDUE_FULL_PENALTY_DAYS);
        punctualityPenaltySum += gradual;
      } else {
        onTimeCount++;
      }
    }
  }

  const completionRatio = paidLoans / totalLoans;
  const punctualityRatio = Math.max(
    0,
    Math.min(1, (totalLoans - punctualityPenaltySum) / totalLoans)
  );
  const repaymentRatio = totalExpected > 0 ? Math.min(1, totalPaid / totalExpected) : 1;

  const completionScore = completionRatio * 40;
  const punctualityScore = punctualityRatio * 40;
  const volumeScore = repaymentRatio * 20;

  let rawScore = Math.round(completionScore + punctualityScore + volumeScore);
  rawScore = Math.max(1, Math.min(100, rawScore));

  let label: ClientScoreResult["label"] = "Razoável";
  if (rawScore >= 80) label = "Excelente";
  else if (rawScore >= 60) label = "Bom";
  else if (rawScore >= 40) label = "Razoável";
  else label = "Risco";

  return {
    score: rawScore,
    label,
    details: {
      paidLoans,
      totalLoans,
      overdueCount,
      onTimeCount,
      totalPaid,
      totalExpected,
    },
  };
}
