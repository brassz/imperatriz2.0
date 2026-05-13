import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { DocumentAnalysisResponse } from "../../src/types/document-analysis";
import { buildFallbackDocumentAnalysis } from "../../src/lib/document-analysis-fallback";
import { analyzeDocumentWithLlm } from "../_lib/document-analysis/llm-adapter";

export default async function handler(req: VercelRequest, res: VercelResponse<DocumentAnalysisResponse>) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Use POST" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const fileName = String(body?.fileName || "").trim();
  const mimeType = String(body?.mimeType || "").trim();
  const documentText = String(body?.documentText || "").trim();

  if (!fileName || !mimeType) {
    return res.status(400).json({ success: false, error: "Arquivo inválido para análise." });
  }

  if (!documentText) {
    return res.status(400).json({ success: false, error: "Não foi possível extrair texto do documento." });
  }

  try {
    const llmResult = await analyzeDocumentWithLlm({ fileName, mimeType, documentText });
    return res.status(200).json(llmResult || buildFallbackDocumentAnalysis({ fileName, mimeType, documentText }));
  } catch (error) {
    const fallback = buildFallbackDocumentAnalysis({ fileName, mimeType, documentText });
    if (error instanceof Error) {
      fallback.consistencyNotes = [...fallback.consistencyNotes, `Fallback usado após erro da IA: ${error.message}`];
    }
    return res.status(200).json(fallback);
  }
}
