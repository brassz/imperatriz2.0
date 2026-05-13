import type { DocumentAnalysisResponse } from "@/types/document-analysis";
import { buildFallbackDocumentAnalysis } from "@/lib/document-analysis-fallback";

export async function analyzeDocumentText(input: {
  fileName: string;
  mimeType: string;
  documentText: string;
}): Promise<DocumentAnalysisResponse> {
  try {
    const response = await fetch("/api/document-analysis/upload-or-analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    const raw = await response.json().catch(() => null);
    if (response.status === 404) {
      return buildFallbackDocumentAnalysis({
        ...input,
        extraConsistencyNotes: [
          "Endpoint /api/document-analysis/upload-or-analyze indisponível neste ambiente; fallback local aplicado.",
        ],
      });
    }

    if (!response.ok) {
      const message =
        raw && typeof raw === "object" && "error" in raw ? String((raw as { error?: unknown }).error || "") : "";
      throw new Error(message || `Erro ${response.status} na análise documental`);
    }

    return raw as DocumentAnalysisResponse;
  } catch (error) {
    return buildFallbackDocumentAnalysis({
      ...input,
      extraConsistencyNotes: [
        `Falha ao acessar a análise server-side; fallback local aplicado${error instanceof Error ? `: ${error.message}` : "."}`,
      ],
    });
  }
}
