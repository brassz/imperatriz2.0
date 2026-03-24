/**
 * Deploy: supabase functions deploy run-whatsapp-schedules --no-verify-jwt
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET (opcional)
 * Cron externo (ex.: cron-job.org) a cada 1 min:
 *   curl -sS -X POST "$SUPABASE_URL/functions/v1/run-whatsapp-schedules" \
 *     -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json"
 *
 * A Evolution API precisa estar online (mesmo com seu PC desligado).
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

type DiaSemana =
  | "todos"
  | "segunda"
  | "terca"
  | "quarta"
  | "quinta"
  | "sexta"
  | "sabado"
  | "domingo";
type Filtro = "vencem_hoje" | "vencidos" | "parcelamentos" | "lembretes";

type Schedule = {
  id: string;
  horario: string;
  dias: DiaSemana[];
  filtros: Filtro[];
  delay_minutos: number;
  ativo: boolean;
  instance: string;
  evolution_base_url: string;
  evolution_api_key: string;
  pix_tipo: string;
  pix_titular: string;
  pix_chave: string;
  last_fired_on: string | null;
  target_client_ids?: string[] | null;
};

const COMPANY_TITLE = Deno.env.get("COMPANY_TITLE") || "NOVIXCRED";
const BETWEEN_MS = Math.min(
  Math.max(Number(Deno.env.get("WHATSAPP_SEND_GAP_MS") || "3000"), 500),
  30_000,
);

function todayInSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Amanhã civil a partir de YYYY-MM-DD (igual ao app; não usar UTC). */
function addCalendarDays(dateYmd: string, days: number): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateYmd;
  const x = new Date(Date.UTC(y, m - 1, d));
  x.setUTCDate(x.getUTCDate() + days);
  const yy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(x.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function weekdayKeySP(d: Date): DiaSemana {
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(d);
  const map: Record<string, DiaSemana> = {
    Sun: "domingo",
    Mon: "segunda",
    Tue: "terca",
    Wed: "quarta",
    Thu: "quinta",
    Fri: "sexta",
    Sat: "sabado",
  };
  return map[w] ?? "segunda";
}

function hourMinuteSP(d: Date): [number, number] {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return [h, m];
}

function parseHorario(s: string): [number, number] {
  const [a, b] = s.split(":").map((x) => parseInt(x.trim(), 10));
  return [Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0];
}

function matchesDay(dias: DiaSemana[], today: DiaSemana): boolean {
  if (dias.includes("todos")) return true;
  return dias.includes(today);
}

function matchesScheduleNow(s: Schedule, now: Date): boolean {
  if (!s.ativo) return false;
  const [sh, sm] = parseHorario(s.horario);
  const [ch, cm] = hourMinuteSP(now);
  if (ch !== sh || cm !== sm) return false;
  const today = weekdayKeySP(now);
  if (!matchesDay(s.dias, today)) return false;
  const todayStr = todayInSaoPaulo(now);
  if (s.last_fired_on === todayStr) return false;
  return true;
}

function normalizeBaseUrl(input: string): string {
  const url = String(input || "").trim().replace(/\/$/, "");
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) return `https://${url}`;
  return url;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("55") ? digits : "55" + digits;
}

function formatDateBr(s: string) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

function formatCurrency(n: number) {
  return "R$ " + n.toFixed(2).replace(".", ",");
}

type LoanForMessage = {
  client_name: string;
  client_phone: string;
  amount: number;
  capital: number;
  interest: number;
  fine: number;
  due_date: string;
  minimumPayment?: number;
};

type AutomationLoan = {
  id: string;
  client_id: string;
  type: "cobranca" | "lembrete_hoje" | "lembrete_amanha";
  loan: LoanForMessage;
};

const INTEREST_ONLY_TYPES = [
  "renewal",
  "interest_renewal",
  "early_payment_partial_interest",
  "early_payment_interest_renewal",
  "partial_interest",
];

type PaymentRow = { amount?: unknown; payment_type?: unknown; fine_amount?: unknown };

function computeLoanRemainingFromData(
  loan: { amount?: unknown; interest_rate?: unknown; original_amount?: unknown },
  payments: PaymentRow[],
) {
  const originalCapital = parseFloat(String((loan as { original_amount?: unknown }).original_amount || loan.amount || 0));
  let interestRate = parseFloat(String(loan.interest_rate || 0));
  if (interestRate > 100) interestRate = interestRate / 100;

  const realPayments = payments.filter((p) => parseFloat(String(p.amount || 0)) > 0);

  let capitalPaid = 0;
  let interestPaid = 0;
  let currentCapital = originalCapital;

  for (const payment of realPayments) {
    const amt = parseFloat(String(payment.amount || 0));
    const type = String(payment.payment_type || "");

    if (INTEREST_ONLY_TYPES.includes(type)) {
      interestPaid += amt;
    } else {
      const currentInterest = currentCapital * (interestRate / 100);
      if (amt > currentInterest) {
        interestPaid += currentInterest;
        const capitalReduction = amt - currentInterest;
        capitalPaid += capitalReduction;
        currentCapital = Math.max(0, currentCapital - capitalReduction);
      } else {
        interestPaid += amt;
      }
    }
  }

  const remainingCapital = Math.max(0, originalCapital - capitalPaid);
  const remainingInterest = remainingCapital * (interestRate / 100);
  const remainingAmount = remainingCapital + remainingInterest;
  const minimumPayment = remainingInterest;

  return {
    capital: remainingCapital,
    interestAmount: remainingInterest,
    totalAmount: remainingAmount,
    minimumPayment,
  };
}

async function fetchLoansForAutomation(supabase: SupabaseClient): Promise<AutomationLoan[]> {
  const now = new Date();
  const today = todayInSaoPaulo(now);
  const tomorrow = addCalendarDays(today, 1);

  const { data: loans, error } = await supabase
    .from("loans")
    .select("id, client_id, amount, interest_rate, due_date, status, original_amount")
    .in("status", ["active", "overdue", "partial_paid"])
    .lte("due_date", tomorrow)
    .order("due_date", { ascending: true });

  if (error) throw error;

  const rows = (loans || []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const clientIds = [...new Set(rows.map((l) => String(l.client_id || "")).filter(Boolean))];
  const { data: clients } = await supabase.from("clients").select("id, name, phone").in("id", clientIds);
  const clientMap: Record<string, { name: string; phone: string }> = {};
  for (const c of clients || []) {
    const r = c as Record<string, unknown>;
    const rawPhone = String(r.phone || "");
    clientMap[String(r.id)] = {
      name: String(r.name || "—"),
      phone: rawPhone.replace(/\D/g, "") ? rawPhone : "",
    };
  }

  const candidates: Array<{ row: Record<string, unknown>; type: AutomationLoan["type"] }> = [];
  for (const r of rows) {
    const due = String(r.due_date || "").split("T")[0];
    if (!due) continue;

    let type: AutomationLoan["type"] | null = null;
    if (due < today) type = "cobranca";
    else if (due === today) type = "lembrete_hoje";
    else if (due === tomorrow) type = "lembrete_amanha";
    else continue;

    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };
    if (!client.phone) continue;

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

  const paymentsByLoan: Record<string, PaymentRow[]> = {};
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

    let rem: ReturnType<typeof computeLoanRemainingFromData>;
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

    const loanForMsg: LoanForMessage = {
      client_name: client.name,
      client_phone: client.phone,
      amount: rem.totalAmount,
      capital: rem.capital,
      interest: rem.interestAmount,
      fine: 0,
      due_date: due,
      minimumPayment: rem.minimumPayment,
    };

    result.push({
      id,
      client_id: String(r.client_id || ""),
      type,
      loan: loanForMsg,
    });
  }

  return result;
}

function buildCobrancaMessage(loan: LoanForMessage, pix: { tipo: string; titular: string; chave: string }, multaDiaria = 50) {
  const title = COMPANY_TITLE;
  const venc = formatDateBr(loan.due_date);
  const valor = formatCurrency(loan.amount);
  const cap = formatCurrency(loan.capital);
  const juros = formatCurrency(loan.interest);
  const multa = formatCurrency(loan.fine);

  return `🔴 COBRANÇA – ${title}

📅 Venc.: ${venc}
Cliente: ${loan.client_name}
Valor: ${valor} (Cap.: ${cap} • Juros: ${juros} • Multa: ${multa})

💳 PIX – ${pix.tipo}
Titular: ${pix.titular}
Chave: ${pix.chave}

⚠️ Após vencimento: multa diária R$ ${multaDiaria}. Enviar comprovante (obrigatório se pago em outra titularidade).`;
}

function buildLembreteHojeMessage(loan: LoanForMessage, pix: { tipo: string; titular: string; chave: string }) {
  const title = COMPANY_TITLE;
  const venc = formatDateBr(loan.due_date);
  const valor = formatCurrency(loan.amount);
  const juros = formatCurrency(loan.interest);
  const minimo = formatCurrency(loan.minimumPayment ?? loan.interest);

  return `🔔 LEMBRETE – ${title}

Cliente: ${loan.client_name}
📅 Vencimento: ${venc}

💵 Valor total: ${valor}
📊 Juros: ${juros}
💳 Pagamento mínimo: ${minimo}

💳 PIX
* Banco: ${pix.tipo}
* Titular: ${pix.titular}
* Chave: ${pix.chave}`;
}

function buildLembreteAmanhaMessage(loan: LoanForMessage, pix: { tipo: string; titular: string; chave: string }) {
  const title = COMPANY_TITLE;
  const venc = formatDateBr(loan.due_date);
  const valor = formatCurrency(loan.amount);
  const juros = formatCurrency(loan.interest);
  const minimo = formatCurrency(loan.minimumPayment ?? loan.interest);

  return `🔔 LEMBRETE – ${title}

Cliente: ${loan.client_name}
📅 Vencimento: ${venc} (amanhã)

💵 Valor total: ${valor}
📊 Juros: ${juros}
💳 Pagamento mínimo: ${minimo}

💳 PIX
* Banco: ${pix.tipo}
* Titular: ${pix.titular}
* Chave: ${pix.chave}`;
}

async function fetchParcelamentoMessages(
  supabase: SupabaseClient,
  pix: { tipo: string; titular: string; chave: string },
): Promise<Array<{ phone: string; text: string; client_id: string }>> {
  const { data, error } = await supabase
    .from("installments")
    .select(
      `
      id,
      client_id,
      clients (name, phone),
      installment_payments (id, status, due_date, amount)
    `,
    )
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const out: Array<{ phone: string; text: string; client_id: string }> = [];
  for (const row of data || []) {
    const r = row as Record<string, unknown>;
    const clientId = String(r.client_id || "");
    const clients = (r.clients as { name?: string; phone?: string }) || {};
    const name = clients.name || "—";
    const rawPhone = String(clients.phone || "");
    const phone = rawPhone.replace(/\D/g, "") ? rawPhone : "";
    if (!phone) continue;

    const payments = ((r.installment_payments as Array<Record<string, unknown>>) || [])
      .filter((p) => String(p.status) === "pending")
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    const next = payments[0];
    if (!next) continue;

    const amt = parseFloat(String(next.amount || 0));
    const venc = formatDateBr(String(next.due_date || ""));
    const text = `🔔 PARCELA – ${COMPANY_TITLE}

Cliente: ${name}
Valor: ${formatCurrency(amt)}
Venc.: ${venc}

💳 PIX
* Banco: ${pix.tipo}
* Titular: ${pix.titular}
* Chave: ${pix.chave}`;

    out.push({ phone, text, client_id: clientId });
  }

  return out;
}

/** Mesmos filtros da tela: vencidos, vencem hoje, lembretes (vencem amanhã); parcelamentos é tratado à parte. */
function filterAutomationLoans(loans: AutomationLoan[], filtros: Filtro[]): AutomationLoan[] {
  const set = new Set(filtros);
  return loans.filter((l) => {
    if (l.type === "cobranca" && set.has("vencidos")) return true;
    if (l.type === "lembrete_hoje" && set.has("vencem_hoje")) return true;
    if (l.type === "lembrete_amanha" && set.has("lembretes")) return true;
    return false;
  });
}

async function sendText(
  baseUrl: string,
  apiKey: string,
  instance: string,
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const base = normalizeBaseUrl(baseUrl);
  const num = normalizePhone(phone);
  const url = `${base}/message/sendText/${encodeURIComponent(instance)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number: num, text }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function normalizeTargetIds(s: Schedule): Set<string> | null {
  const raw = s.target_client_ids;
  const arr = Array.isArray(raw) ? raw.map((x) => String(x)).filter(Boolean) : [];
  return arr.length > 0 ? new Set(arr) : null;
}

async function runSchedule(supabase: SupabaseClient, s: Schedule) {
  const pix = {
    tipo: s.pix_tipo,
    titular: s.pix_titular,
    chave: s.pix_chave,
  };

  const allowClients = normalizeTargetIds(s);

  const allLoans = await fetchLoansForAutomation(supabase);
  let loans = filterAutomationLoans(allLoans, s.filtros);
  if (allowClients) {
    loans = loans.filter((l) => allowClients.has(l.client_id));
  }

  const messages: { phone: string; text: string }[] = [];

  for (const item of loans) {
    let text: string;
    if (item.type === "cobranca") text = buildCobrancaMessage(item.loan, pix);
    else if (item.type === "lembrete_hoje") text = buildLembreteHojeMessage(item.loan, pix);
    else text = buildLembreteAmanhaMessage(item.loan, pix);
    messages.push({ phone: item.loan.client_phone, text });
  }

  if (s.filtros.includes("parcelamentos")) {
    let parcel = await fetchParcelamentoMessages(supabase, pix);
    if (allowClients) {
      parcel = parcel.filter((p) => allowClients.has(p.client_id));
    }
    for (const p of parcel) messages.push({ phone: p.phone, text: p.text });
  }

  const todayStr = todayInSaoPaulo(new Date());
  if (messages.length === 0) {
    await supabase.from("whatsapp_schedules").update({ last_fired_on: todayStr }).eq("id", s.id);
    return { sent: 0, skipped: 0, errors: [] as string[] };
  }

  let sent = 0;
  const errors: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const r = await sendText(s.evolution_base_url, s.evolution_api_key, s.instance, m.phone, m.text);
    if (r.ok) sent++;
    else errors.push(`${m.phone}: ${r.error || "?"}`);
    if (i < messages.length - 1) await new Promise((res) => setTimeout(res, BETWEEN_MS));
  }

  await supabase.from("whatsapp_schedules").update({ last_fired_on: todayStr }).eq("id", s.id);

  return { sent, failed: messages.length - sent, errors };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret) {
    const auth = req.headers.get("Authorization");
    if (auth !== `Bearer ${secret}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const now = new Date();

  const { data: rows, error } = await supabase.from("whatsapp_schedules").select("*").eq("ativo", true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const schedules = (rows || []) as Schedule[];
  const results: unknown[] = [];

  for (const s of schedules) {
    if (!matchesScheduleNow(s, now)) continue;
    try {
      const r = await runSchedule(supabase, s);
      results.push({ id: s.id, ok: true, ...r });
    } catch (e) {
      results.push({ id: s.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: results.length, results, now: now.toISOString() }),
    { headers: { "Content-Type": "application/json" } },
  );
});
