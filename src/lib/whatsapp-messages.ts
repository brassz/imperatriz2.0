/**
 * Templates de mensagens WhatsApp para cobrança e lembrete.
 * Compatível com cada empresa (nome + PIX da empresa).
 */

import { PDF_BRAND } from "./pdf-branding";

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

function getCompanyTitle() {
  const name = (PDF_BRAND.companyName || "").trim();
  const branch = (PDF_BRAND.branch || "").trim();
  if (name) return name;
  if (branch) return branch;
  return "Franca Cred";
}

/** Mensagem de COBRANÇA (vencidos e vence hoje) */
export function buildCobrancaMessage(
  loan: LoanForMessage,
  pix: PixInfo,
  multaDiaria = 50
): string {
  const title = getCompanyTitle();
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

/** Mensagem de LEMBRETE (vence hoje) */
export function buildLembreteHojeMessage(loan: LoanForMessage, pix: PixInfo): string {
  const title = getCompanyTitle();
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

/** Mensagem de COMPROVANTE após registro de pagamento */
export function buildComprovanteMessage(
  clientName: string,
  valorPago: number,
  proximoVencimento: string
): string {
  const title = getCompanyTitle();
  const valor = formatCurrency(valorPago);
  const venc = formatDateBr(proximoVencimento);

  return `✅ COMPROVANTE – ${title}

Cliente: ${clientName}
Pagamento recebido: ${valor}

📅 Próximo vencimento: ${venc}`;
}

/** Mensagem de LEMBRETE (1 dia antes - vence amanhã) */
export function buildLembreteMessage(
  loan: LoanForMessage,
  pix: PixInfo
): string {
  const title = getCompanyTitle();
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
