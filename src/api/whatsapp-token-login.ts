import { supabase, setSupabaseCompany } from "@/lib/supabase";
import type { CompanyId } from "@/lib/companies";
import type { User } from "@/api/auth";
import { sendWhatsAppTextWithInstance } from "@/api/evolution";
import { calculateLoanRemaining } from "@/api/loan-calc";
import { calendarDateInBrazil, tomorrowCalendarDateBrazil } from "@/lib/brazil-date";
import {
  FIXED_EVOLUTION_BASE_URL,
  getApiKeyForEvolutionInstance,
  LOGIN_EVOLUTION_INSTANCE,
} from "@/lib/evolution-settings";

const TOKEN_TTL_MIN = 10;

function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

function randomToken(): string {
  // 6 dígitos é simples para digitar
  const n = Math.floor(Math.random() * 900_000) + 100_000;
  return String(n);
}

async function sha256Hex(input: string): Promise<string> {
  const subtle = (globalThis as any)?.crypto?.subtle as SubtleCrypto | undefined;
  if (subtle?.digest) {
    const data = new TextEncoder().encode(input);
    const hash = await subtle.digest("SHA-256", data);
    const bytes = Array.from(new Uint8Array(hash));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Fallback para ambientes onde `crypto.subtle` não existe (alguns setups do Vite/dev).
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { bytesToHex } = await import("@noble/hashes/utils.js");
  const out = sha256(new TextEncoder().encode(input));
  return bytesToHex(out);
}

function todayLocalYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nextDayYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateBR(ymd: string): string {
  const [y, m, d] = String(ymd || "").split("T")[0].split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function fmtBrl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function progressBarText(percent: number): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const total = 10;
  const filled = Math.round((p / 100) * total);
  return `${"█".repeat(filled)}${"░".repeat(total - filled)} ${p}%`;
}

/**
 * Resumo do dia para o WhatsApp pós-login: juros dos empréstimos que vencem hoje, quantidade e barra de cobrança.
 */
async function buildLoginConfirmedDailySummaryMessage(): Promise<string> {
  // Alinha com o resto do sistema (America/Sao_Paulo).
  const todayYmd = calendarDateInBrazil();
  const tomorrowYmd = tomorrowCalendarDateBrazil();
  const todayLabel = formatDateBR(todayYmd);

  let totalJurosHoje = 0;
  let qtdEmprestimos = 0;
  let progressPct = 0;
  let paidLoansToday = 0;

  try {
    const { data: rows, error } = await supabase
      .from("loans")
      .select("id")
      .in("status", ["active", "overdue", "partial_paid"])
      .gte("due_date", todayYmd)
      .lt("due_date", tomorrowYmd);

    if (error) throw error;

    const ids = (rows || []).map((r: { id?: unknown }) => String(r.id || "")).filter(Boolean);
    qtdEmprestimos = ids.length;

    if (ids.length === 0) {
      progressPct = 0;
    } else {
      const remainings = await Promise.all(ids.map((id) => calculateLoanRemaining(id)));
      for (const r of remainings) {
        totalJurosHoje += Number(r.minimumPayment ?? r.interestAmount ?? 0);
      }
      totalJurosHoje = Math.round((totalJurosHoje + Number.EPSILON) * 100) / 100;

      const CHUNK = 120;
      const paidLoanIdSet = new Set<string>();
      for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = ids.slice(i, i + CHUNK);
        const { data: pays, error: pErr } = await supabase
          .from("payments")
          .select("loan_id, payment_type")
          .eq("payment_date", todayYmd)
          .in("loan_id", batch);
        if (pErr) throw pErr;
        for (const row of pays || []) {
          const r = row as { loan_id?: unknown; payment_type?: unknown };
          if (String(r.payment_type || "") === "loan_renewal") continue;
          const lid = String(r.loan_id || "");
          if (lid) paidLoanIdSet.add(lid);
        }
      }
      paidLoansToday = paidLoanIdSet.size;
      progressPct = Math.min(100, Math.round((paidLoansToday / ids.length) * 100));
    }
  } catch (e) {
    console.warn("[login] resumo do dia:", e);
    totalJurosHoje = 0;
    qtdEmprestimos = 0;
    progressPct = 0;
    paidLoansToday = 0;
  }

  const bar = progressBarText(progressPct);

  return (
    `✅ *CRED CARD — Acesso confirmado*\n\n` +
    `Segue informações do dia de hoje (*${todayLabel}*):\n\n` +
    `*Valor total a receber:* ${fmtBrl(totalJurosHoje)}\n\n` +
    `*Empréstimos que vencem hoje:* ${qtdEmprestimos}\n\n` +
    `🚧 *Status de pagamentos*\n\n` +
    `${bar}\n` +
    `(${paidLoansToday}/${qtdEmprestimos} pagos hoje)`
  );
}

function supabaseUserError(error: { message?: string; code?: string }): string {
  const msg = String(error.message || "");
  if (error.code === "42703" || msg.includes("phone")) {
    return "Banco sem coluna phone. Execute a migração 20260625130000_imperatriz_whatsapp_token_login.sql no Supabase.";
  }
  if (error.code === "PGRST205" || msg.includes("login_tokens")) {
    return "Tabela login_tokens ausente. Execute a migração de login no Supabase.";
  }
  return msg ? `Erro ao buscar usuário: ${msg}` : "Erro ao buscar usuário";
}

function formatWhatsappSendError(raw: string | undefined): string {
  const text = String(raw || "").trim();
  if (!text) return `Falha ao enviar token no WhatsApp (instância ${LOGIN_EVOLUTION_INSTANCE})`;
  try {
    const parsed = JSON.parse(text) as { message?: string | string[]; error?: string };
    const m = parsed.message;
    if (Array.isArray(m)) return m.join(" — ");
    if (typeof m === "string" && m.trim()) return m;
    if (parsed.error) return String(parsed.error);
  } catch {
    // texto puro da API
  }
  if (text.length > 180) return `${text.slice(0, 180)}…`;
  return text;
}

export async function requestWhatsappLoginToken(companyId: string, email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  setSupabaseCompany(companyId as CompanyId);
  const normEmail = normalizeEmail(email);
  if (!normEmail) return { ok: false, error: "Informe o email" };

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, role, is_active, phone")
    .eq("email", normEmail)
    .maybeSingle();
  if (error) return { ok: false, error: supabaseUserError(error) };
  if (!data) return { ok: false, error: "Usuário não encontrado. Use o e-mail cadastrado no sistema (ex.: admin@credcard.com)." };
  if ((data as any).is_active === false) return { ok: false, error: "Usuário inativo" };

  const phone = String((data as any).phone || "").trim();
  if (!phone) {
    return {
      ok: false,
      error: `Usuário sem telefone cadastrado (${normEmail}). Cadastre o WhatsApp na tabela users.phone.`,
    };
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(`${normEmail}:${token}`);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60_000).toISOString();

  // Invalida tokens anteriores desse email
  await supabase
    .from("login_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("email", normEmail)
    .is("used_at", null);

  const { error: insErr } = await supabase
    .from("login_tokens")
    .insert([{ email: normEmail, token_hash: tokenHash, expires_at: expiresAt }]);
  if (insErr) return { ok: false, error: "Erro ao gerar token" };

  const msg =
    `🔐 *CRED CARD — Token de acesso*\n\n` +
    `*CÓDIGO DE ACESSO:*\n\n` +
    `${token}\n\n` +
    `⏳ Validade: *${TOKEN_TTL_MIN} minutos*\n` +
    `🚫 Não compartilhe este código.\n\n` +
    `✅ Se você não solicitou, ignore esta mensagem.`;

  const send = await sendWhatsAppTextWithInstance(phone, msg, {
    instance: LOGIN_EVOLUTION_INSTANCE,
    apiKey: getApiKeyForEvolutionInstance(LOGIN_EVOLUTION_INSTANCE),
    baseUrl: FIXED_EVOLUTION_BASE_URL,
  });
  if (!send.ok) {
    return {
      ok: false,
      error: formatWhatsappSendError(send.error) || `Falha ao enviar token no WhatsApp (verifique se ${LOGIN_EVOLUTION_INSTANCE} está conectada)`,
    };
  }

  return { ok: true };
}

export async function verifyWhatsappLoginToken(
  companyId: string,
  email: string,
  token: string
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  setSupabaseCompany(companyId as CompanyId);
  const normEmail = normalizeEmail(email);
  const tok = String(token || "").trim();
  if (!normEmail) return { ok: false, error: "Informe o email" };
  if (!tok) return { ok: false, error: "Informe o token" };

  const tokenHash = await sha256Hex(`${normEmail}:${tok}`);

  const { data: rows, error } = await supabase
    .from("login_tokens")
    .select("id, expires_at, used_at, token_hash")
    .eq("email", normEmail)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return { ok: false, error: "Erro ao validar token" };
  const row = (rows || [])[0] as any;
  if (!row) return { ok: false, error: "Token expirado ou inexistente. Solicite um novo." };
  if (String(row.token_hash) !== tokenHash) return { ok: false, error: "Token inválido" };

  const exp = new Date(String(row.expires_at)).getTime();
  if (!exp || Date.now() > exp) return { ok: false, error: "Token expirado. Solicite um novo." };

  // Marca token como usado
  await supabase.from("login_tokens").update({ used_at: new Date().toISOString() }).eq("id", row.id);

  const { data: u, error: uErr } = await supabase
    .from("users")
    .select("id, full_name, email, role, is_active, phone")
    .eq("email", normEmail)
    .maybeSingle();
  if (uErr || !u) return { ok: false, error: "Usuário inválido" };
  if ((u as any).is_active === false) return { ok: false, error: "Usuário inativo" };

  const user: User = {
    id: String((u as any).id),
    full_name: String((u as any).full_name || ""),
    email: String((u as any).email || normEmail),
    role: String((u as any).role || "user"),
  };

  await supabase.from("users").update({ last_login: new Date().toISOString() }).eq("id", user.id);

  const phone = String((u as any).phone || "").trim();
  if (phone) {
    const confirmMsg = await buildLoginConfirmedDailySummaryMessage();
    const sendConfirm = await sendWhatsAppTextWithInstance(phone, confirmMsg, {
      instance: LOGIN_EVOLUTION_INSTANCE,
      apiKey: getApiKeyForEvolutionInstance(LOGIN_EVOLUTION_INSTANCE),
      baseUrl: FIXED_EVOLUTION_BASE_URL,
    });
    if (!sendConfirm.ok) {
      console.warn("[login] Falha ao enviar WhatsApp de confirmação:", sendConfirm.error);
    }
  }

  return { ok: true, user };
}

