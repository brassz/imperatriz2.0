import { PDF_BRAND } from "./pdf-branding";

export const CAPITAL_ADVOCACIA_NAME = "Capital Advocacia";
export const CAPITAL_ADVOCACIA_EMAIL = "capitaladvogadoseassociados@gmail.com";

export type AdvocaciaPixInfo = {
  tipo: string;
  titular: string;
  chave: string;
};

function formatDateBr(s: string) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function getCreditorCompanyName(): string {
  return PDF_BRAND.companyDisplayName || "CRED CARD - IMPERATRIZ";
}

export type AdvocaciaMessageParams = {
  clientName: string;
  amount: number;
  dueDate: string;
  creditorName?: string;
  contactWhatsApp: string;
};

/** Mensagem curta formal enviada antes do PDF extrajudicial. */
export function buildAdvocaciaWhatsAppMessage(p: AdvocaciaMessageParams): string {
  const credor = p.creditorName?.trim() || getCreditorCompanyName();
  const nome = p.clientName.trim() || "Cliente";
  const valor = formatCurrency(p.amount);
  const venc = formatDateBr(p.dueDate);
  const contato = p.contactWhatsApp.trim() || "(informar contato)";

  return `Prezado(a) Sr(a). ${nome},

Consta em nossos registros débito pendente junto à ${credor}, no valor de ${valor}, vencido em ${venc}.

Concedemos o prazo improrrogável de 48 horas para manifestação e regularização da pendência.

A ausência de pagamento ou contato dentro do prazo poderá resultar na adoção das medidas legais cabíveis para recuperação do crédito, incluindo ajuizamento de ação de cobrança, protesto e demais providências permitidas pela legislação.

Caso tenha interesse em *renegociar a dívida*, responda esta mensagem informando sua disponibilidade para acordo.

Para negociação imediata, entre em contato pelo WhatsApp ${contato}.

${CAPITAL_ADVOCACIA_NAME}
Departamento de Recuperação de Crédito.`;
}

export type ProtestWarningMessageParams = {
  clientName: string;
  creditorName?: string;
  contactWhatsApp: string;
  deadline: string;
};

/** Aviso de protesto para clientes que ainda não entraram em contato. */
export function buildProtestWarningWhatsAppMessage(p: ProtestWarningMessageParams): string {
  const credor = p.creditorName?.trim() || getCreditorCompanyName();
  const nome = p.clientName.trim() || "Cliente";
  const contato = p.contactWhatsApp.trim() || "(informar contato)";
  const prazo = p.deadline.trim() || "(informar data)";

  return `Prezado(a) Sr(a). ${nome},

A *${CAPITAL_ADVOCACIA_NAME}*, em nome de ${credor}, informa que, caso *não haja manifestação ou contato* até o dia *${prazo}*, será dada entrada no *protesto* do débito, juntamente ao *Cartório de São Paulo*.

Caso tenha interesse em *regularizar ou renegociar* a pendência, responda esta mensagem ou entre em contato pelo WhatsApp *${contato}* antes do prazo informado.

${CAPITAL_ADVOCACIA_NAME}
Departamento de Renegociação.`;
}
