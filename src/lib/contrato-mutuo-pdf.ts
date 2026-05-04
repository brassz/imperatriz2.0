import { jsPDF } from "jspdf";
import { formatCurrency, formatDateBR } from "@/lib/pdf-utils";

export type ContratoMutuoMutuario = {
  name: string;
  cpf?: string;
  rg?: string;
  address?: string;
};

export type ContratoMutuoAvalista = {
  name: string;
  cpf?: string;
  rg?: string;
  address?: string;
};

export type ContratoMutuoParams = {
  mutuario: ContratoMutuoMutuario;
  avalista?: ContratoMutuoAvalista | null;
  valorEmprestado: number;
  vencimento: string; // YYYY-MM-DD
  multaPercent: number;
  cidadeUf: string;
  dataAssinatura: string; // YYYY-MM-DD
};

const MUTUANTE = {
  nome: "VALORUM",
  cnpj: "52.496.899/0001-89",
  endereco: "AV Presidente Vargas 700, Franca/SP.",
};

/** Juros ao mês exibidos no texto do contrato PDF (valor fixo do instrumento). */
const JUROS_CONTRATO_PDF_PERCENT = 1;

function safeLine(s: unknown, fallback = "—"): string {
  const v = String(s ?? "").trim();
  return v ? v : fallback;
}

function ymd(s: string): string {
  return String(s || "").split("T")[0];
}

function addLines(doc: jsPDF, lines: string[], x: number, y: number, lineH = 5): number {
  for (const line of lines) {
    doc.text(line, x, y);
    y += lineH;
  }
  return y;
}

export function generateContratoMutuoPdf(params: ContratoMutuoParams): jsPDF {
  const doc = new jsPDF();
  const m = 14;
  const pageW = 210;
  const pageH = 297;
  const bottom = pageH - 18;
  const lineH = 5;

  const mutuario = params.mutuario;
  const avalista = params.avalista ?? null;

  const mutuarioAddr = safeLine(mutuario.address, "Endereço não informado");
  const avalistaAddr = safeLine(avalista?.address, "Endereço não informado");

  const valor = formatCurrency(params.valorEmprestado);
  const venc = formatDateBR(ymd(params.vencimento));
  const dataAss = formatDateBR(ymd(params.dataAssinatura));

  let y = 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("CONTRATO DE MÚTUO", pageW / 2, y, { align: "center" });
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  // Importante: manter texto/linhas iguais ao modelo de referência.
  y = addLines(doc, ["Pelo presente instrumento particular, as partes abaixo qualificadas:"], m, y, lineH);
  y += 2;

  doc.setFont("helvetica", "bold");
  doc.text("MUTUANTE:", m, y);
  doc.setFont("helvetica", "normal");
  y += 6;
  y = addLines(
    doc,
    [
      `${MUTUANTE.nome}, pessoa jurídica de direito privado, inscrita no CNPJ sob nº ${MUTUANTE.cnpj}, com sede à`,
      `${MUTUANTE.endereco}`,
    ],
    m,
    y,
    lineH
  );
  y += 2;

  doc.setFont("helvetica", "bold");
  doc.text("MUTUÁRIO:", m, y);
  doc.setFont("helvetica", "normal");
  y += 6;
  // Mantém o texto do modelo (inclusive "residente e domiciliada à").
  // Para ficar idêntico, usamos quebras fixas; os valores mudam, mas a estrutura não.
  y = addLines(
    doc,
    [
      `${safeLine(mutuario.name)}, brasileiro, portador do CPF nº ${safeLine(mutuario.cpf, "—")}, RG nº ${safeLine(mutuario.rg, "—")}, residente e domiciliada à`,
      `${mutuarioAddr}.`,
    ],
    m,
    y,
    lineH
  );
  y += 2;

  if (avalista) {
    doc.setFont("helvetica", "bold");
    doc.text("AVALISTA:", m, y);
    doc.setFont("helvetica", "normal");
    y += 6;
    y = addLines(
      doc,
      [
        `${safeLine(avalista.name)}, brasileiro, portador do CPF nº ${safeLine(avalista.cpf, "—")}, RG nº ${safeLine(avalista.rg, "—")}, residente e domiciliado à`,
        `${avalistaAddr},`,
        "que neste ato assume a responsabilidade solidária pelo pagamento da dívida.",
      ],
      m,
      y,
      lineH
    );
    y += 2;
  }

  y = addLines(
    doc,
    ["Têm entre si justo e acordado o presente contrato de mútuo, que se regerá pelas seguintes cláusulas e", "condições:"],
    m,
    y,
    lineH
  );
  y += 4;

  const clauses: Array<{ type: "title" | "text"; lines: string[] }> = [
    { type: "title", lines: ["CLÁUSULA PRIMEIRA - DO OBJETO DO CONTRATO"] },
    {
      type: "text",
      lines: [
        "1.1. Pelo presente instrumento, o MUTUANTE empresta ao MUTUÁRIO, que aceita, a quantia de R$",
        `${valor.replace(/^R\$\s?/, "")}, que será utilizada conforme acordado entre as partes. O MUTUÁRIO declara ter recebido o valor`,
        "nesta data.",
      ],
    },
    { type: "title", lines: ["CLÁUSULA SEGUNDA - DO PRAZO E FORMA DE PAGAMENTO"] },
    {
      type: "text",
      lines: [
        `2.1. O valor do mútuo será devolvido em uma parcela única, com vencimento em ${venc}, podendo`,
        "ser renegociado por escrito. O pagamento deverá ser feito por transferência bancária ou outro meio",
        "acordado.",
      ],
    },
    { type: "title", lines: ["CLÁUSULA TERCEIRA - DOS ENCARGOS PELO EMPRÉSTIMO"] },
    {
      type: "text",
      lines: [
        `3.1. O mútuo será acrescido de juros de ${JUROS_CONTRATO_PDF_PERCENT}% ao mês e multa de ${params.multaPercent}% sobre o valor da parcela vencida,`,
        "além de correção monetária pelo IGPM/FGV.",
      ],
    },
    { type: "title", lines: ["CLÁUSULA QUARTA - DA CONFISSÃO DE DÍVIDA"] },
    {
      type: "text",
      lines: [
        "4.1. O MUTUÁRIO confessa que a dívida é líquida, certa e exigível, não podendo contestar sua existência",
        "ou valor. Em caso de inadimplemento, o MUTUANTE poderá exigir o pagamento imediato do saldo",
        "devedor, acrescido de encargos.",
      ],
    },
    { type: "title", lines: ["CLÁUSULA QUINTA - DA GARANTIA E DA EXECUÇÃO"] },
    {
      type: "text",
      lines: [
        "5.1. O contrato é título executivo extrajudicial, conforme artigo 784, III do CPC, podendo o MUTUANTE",
        "requerer judicialmente a penhora de bens do MUTUÁRIO em caso de inadimplência.",
      ],
    },
    { type: "title", lines: ["CLÁUSULA SEXTA - DA NOTIFICAÇÃO"] },
    {
      type: "text",
      lines: [
        "6.1. Em caso de inadimplemento, o MUTUANTE notificará o MUTUÁRIO por carta registrada ou e-mail,",
        "concedendo-lhe 10 dias para regularizar o pagamento.",
      ],
    },
    { type: "title", lines: ["CLÁUSULA SÉTIMA - DO FORO"] },
    { type: "text", lines: ["7.1. Fica eleito o foro da Comarca de Franca/SP para dirimir qualquer litígio decorrente deste contrato."] },
  ];

  for (const block of clauses) {
    if (y > bottom) {
      doc.addPage();
      y = 18;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
    }
    if (block.type === "title") {
      doc.setFont("helvetica", "bold");
      y = addLines(doc, block.lines, m, y, lineH);
      doc.setFont("helvetica", "normal");
    } else {
      y = addLines(doc, block.lines, m, y, lineH);
    }
    y += 2;
  }

  if (y > bottom - 30) {
    doc.addPage();
    y = 18;
  }

  y += 2;
  y = addLines(
    doc,
    [
      "E por estarem assim justos e contratados, firmam o presente instrumento em duas vias de igual teor e",
      "forma, para que produza seus jurídicos e legais efeitos.",
    ],
    m,
    y,
    lineH
  );
  y += 6;
  doc.text(`${params.cidadeUf}, ${dataAss}.`, m, y);
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.text("Assinaturas:", m, y);
  doc.setFont("helvetica", "normal");
  y += 8;

  // Blocos de assinatura (sem linhas para manter igual ao modelo simples)
  doc.text(MUTUANTE.nome, m, y);
  y += 5;
  doc.text("Mutuante", m, y);
  y += 8;

  doc.text(safeLine(mutuario.name), m, y);
  y += 5;
  doc.text("Mutuário", m, y);
  y += 8;

  if (avalista) {
    doc.text(safeLine(avalista.name), m, y);
    y += 5;
    doc.text("Avalista", m, y);
  }

  return doc;
}

