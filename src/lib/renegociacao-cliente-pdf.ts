import { jsPDF } from "jspdf";
import type { AdvocaciaOverdueLoan } from "@/api/advocacia";
import { getCreditorCompanyName } from "@/lib/advocacia-messages";
import { addPdfFooter, formatCurrency, formatDateBR, getPdfMargin } from "./pdf-utils";

export type RenegociacaoClientePdfClient = {
  name?: string;
  cpf?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  rg?: string | null;
};

export type RenegociacaoClientePdfParams = {
  item: AdvocaciaOverdueLoan;
  client?: RenegociacaoClientePdfClient | null;
  creditorName?: string;
};

function wrapParagraph(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight = 5.5): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  for (const line of lines) {
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

function rowLabelValue(doc: jsPDF, label: string, value: string, x: number, y: number, maxW: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  return wrapParagraph(doc, value, x + 62, y - 4.5, maxW - 62);
}

export function generateRenegociacaoClientePdf(params: RenegociacaoClientePdfParams): jsPDF {
  const { item } = params;
  const client = params.client || {};
  const creditor = params.creditorName || getCreditorCompanyName();
  const doc = new jsPDF();
  const m = getPdfMargin();
  const maxW = 182;
  let y = 22;

  const clientName = String(client.name || item.loan.client_name || "—");
  const debtType = item.source === "installment" ? "Parcelamento" : "Empréstimo";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("FICHA DO CLIENTE — RENEGOCIAÇÃO", m, y);
  y += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Credor: ${creditor} · Emitido em ${formatDateBR(new Date().toISOString())}`, m, y);
  y += 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Dados do cliente", m, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  y = rowLabelValue(doc, "Nome:", clientName, m, y, maxW) + 3;
  y = rowLabelValue(doc, "CPF:", String(client.cpf || "—"), m, y, maxW) + 3;
  y = rowLabelValue(doc, "RG:", String(client.rg || "—"), m, y, maxW) + 3;
  y = rowLabelValue(doc, "Telefone:", String(client.phone || item.loan.client_phone || "—"), m, y, maxW) + 3;
  y = rowLabelValue(doc, "E-mail:", String(client.email || "—"), m, y, maxW) + 3;
  y = rowLabelValue(doc, "Endereço:", String(client.address || "—"), m, y, maxW) + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Situação da dívida", m, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  y = rowLabelValue(doc, "Tipo:", debtType, m, y, maxW) + 3;
  y = rowLabelValue(doc, "Vencimento:", formatDateBR(item.loan.due_date), m, y, maxW) + 3;
  y = rowLabelValue(doc, "Dias em atraso:", String(item.days_overdue), m, y, maxW) + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Valores", m, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const totalFinesOpen = item.loan.fine;
  const totalPaid = item.details.total_paid;
  const amountOwed = item.loan.amount;

  y = rowLabelValue(doc, "Valor devido:", formatCurrency(amountOwed), m, y, maxW) + 3;
  y = rowLabelValue(doc, "Total em multas:", formatCurrency(totalFinesOpen), m, y, maxW) + 3;
  y = rowLabelValue(doc, "Total pago:", formatCurrency(totalPaid), m, y, maxW) + 3;

  if (item.source === "loan") {
    const d = item.details;
    y = rowLabelValue(doc, "Capital restante:", formatCurrency(d.capital_remaining ?? 0), m, y, maxW) + 3;
    y = rowLabelValue(doc, "Aluguel restante:", formatCurrency(d.interest_remaining ?? 0), m, y, maxW) + 3;
    if ((d.fines_paid ?? 0) > 0) {
      y = rowLabelValue(doc, "Multas pagas:", formatCurrency(d.fines_paid ?? 0), m, y, maxW) + 3;
    }
  } else {
    const d = item.details;
    y = rowLabelValue(doc, "Valor pendente:", formatCurrency(d.pending_amount ?? 0), m, y, maxW) + 3;
    y =
      rowLabelValue(
        doc,
        "Parcelas:",
        `${d.paid_installments ?? 0} pagas / ${d.total_installments ?? 0} total`,
        m,
        y,
        maxW,
      ) + 3;
  }

  y += 4;
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  y = wrapParagraph(
    doc,
    "Documento informativo para análise de renegociação. O valor devido inclui capital, aluguel e multas em aberto conforme apuração do sistema.",
    m,
    y,
    maxW,
  );
  doc.setTextColor(0, 0, 0);

  addPdfFooter(doc);
  return doc;
}

export function safeRenegociacaoClienteFileName(clientName: string): string {
  return String(clientName || "cliente")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
