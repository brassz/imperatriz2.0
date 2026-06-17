import { jsPDF } from "jspdf";
import { CAPITAL_ADVOCACIA_EMAIL, CAPITAL_ADVOCACIA_NAME } from "./advocacia-messages";
import type { RenegotiationCalcResult, RenegotiationMode } from "./renegotiation-calc";
import { renegotiationModeLabel } from "./renegotiation-calc";
import { addPdfFooter, formatCurrency, formatDateBR, getPdfMargin } from "./pdf-utils";

export type PropostaRenegociacaoParams = {
  clientName: string;
  creditorName: string;
  debtDescription: string;
  originalDueDate: string;
  calc: RenegotiationCalcResult;
  mode: RenegotiationMode;
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

function buildTerms(params: PropostaRenegociacaoParams): string[] {
  const { calc, mode } = params;
  const lines: string[] = [
    `Valor base (sem multas diárias): ${formatCurrency(calc.baseCapital)}`,
  ];

  if (mode === "avista_desconto") {
    lines.push(`Desconto aplicado: ${calc.discountPercent}%`);
    lines.push(`Valor para quitação à vista: ${formatCurrency(calc.totalAmount)}`);
  } else if (mode === "avista") {
    lines.push(`Valor para quitação à vista: ${formatCurrency(calc.totalAmount)}`);
  } else if (mode === "parcelado_entrada") {
    lines.push(`Entrada: ${formatCurrency(calc.downPayment)}`);
    lines.push(`Saldo parcelado: ${calc.installmentCount}x de ${formatCurrency(calc.installmentAmount)}`);
    lines.push(`Total do acordo: ${formatCurrency(calc.totalAmount)}`);
  } else {
    lines.push(`Parcelamento: ${calc.installmentCount}x de ${formatCurrency(calc.installmentAmount)}`);
    lines.push(`Total do acordo: ${formatCurrency(calc.totalAmount)}`);
  }

  lines.push("As multas diárias de atraso foram dispensadas nesta proposta, conforme negociação.");
  return lines;
}

export function generatePropostaRenegociacaoPdf(params: PropostaRenegociacaoParams): jsPDF {
  const doc = new jsPDF();
  const m = getPdfMargin();
  const maxW = 182;
  let y = 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("PROPOSTA DE RENEGOCIAÇÃO", m, y);
  y += 6;
  doc.setFontSize(10);
  doc.text(CAPITAL_ADVOCACIA_NAME.toUpperCase(), m, y);
  y += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  y = wrapParagraph(doc, `Prezado(a) Sr(a). ${params.clientName},`, m, y, maxW);
  y += 4;

  y = wrapParagraph(
    doc,
    `A ${CAPITAL_ADVOCACIA_NAME}, em nome de ${params.creditorName}, apresenta proposta de renegociação referente a ${params.debtDescription}, com vencimento original em ${formatDateBR(params.originalDueDate)}.`,
    m,
    y,
    maxW,
  );
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text(`Modalidade: ${renegotiationModeLabel(params.mode)}`, m, y);
  y += 8;
  doc.setFont("helvetica", "normal");

  for (const line of buildTerms(params)) {
    y = wrapParagraph(doc, `• ${line}`, m, y, maxW);
    y += 2;
  }

  y += 4;
  y = wrapParagraph(
    doc,
    "Esta proposta tem validade de 48 horas a partir do recebimento. A aceitação deve ser confirmada por resposta neste WhatsApp ou pelos canais oficiais da Capital Advocacia.",
    m,
    y,
    maxW,
  );
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text("Contato para aceite:", m, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.text(`WhatsApp: ${params.contactPhone}`, m, y);
  y += 6;
  doc.text(`E-mail: ${params.contactEmail || CAPITAL_ADVOCACIA_EMAIL}`, m, y);
  y += 12;

  doc.text("Atenciosamente,", m, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.text(CAPITAL_ADVOCACIA_NAME.toUpperCase(), m, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Departamento de Renegociação e Recuperação de Crédito", m, y);

  addPdfFooter(doc, 1, undefined, {
    companyName: CAPITAL_ADVOCACIA_NAME,
    companyDisplayName: CAPITAL_ADVOCACIA_NAME,
  });

  return doc;
}

export function propostaRenegociacaoPdfToBase64(doc: jsPDF): string {
  const dataUri = doc.output("datauristring") as string;
  const i = dataUri.indexOf(",");
  return i >= 0 ? dataUri.slice(i + 1) : dataUri;
}
