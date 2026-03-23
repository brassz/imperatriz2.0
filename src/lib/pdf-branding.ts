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

export const PDF_BRAND = {
  // Nome fixo exibido nas colinhas/mensagens para todas as empresas
  companyName: "NOVIXCRED",
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
