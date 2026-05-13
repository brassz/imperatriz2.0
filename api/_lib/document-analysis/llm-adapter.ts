import type { DocumentAnalysisResult } from "../../../src/types/document-analysis";
import { buildDocumentAnalysisPrompt } from "./prompts";

function parseJsonObjectFromText(text: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeArrayStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeExtractedFields(input: unknown): DocumentAnalysisResult["extractedFields"] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const key = String(row.key || `field_${index + 1}`).trim();
      const label = String(row.label || key).trim();
      const value = String(row.value || "").trim();
      if (!value) return null;
      return { key, label, value };
    })
    .filter((item): item is DocumentAnalysisResult["extractedFields"][number] => item !== null)
    .slice(0, 20);
}

function normalizeRiskFlags(input: unknown): DocumentAnalysisResult["riskFlags"] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const title = String(row.title || "").trim();
      const details = String(row.details || "").trim();
      const severityRaw = String(row.severity || "medium").trim().toLowerCase();
      const severity = severityRaw === "low" || severityRaw === "medium" || severityRaw === "high"
        ? severityRaw
        : "medium";
      if (!title && !details) return null;
      return {
        title: title || "Atenção documental",
        details: details || title,
        severity,
      };
    })
    .filter((item): item is DocumentAnalysisResult["riskFlags"][number] => item !== null)
    .slice(0, 10);
}

export async function analyzeDocumentWithLlm(input: {
  fileName: string;
  mimeType: string;
  documentText: string;
}): Promise<DocumentAnalysisResult | null> {
  const apiKey = String(process.env.DOCUMENT_ANALYSIS_API_KEY || "").trim();
  const model = String(process.env.DOCUMENT_ANALYSIS_MODEL || "").trim();
  const baseUrl = String(process.env.DOCUMENT_ANALYSIS_BASE_URL || "").trim().replace(/\/$/, "");

  if (!apiKey || !model || !baseUrl) {
    return null;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "Você responde apenas JSON válido.",
        },
        {
          role: "user",
          content: buildDocumentAnalysisPrompt(input),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha na análise documental (${response.status})`);
  }

  const raw = await response.json() as Record<string, unknown>;
  const content = String(
    ((raw.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined)?.content || "",
  );
  const parsed = parseJsonObjectFromText(content);
  if (!parsed) {
    throw new Error("A IA não retornou um JSON válido para a análise documental.");
  }

  return {
    success: true,
    fileName: input.fileName,
    mimeType: input.mimeType,
    source: "llm",
    documentType: String(parsed.documentType || "Documento").trim() || "Documento",
    summary: String(parsed.summary || "").trim() || "Resumo não informado pela IA.",
    keyPoints: normalizeArrayStrings(parsed.keyPoints),
    extractedFields: normalizeExtractedFields(parsed.extractedFields),
    riskFlags: normalizeRiskFlags(parsed.riskFlags),
    consistencyNotes: normalizeArrayStrings(parsed.consistencyNotes),
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence || 0) || 0)),
    extractedTextPreview: input.documentText.slice(0, 1200),
  };
}
