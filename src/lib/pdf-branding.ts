/**
 * Configuração de identidade visual dos PDFs
 * Nome da empresa, filial, foro e cores.
 */

const BRANCH = import.meta.env.VITE_COMPANY_BRANCH || "Franca";
const FORO_BY_BRANCH: Record<string, string> = {
  Franca: "Comarca de Franca/SP",
  Litoral: "Comarca do Litoral Paulista/SP",
  "Litoral Cred": "Comarca do Litoral Paulista/SP",
  Mogiana: "Comarca de Franca/SP",
  "Mogiana Cred": "Comarca de Franca/SP",
  Imperatriz: "Comarca de Imperatriz/MA",
  "Imperatriz Cred": "Comarca de Imperatriz/MA",
  Ribeirao: "Comarca de Ribeirão Preto/SP",
};

/** Nome comercial no PDF (comprovante, cabeçalhos) — substitui "Filial ...". */
const TRADE_NAME_BY_BRANCH: Record<string, string> = {
  Franca: "FRANCACRED",
  Litoral: "LITORALCRED",
  "Litoral Cred": "LITORALCRED",
  Mogiana: "MOGIANACRED",
  "Mogiana Cred": "MOGIANACRED",
  Imperatriz: "CRED CARD - IMPERATRIZ",
  "Imperatriz Cred": "CRED CARD - IMPERATRIZ",
  "CRED CARD": "CRED CARD - IMPERATRIZ",
  Ribeirao: "RIBEIRAOCRED",
};

const companyDisplayName =
  String(import.meta.env.VITE_COMPANY_DISPLAY_NAME || "").trim() ||
  String(import.meta.env.VITE_COMPANY_NAME || "").trim() ||
  TRADE_NAME_BY_BRANCH[BRANCH] ||
  BRANCH;

/** Razão social na barra; se não houver env, usa o mesmo nome comercial da operação (por filial). */
const companyLegalOrDisplay =
  String(import.meta.env.VITE_COMPANY_LEGAL_NAME || "").trim() || companyDisplayName;

export const PDF_BRAND = {
  /** Razão / grupo (barra superior do PDF) */
  companyName: companyLegalOrDisplay,
  /** Nome da operação no comprovante e linha abaixo da barra (ex.: FRANCACRED) */
  companyDisplayName,
  branch: BRANCH,
  foro: import.meta.env.VITE_COMPANY_FORO || FORO_BY_BRANCH[BRANCH] || `Comarca de ${BRANCH}/SP`,
  colors: {
    primary: { r: 20, g: 184, b: 166 },   // #14B8A6 - Teal principal
    primaryDark: { r: 13, g: 148, b: 136 }, // #0D9488
    text: { r: 30, g: 41, b: 59 },        // #1E293B
    textMuted: { r: 100, g: 116, b: 139 }, // #64748B
    line: { r: 226, g: 232, b: 240 },     // #E2E8F0
  },
};
