/**
 * PDF de comprovante de pagamento com marca d'água (anti-falsificação).
 */

import { jsPDF } from "jspdf";
import { PDF_BRAND } from "./pdf-branding";
import { addPdfFooter, addPdfHeader, formatCurrency, formatDateBR, getPdfMargin } from "./pdf-utils";

function drawDiagonalWatermark(doc: jsPDF) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "bold");
  doc.setTextColor(238, 238, 238);
  doc.setFontSize(24);
  const line = `${PDF_BRAND.companyName} · ${PDF_BRAND.branch} · ORIGINAL`;
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 6; col++) {
      doc.text(line, col * 48 - 15, 18 + row * 28, { angle: 32 });
    }
  }
  doc.setTextColor(PDF_BRAND.colors.text.r, PDF_BRAND.colors.text.g, PDF_BRAND.colors.text.b);
}

export type ComprovantePdfParams = {
  clientName: string;
  valorPago: number;
  proximoVencimento: string;
  paymentDate: string;
  paymentDescription?: string;
  loanId?: string;
  /** Score após o pagamento (opcional) */
  score?: number;
  scoreLabel?: string;
  companyTitle?: string;
};

/**
 * Gera o PDF (marca d'água + referência única). Desenha marca d'água antes do conteúdo legível.
 */
export function generateComprovantePagamentoPdf(params: ComprovantePdfParams): jsPDF {
  const doc = new jsPDF();
  drawDiagonalWatermark(doc);

  const m = getPdfMargin();
  let y = addPdfHeader(doc, "Comprovante de pagamento", "Documento gerado pelo sistema — não válido sem registro no sistema");

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  y += 6;

  const authRef = `${params.loanId ? String(params.loanId).slice(0, 8) : "—"}-${Date.now().toString(36).toUpperCase()}`;

  doc.setFont("helvetica", "bold");
  doc.text("Autenticação", m, y);
  doc.setFont("helvetica", "normal");
  y += 6;
  doc.setFontSize(9);
  doc.setTextColor(
    PDF_BRAND.colors.textMuted.r,
    PDF_BRAND.colors.textMuted.g,
    PDF_BRAND.colors.textMuted.b,
  );
  doc.text(`Ref.: ${authRef}`, m, y);
  doc.setTextColor(PDF_BRAND.colors.text.r, PDF_BRAND.colors.text.g, PDF_BRAND.colors.text.b);
  y += 10;

  doc.setFontSize(11);
  doc.text(`Cliente: ${params.clientName}`, m, y);
  y += 7;
  doc.text(`Valor recebido: ${formatCurrency(params.valorPago)}`, m, y);
  y += 7;
  doc.text(`Data do pagamento: ${formatDateBR(params.paymentDate)}`, m, y);
  y += 7;
  if (params.paymentDescription) {
    doc.text(`Operação: ${params.paymentDescription}`, m, y);
    y += 7;
  }
  doc.text(`Próximo vencimento: ${formatDateBR(params.proximoVencimento)}`, m, y);
  y += 10;

  if (params.score != null && params.scoreLabel) {
    const brand = (params.companyTitle || `${PDF_BRAND.companyName}`.trim() || "Empresa").slice(0, 80);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(PDF_BRAND.colors.text.r, PDF_BRAND.colors.text.g, PDF_BRAND.colors.text.b);
    doc.text(`Score com ${brand}: ${params.score}/100 (${params.scoreLabel})`, m, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(
      PDF_BRAND.colors.textMuted.r,
      PDF_BRAND.colors.textMuted.g,
      PDF_BRAND.colors.textMuted.b,
    );
    doc.text(
      "Pagamentos em dia e na data correta reforçam positivamente o score e auxiliam na aprovação de novos empréstimos.",
      m,
      y,
      { maxWidth: 180 },
    );
    y += 14;
    doc.setTextColor(PDF_BRAND.colors.text.r, PDF_BRAND.colors.text.g, PDF_BRAND.colors.text.b);
  } else {
    y += 2;
  }

  doc.setFontSize(9);
  doc.setTextColor(
    PDF_BRAND.colors.textMuted.r,
    PDF_BRAND.colors.textMuted.g,
    PDF_BRAND.colors.textMuted.b,
  );
  doc.text(
    "Este documento possui marca d'água de segurança. Cópias ou alterações fora do sistema podem ser inválidas.",
    m,
    y,
    { maxWidth: 180 },
  );

  addPdfFooter(doc, 1);
  return doc;
}

/** Base64 puro (sem prefixo data:) para Evolution API */
export function comprovantePdfToBase64(doc: jsPDF): string {
  const dataUri = doc.output("datauristring") as string;
  const i = dataUri.indexOf(",");
  return i >= 0 ? dataUri.slice(i + 1) : dataUri;
}
