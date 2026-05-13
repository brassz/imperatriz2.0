import type { InfoseekConsultResult } from "@/api/infoseek";
import type { DocumentAnalysisResult } from "@/types/document-analysis";

export type AtendimentoDecisionLevel = "bom_cliente" | "atencao" | "nao_recomendado";

export type AtendimentoDecision = {
  level: AtendimentoDecisionLevel;
  score: number;
  headline: string;
  reasons: string[];
};

function normalizeInfoseekScore(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score <= 100) return Math.max(0, Math.min(100, score));
  return Math.max(0, Math.min(100, Math.round(score / 10)));
}

export function evaluateAtendimentoClient(input: {
  internalScore?: number | null;
  totalLoans?: number | null;
  overdueLoans?: number | null;
  infoseek?: InfoseekConsultResult | null;
  documentAnalysis?: DocumentAnalysisResult | null;
}): AtendimentoDecision {
  let score = 55;
  const reasons: string[] = [];

  const internalScore = Number.isFinite(Number(input.internalScore)) ? Number(input.internalScore) : null;
  const overdueLoans = Number(input.overdueLoans || 0);
  const totalLoans = Number(input.totalLoans || 0);
  const infoseekScore = normalizeInfoseekScore(input.infoseek?.scoreNumeric ?? null);
  const documentAnalysis = input.documentAnalysis || null;

  if (internalScore != null) {
    score = Math.round((score + internalScore) / 2);
    if (internalScore >= 80) reasons.push("Histórico interno forte.");
    else if (internalScore < 50) reasons.push("Score interno baixo para concessão.");
  }

  if (overdueLoans > 0) {
    score -= 25;
    reasons.push(`Cliente possui ${overdueLoans} empréstimo(s) vencido(s).`);
  } else if (totalLoans > 0) {
    score += 8;
    reasons.push("Histórico interno sem pendências vencidas.");
  }

  if (infoseekScore != null) {
    if (infoseekScore >= 75) {
      score += 15;
      reasons.push("Consulta Infoseek com score externo favorável.");
    } else if (infoseekScore < 45) {
      score -= 20;
      reasons.push("Consulta Infoseek com score externo fraco.");
    }
  }

  if (documentAnalysis) {
    score += Math.round((Number(documentAnalysis.confidence || 0) - 50) / 8);
    if (documentAnalysis.riskFlags.some((flag) => flag.severity === "high")) {
      score -= 20;
      reasons.push("Documentação com alertas graves.");
    } else if (documentAnalysis.riskFlags.length > 0) {
      score -= 10;
      reasons.push("Documentação exige atenção manual.");
    } else {
      score += 8;
      reasons.push("Documentação sem alertas relevantes.");
    }
  }

  score = Math.max(0, Math.min(100, score));

  if (score >= 70) {
    return {
      level: "bom_cliente",
      score,
      headline: "Bom cliente para seguir na análise",
      reasons: reasons.length > 0 ? reasons : ["Sinais gerais positivos nas fontes analisadas."],
    };
  }

  if (score >= 45) {
    return {
      level: "atencao",
      score,
      headline: "Cliente com pontos de atenção",
      reasons: reasons.length > 0 ? reasons : ["Há sinais mistos e a análise deve seguir com revisão manual."],
    };
  }

  return {
    level: "nao_recomendado",
    score,
    headline: "Cliente com risco elevado",
    reasons: reasons.length > 0 ? reasons : ["As fontes analisadas indicam risco elevado."],
  };
}
