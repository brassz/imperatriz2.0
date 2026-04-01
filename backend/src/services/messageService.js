import { getEnv } from "../lib/env.js";

/**
 * Textos alinhados a `src/lib/whatsapp-messages.ts` (cobrança / lembrete),
 * com os mesmos emojis dos templates do app.
 */

const BRAND_BY_COMPANY = {
  franca: "Franca Cred",
  litoral: "Litoral",
  mogiana: "Mogiana",
  imperatriz: "Imperatriz",
  all: "NEXUS",
};

function formatMoneyBRL(value) {
  const n = Number(value || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateBR(dueYmd) {
  if (!dueYmd) return "";
  const [y, m, d] = String(dueYmd).split("-");
  return `${d}/${m}/${y}`;
}

function companyTitle(loan) {
  const k = String(loan?.companyKey || "franca").toLowerCase();
  return BRAND_BY_COMPANY[k] || BRAND_BY_COMPANY.franca;
}

function pixBlockCobranca(env) {
  const tipo = env.PIX_BANK || "PIX";
  const titular = env.PIX_HOLDER || "NOVIXCRED";
  const chave = env.PIX_KEY || "";
  const lines = [`💳 PIX – ${tipo}`, `Titular: ${titular}`];
  if (chave) lines.push(`Chave: ${chave}`);
  return lines.join("\n");
}

function pixBlockLembrete(env) {
  const tipo = env.PIX_BANK || "PIX";
  const titular = env.PIX_HOLDER || "NOVIXCRED";
  const chave = env.PIX_KEY || "";
  return [
    "💳 PIX",
    `* Banco: ${tipo}`,
    `* Titular: ${titular}`,
    chave ? `* Chave: ${chave}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function loanAmounts(loan) {
  const original = Number(loan?.original_amount ?? 0);
  const total = Number(loan?.total_amount ?? 0);
  const interest = Math.max(0, total - original);
  const fine = Number(loan?.fine_amount ?? loan?.fine ?? 0);
  const totalDue = Number(loan?.totalDue ?? total + fine);
  return { original, total, interest, fine, totalDue };
}

export function buildMessage({ messageType, loan }) {
  const env = getEnv();
  const finePerDay = env.FINE_PER_DAY ?? 50;
  const title = companyTitle(loan);
  const clientName = loan?.client?.name || "Cliente";
  const due = formatDateBR(loan?.due_date_local || "");
  const { original, total, interest, fine, totalDue } = loanAmounts(loan);
  const minimumPayment = interest;

  if (messageType === "remarketing") {
    return (
      "📣 Olá. Temos condições especiais para novos empréstimos.\n\n" +
      "Se tiver interesse, responda esta mensagem e te atendemos."
    );
  }

  if (messageType === "reminder") {
    return (
      `🔔 LEMBRETE – ${title}\n\n` +
      `Cliente: ${clientName}\n` +
      `📅 Vencimento: ${due} (amanhã)\n\n` +
      `💵 Valor total: ${formatMoneyBRL(totalDue)}\n` +
      `📊 Juros: ${formatMoneyBRL(interest)}\n` +
      `💳 Pagamento mínimo: ${formatMoneyBRL(minimumPayment)}\n\n` +
      pixBlockLembrete(env)
    );
  }

  if (messageType === "lembrete") {
    return (
      `🔔 LEMBRETE – ${title}\n\n` +
      `Cliente: ${clientName}\n` +
      `📅 Vencimento: ${due}\n\n` +
      `💵 Valor total: ${formatMoneyBRL(totalDue)}\n` +
      `📊 Juros: ${formatMoneyBRL(interest)}\n` +
      `💳 Pagamento mínimo: ${formatMoneyBRL(minimumPayment)}\n\n` +
      pixBlockLembrete(env)
    );
  }

  // cobranca (default): vencidos, parcelamentos, etc.
  return (
    `🔴 COBRANÇA – ${title}\n\n` +
    `📅 Venc.: ${due}\n` +
    `Cliente: ${clientName}\n` +
    `Valor: ${formatMoneyBRL(totalDue)} (Cap.: ${formatMoneyBRL(original)} • Juros: ${formatMoneyBRL(interest)} • Multa: ${formatMoneyBRL(fine)})\n\n` +
    pixBlockCobranca(env) +
    `\n\n⚠️ Após vencimento: multa diária ${formatMoneyBRL(finePerDay)}. Enviar comprovante (obrigatório se pago em outra titularidade).`
  );
}

