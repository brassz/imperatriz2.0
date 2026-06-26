import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { CompanyId } from "./companies";
import { STORAGE_KEY } from "./companies";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.VITE_SUPABASE_URL_EMPRESA1 ||
  "";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY_EMPRESA1 ||
  "";

function createClientForCompany(_companyId: CompanyId): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn(
      "Supabase não configurado. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env"
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const DEFAULT_COMPANY: CompanyId = "imperatriz";

function loadStoredCompany(): CompanyId {
  if (typeof window === "undefined") return DEFAULT_COMPANY;
  const stored = localStorage.getItem(STORAGE_KEY) as CompanyId | null;
  return stored === "imperatriz" ? stored : DEFAULT_COMPANY;
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

const clientCache = new Map<CompanyId, SupabaseClient>();

/** Cliente Supabase de uma empresa sem alterar a empresa ativa da sessão. */
export function getSupabaseClientForCompany(companyId: CompanyId): SupabaseClient {
  let client = clientCache.get(companyId);
  if (!client) {
    client = createClientForCompany(companyId);
    clientCache.set(companyId, client);
  }
  return client;
}

export const supabase = new Proxy(currentClient, {
  get(_target, prop: keyof SupabaseClient) {
    return (currentClient as Record<string, unknown>)[prop];
  },
}) as SupabaseClient;
