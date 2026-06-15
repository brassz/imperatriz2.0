import { jsPDF } from "jspdf";
import { CAPITAL_ADVOCACIA_EMAIL, CAPITAL_ADVOCACIA_NAME } from "./advocacia-messages";
import { addPdfFooter, formatCurrency, formatDateBR, getPdfMargin } from "./pdf-utils";

export type NotificacaoExtrajudicialParams = {
  clientName: string;
  creditorName: string;
  debtDescription: string;
  amount: number;
  dueDate: string;
  pix: { bank: string; holder: string; key: string };
  contactPhone: string;
  contactEmail?: string;
};

function wrapParagraph(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight = 5.5): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  for (const line of lines) {
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

export function generateNotificacaoExtrajudicialPdf(params: NotificacaoExtrajudicialParams): jsPDF {
  const doc = new jsPDF();
  const m = getPdfMargin();
  const maxW = 182;
  let y = 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("ASSUNTO: Notificação Extrajudicial para Regularização de Débito", m, y);
  y += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  y = wrapParagraph(
    doc,
    `Prezado(a) Sr(a). ${params.clientName},`,
    m,
    y,
    maxW,
  );
  y += 4;

  y = wrapParagraph(
    doc,
    `A ${CAPITAL_ADVOCACIA_NAME}, representante legal de ${params.creditorName}, vem por meio desta notificá-lo(a) acerca da existência de débito em aberto referente a ${params.debtDescription}, no valor atualizado de ${formatCurrency(params.amount)}, com vencimento em ${formatDateBR(params.dueDate)}.`,
    m,
    y,
    maxW,
  );
  y += 4;

  y = wrapParagraph(
    doc,
    "Até o presente momento, não identificamos a regularização da obrigação assumida, motivo pelo qual solicitamos que o pagamento seja efetuado no prazo de 05 (cinco) dias úteis contados do recebimento desta notificação.",
    m,
    y,
    maxW,
  );
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text("O pagamento poderá ser realizado através dos seguintes dados:", m, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.text(`PIX: ${params.pix.key}`, m, y);
  y += 6;
  doc.text(`Banco: ${params.pix.bank}`, m, y);
  y += 6;
  doc.text(`Favorecido: ${params.pix.holder}`, m, y);
  y += 8;

  y = wrapParagraph(
    doc,
    `Após a quitação, solicitamos o envio do comprovante para WhatsApp ${params.contactPhone} ou e-mail ${params.contactEmail || CAPITAL_ADVOCACIA_EMAIL}.`,
    m,
    y,
    maxW,
  );
  y += 4;

  y = wrapParagraph(
    doc,
    "Ressaltamos que a presente comunicação tem caráter amigável e visa proporcionar uma solução consensual para a pendência. O não pagamento dentro do prazo informado poderá ensejar a adoção das medidas judiciais cabíveis para recuperação do crédito, incluindo cobrança judicial, protesto do título, inclusão nos órgãos de proteção ao crédito e demais providências previstas na legislação vigente.",
    m,
    y,
    maxW,
  );
  y += 4;

  y = wrapParagraph(
    doc,
    "Permanecemos à disposição para negociação e eventual parcelamento do débito. Caso deseje renegociar a dívida, entre em contato pelos canais acima.",
    m,
    y,
    maxW,
  );
  y += 10;

  doc.text("Atenciosamente,", m, y);
  y += 10;
  doc.setFont("helvetica", "bold");
  doc.text(CAPITAL_ADVOCACIA_NAME.toUpperCase(), m, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Recuperação de Crédito e Cobrança Extrajudicial", m, y);
  y += 6;
  doc.text(`Telefone: ${params.contactPhone}`, m, y);
  y += 5;
  doc.text(`E-mail: ${params.contactEmail || CAPITAL_ADVOCACIA_EMAIL}`, m, y);

  addPdfFooter(doc, 1, undefined, {
    companyName: CAPITAL_ADVOCACIA_NAME,
    companyDisplayName: CAPITAL_ADVOCACIA_NAME,
  });

  return doc;
}

export function notificacaoPdfToBase64(doc: jsPDF): string {
  const dataUri = doc.output("datauristring") as string;
  const i = dataUri.indexOf(",");
  return i >= 0 ? dataUri.slice(i + 1) : dataUri;
}
