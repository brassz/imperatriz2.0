/**
 * Datas civis (YYYY-MM-DD) no fuso America/Sao_Paulo.
 * Evita usar toISOString() para "hoje"/"amanhã": em BRT, das 21h–23h59 o dia em UTC já é o seguinte,
 * o que cobrava "amanhã" antes da meia-noite local.
 */

export const BRAZIL_TIMEZONE = "America/Sao_Paulo";

/** Data civil atual em São Paulo (YYYY-MM-DD). */
export function calendarDateInBrazil(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Soma dias a uma data civil YYYY-MM-DD (mesmo calendário dos vencimentos no banco). */
export function addCalendarDays(dateYmd: string, days: number): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateYmd;
  const x = new Date(Date.UTC(y, m - 1, d));
  x.setUTCDate(x.getUTCDate() + days);
  const yy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(x.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Amanhã civil em relação ao "agora" em São Paulo. */
export function tomorrowCalendarDateBrazil(now: Date = new Date()): string {
  return addCalendarDays(calendarDateInBrazil(now), 1);
}
