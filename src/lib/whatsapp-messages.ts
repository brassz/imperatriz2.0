/**
 * Templates de mensagens WhatsApp para cobrança e lembrete.
 * Compatível com cada empresa (nome + PIX da empresa).
 */

import { PDF_BRAND } from "./pdf-branding";
import { getSupabaseCompany } from "@/lib/supabase";

export type PixInfo = {
  tipo: string;
  titular: string;
  chave: string;
};

export type LoanForMessage = {
  client_name: string;
  client_phone: string;
  amount: number;
  capital: number;
  interest: number;
  fine: number;
  due_date: string;
  minimumPayment?: number;
};

function formatDateBr(s: string) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

function formatCurrency(n: number) {
  return "R$ " + n.toFixed(2).replace(".", ",");
}

/**
 * Nome da empresa nas mensagens (alinhado ao PDF / VITE_* / filial).
 * Mantém overrides por `company` no Supabase quando existirem.
 */
function getMessageBrandTitle(): string {
  const companyId = getSupabaseCompany();
  if (companyId === "empresa2") return "LITORALCRED";
  if (companyId === "empresa4") return "CREDCAR";
  return PDF_BRAND.companyDisplayName;
}

/** Mensagem de COBRANÇA (vencidos e vence hoje) */
export function buildCobrancaMessage(
  loan: LoanForMessage,
  pix: PixInfo,
  multaDiaria = 50
): string {
  const title = getMessageBrandTitle();
  const venc = formatDateBr(loan.due_date);
  const valor = formatCurrency(loan.amount);
  const cap = formatCurrency(loan.capital);
  const juros = formatCurrency(loan.interest);
  const multa = formatCurrency(loan.fine);

  return `🔴 COBRANÇA – ${title}

📅 Venc.: ${venc}
Cliente: ${loan.client_name}
Valor: ${valor} (Cap.: ${cap} • Aluguel: ${juros} • Multa: ${multa})

💳 PIX – ${pix.tipo}
Titular: ${pix.titular}
Chave: ${pix.chave}

⚠️ Após vencimento: multa diária R$ ${multaDiaria}. Enviar comprovante (obrigatório se pago em outra titularidade).`;
}

/**
 * Cobrança para parcelamento: valor da parcela (campo `capital` no modelo), sem linha de juros — só multa.
 */
export function buildCobrancaParcelamentoMessage(
  loan: LoanForMessage,
  pix: PixInfo,
  multaDiaria = 50,
): string {
  const title = getMessageBrandTitle();
  const venc = formatDateBr(loan.due_date);
  const valor = formatCurrency(loan.amount);
  const parcela = formatCurrency(loan.capital);
  const multa = formatCurrency(loan.fine);

  return `🔴 COBRANÇA – ${title}

📅 Venc.: ${venc}
Cliente: ${loan.client_name}
Valor: ${valor} (Parcela: ${parcela} • Multa: ${multa})

💳 PIX – ${pix.tipo}
Titular: ${pix.titular}
Chave: ${pix.chave}

⚠️ Após vencimento: multa diária R$ ${multaDiaria}. Enviar comprovante (obrigatório se pago em outra titularidade).`;
}

/** Mensagem de LEMBRETE (vence hoje) */
export function buildLembreteHojeMessage(loan: LoanForMessage, pix: PixInfo): string {
  const title = getMessageBrandTitle();
  const venc = formatDateBr(loan.due_date);
  const valor = formatCurrency(loan.amount);
  const juros = formatCurrency(loan.interest);
  const minimo = formatCurrency(loan.minimumPayment ?? loan.interest);

  return `🔔 LEMBRETE – ${title}

Cliente: ${loan.client_name}
📅 Vencimento: ${venc}

💵 Valor total: ${valor}
📊 Aluguel: ${juros}
💳 Pagamento mínimo: ${minimo}

💳 PIX
* Banco: ${pix.tipo}
* Titular: ${pix.titular}
* Chave: ${pix.chave}`;
}

export type ComprovanteScoreInfo = {
  score: number;
  label: string;
};

export type ComprovanteRemainingInfo = {
  totalRestante: number;
  capitalRestante: number;
  jurosRestante: number;
  pagamentoMinimo: number;
};

/**
 * Colinha / mensagem WhatsApp do comprovante de pagamento (modelo oficial).
 * Com score: inclui linha "Classificação" e textos sobre histórico e crédito.
 */
export function buildComprovanteMessage(
  clientName: string,
  valorPago: number,
  proximoVencimento: string,
  scoreInfo?: ComprovanteScoreInfo | null,
  opts?: { quitado?: boolean; remaining?: ComprovanteRemainingInfo | null } | null
): string {
  const title = getMessageBrandTitle().trim();
  const brandUpper = title.toUpperCase();
  const valor = formatCurrency(valorPago);
  const venc = formatDateBr(proximoVencimento);
  const quitado = Boolean(opts?.quitado);
  const remaining = opts?.remaining ?? null;

  let msg = `✅ Comprovante de Pagamento | ${brandUpper}

Cliente: ${clientName}
Valor recebido: ${valor}

${quitado ? "🏁 *QUITADO* — Parabéns! Seu empréstimo foi quitado com sucesso." : `📅 Próximo vencimento: ${venc}`}`;

  if (!quitado && remaining) {
    msg += `\n\n📌 *Saldo do empréstimo (atualizado)*\n` +
      `• 💰 Total restante: ${formatCurrency(remaining.totalRestante)}\n` +
      `• 💵 Capital restante: ${formatCurrency(remaining.capitalRestante)}\n` +
      `• 📈 Aluguel restante: ${formatCurrency(remaining.jurosRestante)}\n` +
      `• ⚡ Pagamento mínimo: ${formatCurrency(remaining.pagamentoMinimo)}`;
  }

  if (scoreInfo != null) {
    msg += `\n\n📊 Score ${brandUpper}: ${scoreInfo.score}/100 (Classificação: ${scoreInfo.label})`;
  }

  msg += quitado
    ? `\n\nParabéns pela quitação! Seu pagamento foi registrado em nosso sistema e o contrato foi encerrado com sucesso.\n` +
      `Se precisar de uma nova operação, fale com a equipe ${brandUpper}.`
    : `\n\nSeu pagamento foi processado com sucesso e registrado em nosso sistema.\n` +
      `Manter os pagamentos em dia contribui diretamente para a evolução do seu score, fortalecendo seu histórico financeiro e ampliando suas chances de aprovação em futuras operações de crédito com a ${brandUpper}.`;

  msg += `\n\n📎 Comprovante oficial disponível em PDF (documento autenticado com marca d'água)`;

  return msg;
}

export type LoanCreationNotifyParams = {
  clientName: string;
  capital: number;
  loanDate: string;
  dueDate: string;
  minimumPayment: number;
};

/**
 * WhatsApp curto ao criar empréstimo: valores essenciais e aviso genérico sobre cobrança em atraso (sem nomes de terceiros).
 */
export function buildLoanCreationNotificationMessage(p: LoanCreationNotifyParams): string {
  const title = getMessageBrandTitle().trim();
  const brandUpper = title.toUpperCase();
  const cap = formatCurrency(p.capital);
  const juros = formatCurrency(p.minimumPayment);
  const criacao = formatDateBr(p.loanDate);
  const vencimento = formatDateBr(p.dueDate);
  const firstName = p.clientName.trim().split(/\s+/)[0] || "Cliente";

  return `✅ *Empréstimo registrado* — ${brandUpper}

Olá, *${firstName}*!

• *Valor:* ${cap}
• *Valor do Aluguel:* ${juros}
• *Data de criação:* ${criacao}
• *Data de vencimento:* ${vencimento}

⚠️ Em caso de *atraso*, poderemos entrar em contato também com *avalista* e *contatos de emergência* eventualmente cadastrados.

_Equipe ${brandUpper}_`;
}

/** Mensagem de LEMBRETE (1 dia antes - vence amanhã) */
export function buildLembreteMessage(
  loan: LoanForMessage,
  pix: PixInfo
): string {
  return buildLembretePagamentoMessage(loan, pix, 1);
}

/** Lembrete de pagamento (data de vencimento sem texto relativo). */
export function buildLembretePagamentoMessage(
  loan: LoanForMessage,
  pix: PixInfo,
  _daysUntilDue = 1,
): string {
  const title = getMessageBrandTitle();
  const venc = formatDateBr(loan.due_date);
  const valor = formatCurrency(loan.amount);
  const juros = formatCurrency(loan.interest);
  const minimo = formatCurrency(loan.minimumPayment ?? loan.interest);

  const isParcel = loan.interest === 0 && loan.fine === 0 && loan.capital === loan.amount;

  if (isParcel) {
    return `🔔 LEMBRETE DE PAGAMENTO – ${title}

Cliente: ${loan.client_name}
📅 Vencimento da parcela: ${venc}

💵 Valor da parcela: ${valor}

💳 PIX
* Banco: ${pix.tipo}
* Titular: ${pix.titular}
* Chave: ${pix.chave}

Por favor, organize o pagamento até a data de vencimento.`;
  }

  return `🔔 LEMBRETE DE PAGAMENTO – ${title}

Cliente: ${loan.client_name}
📅 Vencimento: ${venc}

💵 Valor total: ${valor}
📊 Aluguel: ${juros}
💳 Pagamento mínimo: ${minimo}

💳 PIX
* Banco: ${pix.tipo}
* Titular: ${pix.titular}
* Chave: ${pix.chave}

Por favor, organize o pagamento até a data de vencimento.`;
}

/** Remarketing: cliente quitado — oferta taxa única por tempo limitado */
export function buildRemarketingRewardMessage(clientName: string, validHours = 12): string {
  const first = clientName.trim().split(/\s+/)[0] || "Cliente";
  const company = getMessageBrandTitle().toUpperCase();

  return `🌟 *${company} — PARABÉNS, ${first.toUpperCase()}!*

Você honrou *cada pagamento* do seu compromisso com a gente. Esse é o tipo de parceria que a gente *RESPEITA*.

🎁 *PRESENTE EXCLUSIVO* — válido por *${validHours}h*
Taxa *única* de contratação de empréstimo. Condição especial pra quem *já provou* que cumpre o combinado.

⏳ *O relógio tá contando.* Quem demora, perde.
Responda *agora* ou fale com a equipe *${company}* e *garanta* sua condição antes que expire.

*Obrigado por confiar na ${company}.* 🙏`;
}
