/**
 * WhatsApp Scheduler (VPS) — sem Edge Functions.
 *
 * Env:
 * - Um projeto: SUPABASE_URL + SUPABASE_KEY (anon ou service role, conforme RLS)
 * - Vários: SUPABASE_PROJECTS (JSON array) ou SUPABASE_PROJECTS_FILE=/caminho.json
 *   ou supabase-projects.json na mesma pasta do .env carregado
 * Opcional: WHATSAPP_SCHEDULER_ENV_FILE, COMPANY_TITLE, WHATSAPP_SEND_GAP_MS
 *
 * node scripts/whatsapp-scheduler.mjs
 *
 * PM2: evite cron_restart a cada minuto se delay_minutos (ou gap) for alto — o PM2 pode
 * encerrar o processo no meio do envio. Prefira crontab do sistema chamando este script
 * uma vez por tick, ou cron_restart com intervalo maior que o tempo total do disparo.
 */
// Sem @supabase/supabase-js: PostgREST via fetch.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let lastLoadedSchedulerEnvPath = null;

function normalizeEnvKeyName(key) {
  let k = String(key || "").trim();
  if (/^export\s+/i.test(k)) k = k.replace(/^export\s+/i, "").trim();
  return k;
}

function extractMultilineEnvValue(raw, key) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^\\s*(?:export\\s+)?${esc}\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*(?:export\\s+)?[A-Z][A-Z0-9_]*\\s*=|$)`,
    "m",
  );
  const m = text.match(re);
  if (!m) return null;
  let val = m[1].trim();
  if (val.startsWith("\r")) val = val.slice(1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  return val;
}

function sliceJsonArrayValue(s) {
  const i = s.indexOf("[");
  if (i < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return s.slice(i, k + 1);
    }
  }
  return null;
}

function parseJsonArrayFromBrackets(s) {
  const slice = sliceJsonArrayValue(s);
  if (!slice) return null;
  try {
    const parsed = JSON.parse(slice);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mergeMultilineSupabaseProjectsFromRaw(raw) {
  const extracted = extractMultilineEnvValue(raw, "SUPABASE_PROJECTS");
  if (!extracted || !extracted.includes("[")) return;
  const prev = process.env.SUPABASE_PROJECTS || "";
  const extractedOk = parseJsonArrayFromBrackets(extracted);
  const prevOk = parseJsonArrayFromBrackets(prev);
  if (extractedOk && (!prevOk || extracted.length >= prev.length)) {
    process.env.SUPABASE_PROJECTS = extracted;
  }
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  lastLoadedSchedulerEnvPath = path.resolve(filePath);
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = normalizeEnvKeyName(trimmed.slice(0, eq).trim());
    if (!key || process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
  mergeMultilineSupabaseProjectsFromRaw(raw);
}

function loadEnvFiles() {
  const explicit = process.env.WHATSAPP_SCHEDULER_ENV_FILE || process.env.WHATSAPP_ENV_FILE;
  if (explicit) {
    loadEnvFile(path.resolve(explicit));
    return;
  }
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, "whatsapp-scheduler.env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      loadEnvFile(p);
      break;
    }
  }
}
loadEnvFiles();

function tryReadSiblingSupabaseProjectsJson() {
  if (!lastLoadedSchedulerEnvPath) return null;
  const p = path.join(path.dirname(lastLoadedSchedulerEnvPath), "supabase-projects.json");
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

const COMPANY_TITLE = process.env.COMPANY_TITLE || "NOVIXCRED";
const BETWEEN_MS = Math.min(Math.max(Number(process.env.WHATSAPP_SEND_GAP_MS || "3000"), 500), 30_000);

function getSupabaseHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function restBaseUrl(projectUrl) {
  return String(projectUrl || "").replace(/\/$/, "") + "/rest/v1";
}

async function restGet(project, pathWithQuery, extraHeaders = {}) {
  const url = restBaseUrl(project.url) + pathWithQuery;
  const res = await fetch(url, {
    method: "GET",
    headers: { ...getSupabaseHeaders(project.key), ...extraHeaders },
  });
  if (!res.ok) throw new Error(`Supabase GET ${pathWithQuery} -> HTTP ${res.status}: ${await res.text()}`);
  return await res.json();
}

const REST_IN_CHUNK = 80;

/** PostgREST: URLs id=in.(...) muito longas falham ou retornam incompleto; empréstimos podem precisar de Range. */
async function fetchClientsByIds(project, clientIds) {
  const ids = [...new Set(clientIds.map((x) => String(x || "").trim()).filter(Boolean))];
  const all = [];
  for (let i = 0; i < ids.length; i += REST_IN_CHUNK) {
    const chunk = ids.slice(i, i + REST_IN_CHUNK);
    const rows = await restGet(
      project,
      `/clients?select=id,name,phone&id=in.(${chunk.map(encodeURIComponent).join(",")})`,
    );
    if (Array.isArray(rows)) all.push(...rows);
  }
  return all;
}

async function restPatch(project, pathWithQuery, body) {
  const url = restBaseUrl(project.url) + pathWithQuery;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { ...getSupabaseHeaders(project.key), Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${pathWithQuery} -> HTTP ${res.status}: ${await res.text()}`);
}

function todayInSaoPaulo(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addCalendarDays(dateYmd, days) {
  const [y, m, dd] = String(dateYmd).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(dd)) return String(dateYmd);
  const x = new Date(Date.UTC(y, m - 1, dd));
  x.setUTCDate(x.getUTCDate() + days);
  const yy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(x.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${d2}`;
}

function weekdayKeySP(d) {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(d);
  const map = { Sun: "domingo", Mon: "segunda", Tue: "terca", Wed: "quarta", Thu: "quinta", Fri: "sexta", Sat: "sabado" };
  return map[w] || "segunda";
}

function hourMinuteSP(d) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return [h, m];
}

function parseHorario(s) {
  const [a, b] = String(s || "").split(":").map((x) => parseInt(x.trim(), 10));
  return [Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0];
}

function matchesDay(dias, today) {
  if ((dias || []).includes("todos")) return true;
  return (dias || []).includes(today);
}

function matchesScheduleNow(s, now) {
  if (!s.ativo) return false;
  const [sh, sm] = parseHorario(s.horario);
  const [ch, cm] = hourMinuteSP(now);
  const scheduledMinutes = sh * 60 + sm;
  const currentMinutes = ch * 60 + cm;
  if (currentMinutes < scheduledMinutes) return false;
  const today = weekdayKeySP(now);
  if (!matchesDay(s.dias || [], today)) return false;
  const todayStr = todayInSaoPaulo(now);
  if (s.last_fired_on === todayStr) return false;
  return true;
}

function normalizeBaseUrl(input) {
  const url = String(input || "").trim().replace(/\/$/, "");
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) return `https://${url}`;
  return url;
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : "55" + digits;
}

/** cobranca > hoje > amanhã — uma mensagem por cliente no mesmo disparo. */
function automationTypePriority(type) {
  if (type === "cobranca") return 3;
  if (type === "lembrete_hoje") return 2;
  if (type === "lembrete_amanha") return 1;
  return 0;
}

/** Uma mensagem por número WhatsApp; prioridade cobrança > hoje > amanhã. Chave = telefone normalizado (evita colapsar vários clientes se client_id vier errado). */
function dedupeOneMessagePerClient(entries) {
  const sorted = [...entries].sort((a, b) => b.priority - a.priority);
  const seen = new Set();
  const out = [];
  for (const e of sorted) {
    const phoneKey = normalizePhone(e.phone);
    const cid = String(e.client_id || "").trim();
    const key = phoneKey || (cid ? `cid:${cid}` : "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ phone: e.phone, text: e.text });
  }
  return out;
}

function formatDateBr(s) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(s);
}

function formatCurrency(n) {
  const x = Number(n || 0);
  return "R$ " + x.toFixed(2).replace(".", ",");
}

const INTEREST_ONLY_TYPES = new Set([
  "renewal",
  "interest_renewal",
  "early_payment_partial_interest",
  "early_payment_interest_renewal",
  "partial_interest",
]);

function computeLoanRemainingFromData(loan, payments) {
  const originalCapital = parseFloat(String(loan.original_amount || loan.amount || 0));
  let interestRate = parseFloat(String(loan.interest_rate || 0));
  if (interestRate > 100) interestRate = interestRate / 100;

  const realPayments = (payments || []).filter((p) => parseFloat(String(p.amount || 0)) > 0);
  let capitalPaid = 0;
  let currentCapital = originalCapital;
  for (const payment of realPayments) {
    const amt = parseFloat(String(payment.amount || 0));
    const type = String(payment.payment_type || "");
    if (INTEREST_ONLY_TYPES.has(type)) {
      // juros
    } else {
      const currentInterest = currentCapital * (interestRate / 100);
      if (amt > currentInterest) {
        const capitalReduction = amt - currentInterest;
        capitalPaid += capitalReduction;
        currentCapital = Math.max(0, currentCapital - capitalReduction);
      }
    }
  }
  const remainingCapital = Math.max(0, originalCapital - capitalPaid);
  const remainingInterest = remainingCapital * (interestRate / 100);
  const remainingAmount = remainingCapital + remainingInterest;
  return { capital: remainingCapital, interestAmount: remainingInterest, totalAmount: remainingAmount, minimumPayment: remainingInterest };
}

function buildCobrancaMessage(loan, pix, multaDiaria = 50) {
  const title = COMPANY_TITLE;
  const venc = formatDateBr(loan.due_date);
  const valor = formatCurrency(loan.amount);
  const cap = formatCurrency(loan.capital);
  const juros = formatCurrency(loan.interest);
  const multa = formatCurrency(loan.fine);
  return `🔴 COBRANÇA – ${title}\n\n📅 Venc.: ${venc}\nCliente: ${loan.client_name}\nValor: ${valor} (Cap.: ${cap} • Juros: ${juros} • Multa: ${multa})\n\n💳 PIX – ${pix.tipo}\nTitular: ${pix.titular}\nChave: ${pix.chave}\n\n⚠️ Após vencimento: multa diária R$ ${multaDiaria}. Enviar comprovante (obrigatório se pago em outra titularidade).`;
}

function buildLembreteHojeMessage(loan, pix) {
  const title = COMPANY_TITLE;
  const venc = formatDateBr(loan.due_date);
  const valor = formatCurrency(loan.amount);
  const juros = formatCurrency(loan.interest);
  const minimo = formatCurrency(loan.minimumPayment ?? loan.interest);
  return `🔔 LEMBRETE – ${title}\n\nCliente: ${loan.client_name}\n📅 Vencimento: ${venc}\n\n💵 Valor total: ${valor}\n📊 Juros: ${juros}\n💳 Pagamento mínimo: ${minimo}\n\n💳 PIX\n* Banco: ${pix.tipo}\n* Titular: ${pix.titular}\n* Chave: ${pix.chave}`;
}

function buildLembreteAmanhaMessage(loan, pix) {
  const title = COMPANY_TITLE;
  const venc = formatDateBr(loan.due_date);
  const valor = formatCurrency(loan.amount);
  const juros = formatCurrency(loan.interest);
  const minimo = formatCurrency(loan.minimumPayment ?? loan.interest);
  return `⏰ LEMBRETE (AMANHÃ) – ${title}\n\nCliente: ${loan.client_name}\n📅 Vencimento: ${venc}\n\n💵 Valor total: ${valor}\n📊 Juros: ${juros}\n💳 Pagamento mínimo: ${minimo}\n\n💳 PIX\n* Banco: ${pix.tipo}\n* Titular: ${pix.titular}\n* Chave: ${pix.chave}`;
}

function normalizeTargetIds(s) {
  const raw = s.target_client_ids;
  const arr = Array.isArray(raw) ? raw.map((x) => String(x)).filter(Boolean) : [];
  return arr.length ? new Set(arr) : null;
}

function filterAutomationLoans(loans, filtros) {
  const set = new Set(filtros || []);
  return (loans || []).filter((l) => {
    if (l.type === "cobranca" && set.has("vencidos")) return true;
    if (l.type === "lembrete_hoje" && set.has("vencem_hoje")) return true;
    if (l.type === "lembrete_amanha" && set.has("lembretes")) return true;
    return false;
  });
}

async function sendText(baseUrl, apiKey, instance, phone, text) {
  const base = normalizeBaseUrl(baseUrl);
  const httpFallback = base.startsWith("https://") ? base.replace(/^https:\/\//i, "http://") : null;
  const num = normalizePhone(phone);
  if (!num) return { ok: false, error: "missing phone" };

  async function attempt(b) {
    const url = `${b}/message/sendText/${encodeURIComponent(instance)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number: num, text }),
    });
    if (!res.ok) return { ok: false, error: (await res.text()) || `HTTP ${res.status}` };
    return { ok: true };
  }

  try {
    return await attempt(base);
  } catch (e) {
    if (httpFallback) {
      try {
        return await attempt(httpFallback);
      } catch (e2) {
        return { ok: false, error: `${e?.message || String(e)} | fallback http failed: ${e2?.message || String(e2)}` };
      }
    }
    return { ok: false, error: e?.message || String(e) };
  }
}

async function fetchLoansForAutomation(project) {
  const now = new Date();
  const today = todayInSaoPaulo(now);
  const tomorrow = addCalendarDays(today, 1);

  const rows = await restGet(
    project,
    `/loans?select=id,client_id,amount,interest_rate,due_date,status,original_amount&status=in.(active,overdue,partial_paid)&due_date=lte.${encodeURIComponent(
      tomorrow,
    )}&order=due_date.asc`,
    { Range: "0-9999" },
  );
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const clientIds = [...new Set(rows.map((l) => String(l.client_id || "")).filter(Boolean))];
  const clients = clientIds.length > 0 ? await fetchClientsByIds(project, clientIds) : [];
  const clientMap = {};
  for (const c of clients || []) {
    const rawPhone = String(c.phone || "");
    clientMap[String(c.id)] = { name: String(c.name || "—"), phone: rawPhone.replace(/\D/g, "") ? rawPhone : "" };
  }

  const candidates = [];
  for (const r of rows) {
    const due = String(r.due_date || "").split("T")[0];
    if (!due) continue;
    let type = null;
    if (due < today) type = "cobranca";
    else if (due === today) type = "lembrete_hoje";
    else if (due === tomorrow) type = "lembrete_amanha";
    else continue;
    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };
    if (!client.phone) continue;
    candidates.push({ row: r, type });
  }
  if (!candidates.length) return [];

  const loanIds = candidates.map((c) => String(c.row.id));
  const payRows = [];
  for (let i = 0; i < loanIds.length; i += REST_IN_CHUNK) {
    const chunk = loanIds.slice(i, i + REST_IN_CHUNK);
    const part = await restGet(
      project,
      `/payments?select=loan_id,amount,payment_type,fine_amount,created_at&loan_id=in.(${chunk
        .map(encodeURIComponent)
        .join(",")})&order=created_at.asc`,
    );
    if (Array.isArray(part)) payRows.push(...part);
  }

  const paymentsByLoan = {};
  for (const p of payRows || []) {
    const lid = String(p.loan_id || "");
    if (!lid) continue;
    if (!paymentsByLoan[lid]) paymentsByLoan[lid] = [];
    paymentsByLoan[lid].push({ amount: p.amount, payment_type: p.payment_type, fine_amount: p.fine_amount });
  }

  const out = [];
  for (const { row: r, type } of candidates) {
    const id = String(r.id);
    const due = String(r.due_date || "").split("T")[0];
    const client = clientMap[String(r.client_id)] || { name: "—", phone: "" };
    const rem = computeLoanRemainingFromData(
      { amount: r.amount, interest_rate: r.interest_rate, original_amount: r.original_amount },
      paymentsByLoan[id] || [],
    );
    out.push({
      id,
      client_id: String(r.client_id || ""),
      type,
      loan: {
        client_name: client.name,
        client_phone: client.phone,
        amount: rem.totalAmount,
        capital: rem.capital,
        interest: rem.interestAmount,
        fine: 0,
        due_date: due,
        minimumPayment: rem.minimumPayment,
      },
    });
  }
  return out;
}

async function fetchParcelamentoMessages(project, pix) {
  const now = new Date();
  const today = todayInSaoPaulo(now);
  const tomorrow = addCalendarDays(today, 1);

  const instRows = await restGet(
    project,
    `/installments?select=id,client_id,clients(name,phone),installment_payments(id,status,due_date,amount)&status=eq.active`,
    { Range: "0-9999" },
  );

  const out = [];
  for (const r of instRows || []) {
    const cl = r.clients || {};
    const rawPhone = String(cl.phone || "");
    const phone = rawPhone.replace(/\D/g, "") ? rawPhone : "";
    if (!phone) continue;
    const pays = (r.installment_payments || []).filter((p) => String(p.status || "") === "pending");
    const next = pays.sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")))[0];
    if (!next?.due_date) continue;
    const due = String(next.due_date).split("T")[0];

    let type = null;
    if (due < today) type = "cobranca";
    else if (due === today) type = "lembrete_hoje";
    else if (due === tomorrow) type = "lembrete_amanha";
    else continue;

    const amount = parseFloat(String(next.amount || 0)) || 0;
    const loanForMsg = {
      client_name: String(cl.name || "—"),
      client_phone: phone,
      amount,
      capital: amount,
      interest: 0,
      fine: 0,
      due_date: due,
      minimumPayment: amount,
    };
    let text = "";
    if (type === "cobranca") text = buildCobrancaMessage(loanForMsg, pix);
    else if (type === "lembrete_hoje") text = buildLembreteHojeMessage(loanForMsg, pix);
    else text = buildLembreteAmanhaMessage(loanForMsg, pix);
    out.push({ client_id: String(r.client_id || ""), phone, text, type });
  }
  return out;
}

async function runSchedule(project, s) {
  const pix = { tipo: s.pix_tipo, titular: s.pix_titular, chave: s.pix_chave };
  const allowClients = normalizeTargetIds(s);
  const delayMinutes = Number(s.delay_minutos || 0);
  const delayMs = Number.isFinite(delayMinutes) && delayMinutes > 0 ? delayMinutes * 60_000 : 0;
  const gapMs = delayMs > 0 ? delayMs : BETWEEN_MS;

  const allLoans = await fetchLoansForAutomation(project);
  let loans = filterAutomationLoans(allLoans, s.filtros);
  if (allowClients) loans = loans.filter((l) => allowClients.has(l.client_id));

  const queue = [];
  for (const item of loans) {
    let text = "";
    if (item.type === "cobranca") text = buildCobrancaMessage(item.loan, pix);
    else if (item.type === "lembrete_hoje") text = buildLembreteHojeMessage(item.loan, pix);
    else text = buildLembreteAmanhaMessage(item.loan, pix);
    queue.push({
      client_id: item.client_id,
      phone: item.loan.client_phone,
      text,
      priority: automationTypePriority(item.type),
    });
  }

  if ((s.filtros || []).includes("parcelamentos")) {
    let parcel = await fetchParcelamentoMessages(project, pix);
    if (allowClients) parcel = parcel.filter((p) => allowClients.has(p.client_id));
    for (const p of parcel) {
      queue.push({
        client_id: p.client_id,
        phone: p.phone,
        text: p.text,
        priority: automationTypePriority(p.type),
      });
    }
  }

  const messages = dedupeOneMessagePerClient(queue);

  const todayStr = todayInSaoPaulo(new Date());
  if (messages.length === 0) {
    await restPatch(project, `/whatsapp_schedules?id=eq.${encodeURIComponent(String(s.id))}`, { last_fired_on: todayStr });
    return { sent: 0, failed: 0, errors: [], stats: { queued: queue.length, recipients: 0 } };
  }

  let sent = 0;
  const errors = [];
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) await new Promise((res) => setTimeout(res, gapMs));
    const m = messages[i];
    const r = await sendText(s.evolution_base_url, s.evolution_api_key, s.instance, m.phone, m.text);
    if (r.ok) sent++;
    else errors.push(`${m.phone}: ${r.error || "?"}`);
  }
  const failed = messages.length - sent;
  if (sent > 0) {
    await restPatch(project, `/whatsapp_schedules?id=eq.${encodeURIComponent(String(s.id))}`, { last_fired_on: todayStr });
  }
  return {
    sent,
    failed,
    errors,
    stats: { queued: queue.length, recipients: messages.length },
  };
}

function getSupabaseProjectsRaw() {
  const fp = process.env.SUPABASE_PROJECTS_FILE?.trim();
  if (fp) {
    const p = path.resolve(fp);
    if (!fs.existsSync(p)) {
      throw new Error(`SUPABASE_PROJECTS_FILE não encontrado: ${p}`);
    }
    return fs.readFileSync(p, "utf8");
  }
  return process.env.SUPABASE_PROJECTS;
}

function stripLeadingExportAssignment(s, envKey) {
  const esc = envKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(s || "").replace(new RegExp(`^\\s*export\\s+${esc}\\s*=\\s*`, "im"), "");
}

function collapseLiteralNewlinesInEnv(s) {
  const t = String(s || "");
  if (t.includes("\n")) return t;
  if (/\\n/.test(t)) return t.replace(/\\n/g, "\n");
  return t;
}

function trimHeredocShellSuffix(s) {
  return String(s || "")
    .replace(/\r?\n\s*JSON\s*\r?\n\s*\)\s*["']?\s*$/im, "")
    .replace(/\r?\n\s*JSON\s*["']?\s*$/im, "");
}

function normalizeSupabaseProjectsRawInput(multiRaw) {
  let s = String(multiRaw || "").trim().replace(/^\uFEFF/, "");
  s = stripLeadingExportAssignment(s, "SUPABASE_PROJECTS");
  s = collapseLiteralNewlinesInEnv(s);
  s = trimHeredocShellSuffix(s).trim();
  return s;
}

function parseSupabaseProjectsJson(multiRaw) {
  const s = normalizeSupabaseProjectsRawInput(multiRaw);
  if (!s) return null;

  const looksLikeShellPaste =
    s.includes("$(cat") || /<<\s*['"]?JSON/i.test(s) || /^\$\s*\(/.test(s);

  if (looksLikeShellPaste) {
    let fromBrackets = parseJsonArrayFromBrackets(s);
    if (!fromBrackets) {
      const i = s.indexOf("[");
      if (i > 0) fromBrackets = parseJsonArrayFromBrackets(s.slice(i));
    }
    if (fromBrackets) return fromBrackets;
    throw new Error(
      "SUPABASE_PROJECTS (heredoc) inválido. Use SUPABASE_PROJECTS_FILE ou supabase-projects.json ao lado do .env.",
    );
  }

  try {
    return JSON.parse(s);
  } catch (e) {
    const fromBrackets = parseJsonArrayFromBrackets(s);
    if (fromBrackets) return fromBrackets;
    throw e;
  }
}

async function main() {
  const singleUrl = process.env.SUPABASE_URL;
  const singleKey =
    process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  let multiRaw;
  try {
    multiRaw = getSupabaseProjectsRaw();
  } catch (e) {
    console.error(e?.message || e);
    process.exitCode = 1;
    return;
  }

  /** @type {Array<{ name?: string; url: string; key: string }>} */
  let projects = [];

  if (singleUrl && singleKey) {
    projects = [{ name: "default", url: singleUrl, key: singleKey }];
  } else if (multiRaw) {
    try {
      let parsed;
      try {
        parsed = parseSupabaseProjectsJson(multiRaw);
      } catch (e) {
        const sibling = tryReadSiblingSupabaseProjectsJson();
        if (sibling) parsed = parseSupabaseProjectsJson(sibling);
        else throw e;
      }
      if (!parsed) {
        console.error("SUPABASE_PROJECTS vazio.");
        process.exitCode = 1;
        return;
      }
      if (!Array.isArray(parsed)) throw new Error("SUPABASE_PROJECTS deve ser um array JSON");
      projects = parsed
        .map((p) => ({
          name: p?.name != null ? String(p.name) : "project",
          url: String(p?.url || ""),
          key: String(p?.key || p?.anonKey || p?.anon_key || p?.serviceRoleKey || p?.service_role_key || ""),
        }))
        .filter((p) => p.url && p.key);
    } catch (e) {
      console.error("Invalid SUPABASE_PROJECTS JSON:", e?.message || e);
      process.exitCode = 1;
      return;
    }
  }

  if (!projects.length) {
    console.error("Missing Supabase credentials: SUPABASE_URL+KEY ou SUPABASE_PROJECTS / SUPABASE_PROJECTS_FILE.");
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  const allResults = [];

  for (const proj of projects) {
    const schedules = await restGet(proj, `/whatsapp_schedules?select=*&ativo=eq.true`);
    const results = [];
    for (const s of schedules) {
      if (!matchesScheduleNow(s, now)) continue;
      try {
        const r = await runSchedule(proj, s);
        results.push({ id: s.id, ok: true, ...r });
      } catch (e) {
        results.push({ id: s.id, ok: false, error: e?.message || String(e) });
      }
    }
    allResults.push({
      project: proj.name || proj.url,
      ok: true,
      processed: results.length,
      results,
    });
  }

  console.log(JSON.stringify({ ok: true, projects: allResults, now: now.toISOString() }));
}

main().catch((e) => {
  console.error("scheduler fatal:", e?.message || e);
  process.exitCode = 1;
});
