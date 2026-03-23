import { supabase } from "@/lib/supabase";
import { PAGE_SIZE } from "@/lib/constants";

export async function fetchCashTransactions(page = 1) {
  try {
  const { data, error, count } = await supabase
    .from("cash_transactions")
    .select("id, transaction_type, amount, description, created_at, balance_after", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (error) throw error;

    const items = (data || []).map((t: Record<string, unknown>) => ({
    id: t.id,
    type: t.transaction_type === "deposit" ? "in" : "out",
    amount: parseFloat(String(t.amount || 0)),
    reason: t.description || "",
    date: (t.created_at as string)?.split("T")[0] || "",
  }));
    return { data: items, total: count ?? 0 };
  } catch {
    return { data: [], total: 0 };
  }
}

export async function fetchCashBalance() {
  try {
    const { data, error } = await supabase
    .from("cash_settings")
    .select("current_balance")
    .limit(1)
    .single();

    if (error) return { balance: 0, income: 0, outcome: 0 };

    const balance = parseFloat(String(data?.current_balance || 0));

    const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

  const { data: deposits } = await supabase
    .from("cash_transactions")
    .select("amount")
    .eq("transaction_type", "deposit")
    .gte("created_at", firstDay);

  const { data: withdrawals } = await supabase
    .from("cash_transactions")
    .select("amount")
    .eq("transaction_type", "withdrawal")
    .gte("created_at", firstDay);

    const income = (deposits || []).reduce((s: number, d: Record<string, unknown>) => s + parseFloat(String(d.amount || 0)), 0);
    const outcome = (withdrawals || []).reduce((s: number, w: Record<string, unknown>) => s + parseFloat(String(w.amount || 0)), 0);

    return { balance, income, outcome };
  } catch {
    return { balance: 0, income: 0, outcome: 0 };
  }
}

export async function createCashTransaction(data: {
  transaction_type: "deposit" | "withdrawal";
  amount: number;
  description: string;
}) {
  const { data: settings } = await supabase
    .from("cash_settings")
    .select("id, current_balance")
    .limit(1)
    .single();

  const currentBalance = parseFloat(String(settings?.current_balance || 0));
  const delta = data.transaction_type === "deposit" ? data.amount : -data.amount;
  const newBalance = Math.max(0, currentBalance + delta);

  const { error: txError } = await supabase.from("cash_transactions").insert([{
    transaction_type: data.transaction_type,
    amount: data.amount,
    description: data.description,
    balance_after: newBalance,
  }]);
  if (txError) throw txError;

  if (settings?.id) {
    await supabase.from("cash_settings").update({ current_balance: newBalance }).eq("id", settings.id);
  }
}
