export type CompanyId = "imperatriz";

export interface Company {
  id: CompanyId;
  name: string;
}

export const COMPANIES: Company[] = [
  { id: "imperatriz", name: "CRED CARD - IMPERATRIZ" },
];

export const STORAGE_KEY = "nexus-selected-company";
