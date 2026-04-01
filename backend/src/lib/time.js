const TZ = "America/Sao_Paulo";

export function toLocalDateString(isoOrDateStr) {
  if (!isoOrDateStr) return "";
  const d = new Date(isoOrDateStr);
  if (Number.isNaN(d.getTime())) {
    const s = String(isoOrDateStr).split("T")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return "";
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function getTodayLocal() {
  return toLocalDateString(new Date());
}

export function addDaysLocal(n) {
  const today = getTodayLocal();
  if (!today) return "";
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function getTomorrowLocal() {
  return addDaysLocal(1);
}

export function getYesterdayLocal() {
  return addDaysLocal(-1);
}

export function diffDaysLocal(dateYmdA, dateYmdB) {
  // returns A - B in days (both YYYY-MM-DD)
  const [ay, am, ad] = String(dateYmdA).split("-").map(Number);
  const [by, bm, bd] = String(dateYmdB).split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad, 12, 0, 0);
  const b = Date.UTC(by, bm - 1, bd, 12, 0, 0);
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

