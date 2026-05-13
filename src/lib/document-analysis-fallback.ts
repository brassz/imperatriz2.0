import type { DocumentAnalysisResult } from "@/types/document-analysis";

type FieldDescriptor = {
  key: string;
  label: string;
  patterns: RegExp[];
};

function foldText(input: string) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function uniqueFields(fields: DocumentAnalysisResult["extractedFields"]) {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const token = `${field.key}:${field.value}`.toLowerCase();
    if (seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function normalizeValue(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function detectDocumentType(fileName: string, text: string): string {
  const source = `${fileName}\n${text}`;
  const folded = foldText(source);
  if (/carteira nacional de habilitacao|\bcnh\b|renach|permissao para dirigir/.test(folded)) return "CNH";
  if (/carteira de trabalho|\bctps\b|pis\/pasep|qualificacao civil/.test(folded)) return "Carteira de Trabalho";
  if (/holerite|contracheque|demonstrativo de pagamento|recibo de pagamento de salario/.test(folded)) return "Holerite";
  if (/comprovante de endereco|conta de luz|energia eletrica|agua e esgoto|telefone|internet|fatura/.test(folded)) {
    return "Comprovante de Endereço";
  }
  if (/comprovante de renda|extrato bancario|declaracao de rendimentos/.test(folded)) return "Comprovante de Renda";
  if (/registro geral|carteira de identidade|secretaria da seguranca|instituto de identificacao|\brg\b/.test(folded)) {
    return "RG";
  }
  return text.length > 0 ? "Documento" : (fileName.toLowerCase().endsWith(".pdf") ? "PDF" : "Documento de imagem");
}

function extractByPatterns(text: string, descriptors: FieldDescriptor[]) {
  const extracted = descriptors
    .map((descriptor) => {
      for (const pattern of descriptor.patterns) {
        const match = text.match(pattern);
        const value = normalizeValue(String(match?.[1] || match?.[0] || ""));
        if (value) {
          return {
            key: descriptor.key,
            label: descriptor.label,
            value,
          };
        }
      }
      return null;
    })
    .filter((item): item is DocumentAnalysisResult["extractedFields"][number] => item !== null);

  return uniqueFields(extracted);
}

function buildDescriptors(documentType: string): FieldDescriptor[] {
  const common: FieldDescriptor[] = [
    {
      key: "nome",
      label: "Nome",
      patterns: [
        /(?:^|\n)\s*nome(?: do titular| do trabalhador| do empregado| do cliente)?\s*[:\-]?\s*([^\n]+)/i,
        /(?:^|\n)\s*name\s*[:\-]?\s*([^\n]+)/i,
      ],
    },
    {
      key: "cpf",
      label: "CPF",
      patterns: [
        /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/,
        /(?:^|\n)\s*cpf\s*[:\-]?\s*([^\n]+)/i,
      ],
    },
    {
      key: "data_nascimento",
      label: "Data de nascimento",
      patterns: [
        /(?:data de nascimento|nascimento|dt\.?\s*nasc\.?)\s*[:\-]?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i,
      ],
    },
  ];

  const byType: Record<string, FieldDescriptor[]> = {
    CNH: [
      {
        key: "registro_cnh",
        label: "Registro CNH",
        patterns: [/registro\s*[:\-]?\s*([\d]{5,})/i, /n[ºo]?\s*registro\s*[:\-]?\s*([\d]{5,})/i],
      },
      {
        key: "validade",
        label: "Validade",
        patterns: [/validade\s*[:\-]?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i],
      },
      {
        key: "categoria",
        label: "Categoria",
        patterns: [/categoria\s*[:\-]?\s*([A-Z]+)/i],
      },
      {
        key: "primeira_habilitacao",
        label: "Primeira habilitação",
        patterns: [/1a habilitacao\s*[:\-]?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i, /primeira habilitacao\s*[:\-]?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i],
      },
      {
        key: "rg",
        label: "RG",
        patterns: [/(?:identidade|rg)\s*[:\-]?\s*([\d.\-xX]+)/i],
      },
    ],
    RG: [
      {
        key: "rg",
        label: "RG",
        patterns: [/(?:registro geral|carteira de identidade|identidade|rg)\s*[:\-]?\s*([\d.\-xX]+)/i],
      },
      {
        key: "orgao_emissor",
        label: "Órgão emissor",
        patterns: [/(?:orgao emissor|ssp|instituto de identificacao)\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "data_expedicao",
        label: "Data de expedição",
        patterns: [/(?:data de expedicao|expedicao|emissao)\s*[:\-]?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i],
      },
      {
        key: "filiacao",
        label: "Filiação",
        patterns: [/(?:filiacao|nome da mae)\s*[:\-]?\s*([^\n]+)/i],
      },
    ],
    "Carteira de Trabalho": [
      {
        key: "numero_ctps",
        label: "Número CTPS",
        patterns: [/(?:numero|n[ºo])\s*ctps\s*[:\-]?\s*([^\n]+)/i, /\bctps\b\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "serie_ctps",
        label: "Série",
        patterns: [/(?:serie)\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "pis_pasep",
        label: "PIS/PASEP",
        patterns: [/(?:pis\/pasep|pis|pasep)\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "empregador",
        label: "Empregador",
        patterns: [/(?:empregador|empresa|razao social)\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "cargo",
        label: "Cargo",
        patterns: [/(?:cargo|funcao)\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "admissao",
        label: "Admissão",
        patterns: [/(?:data de admissao|admissao)\s*[:\-]?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i],
      },
      {
        key: "remuneracao",
        label: "Remuneração",
        patterns: [/(?:remuneracao|salario contratual)\s*[:\-]?\s*(R\$\s?[\d.,]+)/i],
      },
    ],
    Holerite: [
      {
        key: "empresa",
        label: "Empresa",
        patterns: [/(?:empresa|empregador|razao social)\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "cnpj_empresa",
        label: "CNPJ empresa",
        patterns: [/\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/],
      },
      {
        key: "competencia",
        label: "Competência",
        patterns: [/(?:competencia|periodo|referencia)\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "cargo",
        label: "Cargo",
        patterns: [/(?:cargo|funcao)\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "salario_bruto",
        label: "Salário bruto",
        patterns: [/(?:salario bruto|vencimentos|total proventos)\s*[:\-]?\s*(R\$\s?[\d.,]+)/i],
      },
      {
        key: "salario_liquido",
        label: "Salário líquido",
        patterns: [/(?:liquido a receber|valor liquido|salario liquido)\s*[:\-]?\s*(R\$\s?[\d.,]+)/i],
      },
    ],
    "Comprovante de Endereço": [
      {
        key: "titular",
        label: "Titular",
        patterns: [/(?:cliente|titular|consumidor)\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "endereco",
        label: "Endereço",
        patterns: [
          /(?:endereco|logradouro)\s*[:\-]?\s*([^\n]+)/i,
          /\b((?:rua|avenida|av\.|travessa|alameda|rodovia)\s+[^\n,]+(?:,\s*\d+[^\n]*)?)/i,
        ],
      },
      {
        key: "bairro",
        label: "Bairro",
        patterns: [/(?:bairro)\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "cidade_uf",
        label: "Cidade/UF",
        patterns: [/(?:cidade|municipio)\s*[:\-]?\s*([^\n]+)/i, /\b([A-ZÀ-Ú\s]+\/[A-Z]{2})\b/],
      },
      {
        key: "cep",
        label: "CEP",
        patterns: [/\b(\d{5}-?\d{3})\b/],
      },
      {
        key: "competencia",
        label: "Competência",
        patterns: [/(?:competencia|referencia|vencimento|emissao)\s*[:\-]?\s*([^\n]+)/i],
      },
    ],
    "Comprovante de Renda": [
      {
        key: "renda",
        label: "Renda",
        patterns: [/(?:renda|rendimentos|salario|proventos)\s*[:\-]?\s*(R\$\s?[\d.,]+)/i],
      },
      {
        key: "fonte_pagadora",
        label: "Fonte pagadora",
        patterns: [/(?:empresa|fonte pagadora|empregador)\s*[:\-]?\s*([^\n]+)/i],
      },
      {
        key: "cnpj_empresa",
        label: "CNPJ empresa",
        patterns: [/\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/],
      },
      {
        key: "competencia",
        label: "Competência",
        patterns: [/(?:competencia|referencia|periodo)\s*[:\-]?\s*([^\n]+)/i],
      },
    ],
  };

  return [...common, ...(byType[documentType] || [])];
}

function buildRiskFlags(
  documentType: string,
  text: string,
  extractedFields: DocumentAnalysisResult["extractedFields"],
) {
  const riskFlags: DocumentAnalysisResult["riskFlags"] = [];
  const hasField = (key: string) => extractedFields.some((field) => field.key === key);

  if (text.length < 300) {
    riskFlags.push({
      title: "Pouco texto extraído",
      details: "O documento retornou pouco conteúdo textual. Revise a qualidade do arquivo.",
      severity: "high",
    });
  }

  if (!hasField("cpf")) {
    riskFlags.push({
      title: "CPF não localizado",
      details: "O OCR não identificou CPF de forma clara no documento.",
      severity: "medium",
    });
  }

  if (!hasField("nome")) {
    riskFlags.push({
      title: "Nome não localizado",
      details: "O OCR não identificou o nome completo de forma clara no documento.",
      severity: "medium",
    });
  }

  if (documentType === "CNH" && (!hasField("validade") || !hasField("categoria"))) {
    riskFlags.push({
      title: "CNH incompleta",
      details: "Validade e/ou categoria da CNH não foram identificadas com segurança.",
      severity: "medium",
    });
  }

  if (documentType === "RG" && !hasField("rg")) {
    riskFlags.push({
      title: "RG incompleto",
      details: "Número do RG não foi localizado com segurança.",
      severity: "medium",
    });
  }

  if (documentType === "Carteira de Trabalho" && (!hasField("pis_pasep") || !hasField("empregador"))) {
    riskFlags.push({
      title: "CTPS com dados parciais",
      details: "PIS/PASEP e/ou empregador não foram identificados com clareza.",
      severity: "medium",
    });
  }

  if ((documentType === "Holerite" || documentType === "Comprovante de Renda") && !hasField("renda") && !hasField("salario_liquido")) {
    riskFlags.push({
      title: "Renda não localizada",
      details: "O documento não trouxe valor de renda líquido/bruto com segurança suficiente.",
      severity: "high",
    });
  }

  if (documentType === "Comprovante de Endereço" && (!hasField("endereco") || !hasField("cep"))) {
    riskFlags.push({
      title: "Endereço incompleto",
      details: "Logradouro e/ou CEP não foram identificados no comprovante.",
      severity: "high",
    });
  }

  return riskFlags;
}

function buildConsistencyNotes(
  documentType: string,
  extractedFields: DocumentAnalysisResult["extractedFields"],
  extraConsistencyNotes?: string[],
) {
  const notes = [...(extraConsistencyNotes || [])];
  if (extractedFields.length === 0) {
    notes.push("Nenhum campo importante foi extraído automaticamente do documento.");
  } else {
    notes.push(`${extractedFields.length} campo(s) importante(s) foram extraídos automaticamente do ${documentType}.`);
  }
  return notes;
}

export function buildFallbackDocumentAnalysis(input: {
  fileName: string;
  mimeType: string;
  documentText: string;
  extraConsistencyNotes?: string[];
}): DocumentAnalysisResult {
  const documentType = detectDocumentType(input.fileName, input.documentText);
  const extractedFields = extractByPatterns(input.documentText, buildDescriptors(documentType));
  const riskFlags = buildRiskFlags(documentType, input.documentText, extractedFields);
  const consistencyNotes = buildConsistencyNotes(documentType, extractedFields, input.extraConsistencyNotes);
  const keyPoints = extractedFields.map((field) => `${field.label}: ${field.value}`).slice(0, 8);

  return {
    success: true,
    fileName: input.fileName,
    mimeType: input.mimeType,
    source: "fallback",
    documentType,
    summary:
      input.documentText.length > 0
        ? `${documentType} identificado. O OCR local encontrou ${extractedFields.length} dado(s) importante(s) para triagem.`
        : "Não foi possível extrair texto útil do documento.",
    keyPoints,
    extractedFields,
    riskFlags,
    consistencyNotes,
    confidence: Math.max(20, Math.min(88, Math.round(input.documentText.length / 28) + Math.min(20, extractedFields.length * 3))),
    extractedTextPreview: input.documentText.slice(0, 1600),
  };
}
