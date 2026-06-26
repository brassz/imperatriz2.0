import { createContext } from "react";
import type { User } from "@/api/auth";

export interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  requestToken: (companyId: string, email: string) => Promise<void>;
  verifyToken: (companyId: string, email: string, token: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
