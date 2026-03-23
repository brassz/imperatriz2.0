import { supabase } from "@/lib/supabase";
import { PAGE_SIZE } from "@/lib/constants";

export async function fetchUsers(page = 1) {
  const { data, error, count } = await supabase
    .from("users")
    .select("id, full_name, email, role, is_active, last_login", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (error) throw error;

  const items = (data || []).map((u: Record<string, unknown>) => {
    const initials = String(u.full_name || "U")
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const lastLogin = u.last_login
      ? new Date(String(u.last_login)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
      : "—";
    return {
      id: u.id,
      name: u.full_name || "—",
      email: u.email || "",
      initials,
      role: String(u.role || "user").charAt(0).toUpperCase() + String(u.role || "user").slice(1),
      status: u.is_active ? "Ativo" : "Inativo",
      lastLogin,
    };
  });
  return { data: items, total: count ?? 0 };
}
