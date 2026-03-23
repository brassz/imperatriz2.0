export type CompanyId = "empresa1" | "empresa2" | "empresa3" | "empresa4";

export interface Company {
  id: CompanyId;
  name: string;
}

export const COMPANIES: Company[] = [
  { id: "empresa1", name: "FRANCA CRED (NEXUS)" },
  { id: "empresa2", name: "LITORAL CRED" },
  { id: "empresa3", name: "MOGIANA CRED" },
  { id: "empresa4", name: "IMPERATRIZ CRED" },
];

export const STORAGE_KEY = "nexus-selected-company";
