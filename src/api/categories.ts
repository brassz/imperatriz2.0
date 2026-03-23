import { supabase } from "@/lib/supabase";

export async function fetchExpenseCategories() {
  try {
    const { data, error } = await supabase
    .from("expense_categories")
    .select("id, name, description, is_active")
    .eq("is_active", true)
    .order("name")
    .limit(50);

  if (error) throw error;

    return (data || []).map((c: Record<string, unknown>) => ({
    id: c.id,
    name: c.name,
    description: c.description || "",
  }));
  } catch {
    return [];
  }
}
