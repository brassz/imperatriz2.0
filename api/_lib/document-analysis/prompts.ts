export function buildDocumentAnalysisPrompt(input: {
  fileName: string;
  mimeType: string;
  documentText: string;
}) {
  return [
    "Você é um analista documental de uma financeira.",
    "Responda somente JSON válido.",
    "Analise o texto extraído de um documento e retorne um objeto com os campos:",
    "{",
    '  "documentType": "string",',
    '  "summary": "string curta e objetiva",',
    '  "keyPoints": ["string"],',
    '  "extractedFields": [{"key":"string","label":"string","value":"string"}],',
    '  "riskFlags": [{"title":"string","details":"string","severity":"low|medium|high"}],',
    '  "consistencyNotes": ["string"],',
    '  "confidence": 0',
    "}",
    "Os documentos analisados podem ser: comprovante de endereco, comprovante de renda, CNH, RG, carteira de trabalho/CTPS, PDF da carteira de trabalho e holerite.",
    "Extraia o maximo possivel de dados importantes para cada tipo documental.",
    "Priorize campos como nome, CPF, RG, numero da CNH, validade, categoria, endereco completo, CEP, renda, salario bruto, salario liquido, empregador, CNPJ, cargo, competencia, PIS/PASEP, datas, vencimentos e sinais de inconsistência.",
    "Se identificar CNH, RG, CTPS, comprovante de endereco ou holerite, informe isso claramente em documentType.",
    "Se não encontrar algo, apenas omita do array correspondente.",
    `Arquivo: ${input.fileName}`,
    `Tipo MIME: ${input.mimeType}`,
    "Texto do documento:",
    input.documentText.slice(0, 18000),
  ].join("\n");
}
