import type { jsPDF } from "jspdf";
import { PDF_BRAND } from "./pdf-branding";

export { PDF_BRAND };

const PAGE_WIDTH = 210;
const MARGIN = 14;
const HEADER_HEIGHT = 38;
const FOOTER_HEIGHT = 15;
const CONTENT_TOP = 48;

function pdfBrandsAreDistinct(): boolean {
  return (
    String(PDF_BRAND.companyName).trim().toLowerCase() !==
    String(PDF_BRAND.companyDisplayName).trim().toLowerCase()
  );
}

export function addPdfHeader(
  doc: jsPDF,
  title: string,
  subtitle?: string,
  brand?: { companyName?: string; companyDisplayName?: string }
): number {
  const c = PDF_BRAND.colors;
  const companyName = String(brand?.companyName ?? PDF_BRAND.companyName);
  const companyDisplayName = String(brand?.companyDisplayName ?? PDF_BRAND.companyDisplayName);
  const twoLines =
    companyName.trim().toLowerCase() !== companyDisplayName.trim().toLowerCase();

  // Barra superior colorida
  doc.setFillColor(c.primary.r, c.primary.g, c.primary.b);
  doc.rect(0, 0, PAGE_WIDTH, 10, "F");

  // Nome da empresa (acima da barra, em branco sobre a barra)
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(companyName, PAGE_WIDTH / 2, 7, { align: "center" });

  // Segunda linha só se razão social ≠ nome comercial (evita repetir FRANCACRED duas vezes)
  let titleY = 24;
  if (twoLines) {
    doc.setTextColor(c.primaryDark.r, c.primaryDark.g, c.primaryDark.b);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(companyDisplayName, PAGE_WIDTH / 2, 16, { align: "center" });
    titleY = 26;
  }

  // Título do documento
  doc.setTextColor(c.text.r, c.text.g, c.text.b);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(title, PAGE_WIDTH / 2, titleY, { align: "center" });

  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(c.textMuted.r, c.textMuted.g, c.textMuted.b);
    doc.text(subtitle, PAGE_WIDTH / 2, titleY + 8, { align: "center" });
  }

  // Linha separadora
  doc.setDrawColor(c.line.r, c.line.g, c.line.b);
  doc.line(MARGIN, HEADER_HEIGHT, PAGE_WIDTH - MARGIN, HEADER_HEIGHT);

  return CONTENT_TOP;
}

export function addPdfFooter(
  doc: jsPDF,
  pageNum?: number,
  totalPages?: number,
  brand?: { companyName?: string; companyDisplayName?: string }
): void {
  const c = PDF_BRAND.colors;
  const pageHeight = 297;
  const footerY = pageHeight - 10;

  doc.setDrawColor(c.line.r, c.line.g, c.line.b);
  doc.line(MARGIN, footerY - 6, PAGE_WIDTH - MARGIN, footerY - 6);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(c.textMuted.r, c.textMuted.g, c.textMuted.b);

  const today = new Date().toLocaleDateString("pt-BR");
  const companyName = String(brand?.companyName ?? PDF_BRAND.companyName);
  const companyDisplayName = String(brand?.companyDisplayName ?? PDF_BRAND.companyDisplayName);
  const footerBrand =
    companyName.trim().toLowerCase() !== companyDisplayName.trim().toLowerCase()
      ? `${companyDisplayName} | ${companyName}`
      : companyDisplayName;
  let footerText = `${footerBrand} | Gerado em ${today}`;
  if (pageNum !== undefined && totalPages !== undefined && totalPages > 1) {
    footerText += ` | Página ${pageNum}/${totalPages}`;
  } else if (pageNum !== undefined) {
    footerText += ` | Página ${pageNum}`;
  }

  doc.text(footerText, PAGE_WIDTH / 2, footerY, { align: "center" });
}

export function getPdfMargin(): number {
  return MARGIN;
}

export function getPdfContentTop(): number {
  return CONTENT_TOP;
}

export function getPdfFooterY(): number {
  return 297 - FOOTER_HEIGHT;
}

export function formatCurrency(n: number): string {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDateBR(s: string): string {
  if (!s) return "—";
  const [y, m, d] = String(s).split("T")[0].split("-");
  return `${d}/${m}/${y}`;
}
