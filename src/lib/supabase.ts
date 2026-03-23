import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { CompanyId } from "./companies";
import { STORAGE_KEY } from "./companies";

const envKeys: Record<CompanyId, { url: string; key: string }> = {
  empresa1: {
    url: import.meta.env.VITE_SUPABASE_URL_EMPRESA1 || import.meta.env.VITE_SUPABASE_URL,
    key: import.meta.env.VITE_SUPABASE_ANON_KEY_EMPRESA1 || import.meta.env.VITE_SUPABASE_ANON_KEY,
  },
  empresa2: {
    url: import.meta.env.VITE_SUPABASE_URL_EMPRESA2,
    key: import.meta.env.VITE_SUPABASE_ANON_KEY_EMPRESA2,
  },
  empresa3: {
    url: import.meta.env.VITE_SUPABASE_URL_EMPRESA3,
    key: import.meta.env.VITE_SUPABASE_ANON_KEY_EMPRESA3,
  },
  empresa4: {
    url: import.meta.env.VITE_SUPABASE_URL_EMPRESA4,
    key: import.meta.env.VITE_SUPABASE_ANON_KEY_EMPRESA4,
  },
};

function createClientForCompany(companyId: CompanyId): SupabaseClient {
  const { url, key } = envKeys[companyId] || envKeys.empresa1;
  if (!url || !key) {
    console.warn(
      `Supabase não configurado para ${companyId}. Configure VITE_SUPABASE_URL_EMPRESA* e VITE_SUPABASE_ANON_KEY_EMPRESA* no .env`
    );
  }
  return createClient(url || "", key || "");
}

const validIds: CompanyId[] = ["empresa1", "empresa2", "empresa3", "empresa4"];
function loadStoredCompany(): CompanyId {
  if (typeof window === "undefined") return "empresa1";
  const stored = localStorage.getItem(STORAGE_KEY) as CompanyId | null;
  return stored && validIds.includes(stored) ? stored : "empresa1";
}

let currentCompanyId: CompanyId = loadStoredCompany();
let currentClient = createClientForCompany(currentCompanyId);

export function setSupabaseCompany(companyId: CompanyId): void {
  if (currentCompanyId === companyId) return;
  currentCompanyId = companyId;
  currentClient = createClientForCompany(companyId);
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, companyId);
  }
}

export function getSupabaseCompany(): CompanyId {
  return currentCompanyId;
}

export const supabase = new Proxy(currentClient, {
  get(_target, prop: keyof SupabaseClient) {
    return (currentClient as Record<string, unknown>)[prop];
  },
}) as SupabaseClient;
