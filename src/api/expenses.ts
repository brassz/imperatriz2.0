import { supabase } from "@/lib/supabase";
import { PAGE_SIZE } from "@/lib/constants";

export async function fetchExpenses(page = 1) {
  try {
    const { data, error, count } = await supabase
    .from("expenses")
    .select(`
      id,
      title,
      amount,
      expense_date,
      description,
      category_id,
      status,
      created_at,
      expense_categories (name)
    `, { count: "exact" })
    .order("expense_date", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (error) throw error;

    const items = (data || []).map((e: Record<string, unknown>) => ({
    id: e.id,
    category: (e.expense_categories as { name?: string })?.name ?? "Outros",
    amount: parseFloat(String(e.amount || 0)),
    description: e.description || e.title || "",
    date: e.expense_date || e.created_at,
  }));
    return { data: items, total: count ?? 0 };
  } catch {
    return { data: [], total: 0 };
  }
}

export async function createExpense(data: {
  title: string;
  amount: number;
  expense_date: string;
  description?: string;
  category_id: string;
}) {
  const { error } = await supabase.from("expenses").insert([{
    title: data.title,
    amount: data.amount,
    expense_date: data.expense_date,
    description: data.description || data.title,
    category_id: data.category_id,
    status: "paid",
  }]);
  if (error) throw error;
}
