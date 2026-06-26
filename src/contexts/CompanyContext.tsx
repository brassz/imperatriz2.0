import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setSupabaseCompany } from "@/lib/supabase";
import type { CompanyId } from "@/lib/companies";
import { COMPANIES, STORAGE_KEY } from "@/lib/companies";

interface CompanyContextValue {
  companyId: CompanyId;
  companyName: string;
  setCompany: (id: CompanyId) => void;
  companies: typeof COMPANIES;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

function loadInitialCompany(): CompanyId {
  if (typeof window === "undefined") return "imperatriz";
  const stored = localStorage.getItem(STORAGE_KEY) as CompanyId | null;
  return stored === "imperatriz" ? stored : "imperatriz";
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [companyId, setCompanyIdState] = useState<CompanyId>(loadInitialCompany);
  const queryClient = useQueryClient();

  const setCompany = useCallback(
    (id: CompanyId) => {
      if (companyId === id) return;
      setSupabaseCompany(id);
      setCompanyIdState(id);
      queryClient.clear();
    },
    [companyId, queryClient]
  );

  const companyName = COMPANIES.find((c) => c.id === companyId)?.name ?? "CRED CARD - IMPERATRIZ";
  const value = useMemo(
    () => ({
      companyId,
      companyName,
      setCompany,
      companies: COMPANIES,
    }),
    [companyId, companyName, setCompany]
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
  return ctx;
}
