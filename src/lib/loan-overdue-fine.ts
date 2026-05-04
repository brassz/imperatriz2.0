import { addCalendarDays } from "@/lib/brazil-date";

/** Multa diária por dia civil de atraso (contrato / cobrança). */
export const DAILY_OVERDUE_FINE_BRL = 50;

/**
 * Lista cada dia civil em atraso: do dia seguinte ao vencimento até `referenceYmd` (inclusive).
 * Ex.: venc. 2026-04-01 e ref. 2026-04-03 → 2026-04-02, 2026-04-03.
 */
export function listOverdueFineCalendarDates(dueYmd: string, referenceYmd: string): string[] {
  const due = String(dueYmd || "").split("T")[0];
  const ref = String(referenceYmd || "").split("T")[0];
  if (!due || !ref || due >= ref) return [];
  const out: string[] = [];
  let d = addCalendarDays(due, 1);
  while (d <= ref) {
    out.push(d);
    d = addCalendarDays(d, 1);
  }
  return out;
}

export function computeOverdueDailyFineBrl(
  overdueDatesYmd: string[],
  waivedDatesYmd: Iterable<string>,
  brlPerDay = DAILY_OVERDUE_FINE_BRL,
): number {
  const waived = new Set(Array.from(waivedDatesYmd, (x) => String(x).split("T")[0]));
  let n = 0;
  for (const dt of overdueDatesYmd) {
    const day = String(dt).split("T")[0];
    if (!waived.has(day)) n++;
  }
  return n * brlPerDay;
}
