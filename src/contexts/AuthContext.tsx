import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "@/api/auth";
import { getStoredUser } from "@/api/auth";
import { fetchEmployeesWithPaymentToday } from "@/api/employees";
import { toast } from "@/hooks/use-toast";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  requestToken: (companyId: string, email: string) => Promise<void>;
  verifyToken: (companyId: string, email: string, token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    setUser(getStoredUser());
    setIsLoading(false);
  }, []);

  // Ao fechar a aba/navegador, forçar novo login: limpa a sessão local.
  useEffect(() => {
    const clearOnClose = () => {
      try {
        localStorage.removeItem("nexus-auth-user");
      } catch {
        // ignore
      }
    };
    window.addEventListener("pagehide", clearOnClose);
    window.addEventListener("beforeunload", clearOnClose);
    return () => {
      window.removeEventListener("pagehide", clearOnClose);
      window.removeEventListener("beforeunload", clearOnClose);
    };
  }, []);

  const requestToken = useCallback(async (companyId: string, email: string) => {
    const { requestWhatsappLoginToken } = await import("@/api/whatsapp-token-login");
    const res = await requestWhatsappLoginToken(companyId, email);
    if (!res.ok) throw new Error(res.error);
  }, []);

  const verifyToken = useCallback(
    async (companyId: string, email: string, token: string) => {
      const { verifyWhatsappLoginToken } = await import("@/api/whatsapp-token-login");
      const res = await verifyWhatsappLoginToken(companyId, email, token);
      if (!res.ok) throw new Error(res.error);
      const loggedUser = res.user;
      const { setStoredUser } = await import("@/api/auth");
      setStoredUser(loggedUser);
      setUser(loggedUser);
      try {
        const today = new Date();
        const todayDay = today.getDate();
        const key = `nexus-salary-alert-${today.toISOString().slice(0, 10)}-${loggedUser.id}`;
        if (!localStorage.getItem(key)) {
          const employees = await fetchEmployeesWithPaymentToday(todayDay);
          if (employees.length > 0) {
            const names = employees.map((e) => e.full_name).join(", ");
            toast({
              title: "Lembrete de pagamento de salários",
              description: `Hoje é dia de pagamento para: ${names}.`,
            });
            localStorage.setItem(key, "1");
          }
        }
      } catch {
        // silencioso
      }
      navigate("/");
    },
    [navigate]
  );

  const logout = useCallback(async () => {
    const { logout: doLogout } = await import("@/api/auth");
    doLogout();
    setUser(null);
    navigate("/login");
  }, [navigate]);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isLoading,
      requestToken,
      verifyToken,
      logout,
    }),
    [user, isLoading, requestToken, verifyToken, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
