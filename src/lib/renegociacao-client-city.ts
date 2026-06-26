export const RENEGOCIACAO_CITY_OPTIONS = [
  { id: "praia_grande", label: "Praia Grande" },
  { id: "sao_vicente", label: "São Vicente" },
  { id: "santos", label: "Santos" },
  { id: "cubatao", label: "Cubatão" },
] as const;

export type RenegociacaoCityId = (typeof RENEGOCIACAO_CITY_OPTIONS)[number]["id"];

export type RenegociacaoCityFilter = "all" | RenegociacaoCityId | "outros" | "sem_endereco";

function normalizeAddressForCity(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Identifica cidade pelo texto do endereço cadastrado no cliente. */
export function detectClientCity(address: string | null | undefined): RenegociacaoCityId | "outros" | "sem_endereco" {
  const norm = normalizeAddressForCity(address);
  if (!norm.trim()) return "sem_endereco";
  if (norm.includes("praia grande")) return "praia_grande";
  if (norm.includes("sao vicente")) return "sao_vicente";
  if (norm.includes("cubatao")) return "cubatao";
  if (/\bsantos\b/.test(norm)) return "santos";
  return "outros";
}

export function renegociacaoCityLabel(city: RenegociacaoCityId | "outros" | "sem_endereco"): string {
  if (city === "outros") return "Outros";
  if (city === "sem_endereco") return "Sem endereço";
  return RENEGOCIACAO_CITY_OPTIONS.find((c) => c.id === city)?.label || city;
}
