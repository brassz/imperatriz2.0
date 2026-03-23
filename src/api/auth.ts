import { supabase } from "@/lib/supabase";
import { setSupabaseCompany } from "@/lib/supabase";
import type { CompanyId } from "@/lib/companies";

export interface User {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

const AUTH_STORAGE_KEY = "nexus-auth-user";

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setStoredUser(user: User | null): void {
  if (typeof window === "undefined") return;
  if (user) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

export async function login(companyId: string, email: string, password: string): Promise<User> {
  setSupabaseCompany(companyId as CompanyId);

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, role, password_hash, is_active")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (error) throw new Error("Erro ao buscar usuário. Verifique a conexão.");
  if (!data) throw new Error("Email ou senha incorretos.");

  const storedPassword = (data as Record<string, unknown>).password_hash;
  if (!storedPassword || String(storedPassword) !== password) {
    throw new Error("Email ou senha incorretos.");
  }

  const isActive = (data as Record<string, unknown>).is_active;
  if (isActive === false) {
    throw new Error("Usuário inativo. Entre em contato com o administrador.");
  }

  const user: User = {
    id: String(data.id),
    full_name: String(data.full_name || ""),
    email: String(data.email || ""),
    role: String(data.role || "user"),
  };

  await supabase
    .from("users")
    .update({ last_login: new Date().toISOString() })
    .eq("id", user.id);

  setStoredUser(user);
  return user;
}

export function logout(): void {
  setStoredUser(null);
}
