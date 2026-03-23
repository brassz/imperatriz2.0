import { supabase } from "@/lib/supabase";
import { PAGE_SIZE } from "@/lib/constants";

export async function fetchFines(
  page = 1,
  filters?: { dateFrom?: string; dateTo?: string }
) {
  try {
    let query = supabase
      .from("client_fines")
      .select(
        `
      id,
      client_id,
      amount,
      reason,
      created_at,
      clients (name)
    `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (filters?.dateFrom) {
      query = query.gte("created_at", `${filters.dateFrom}T00:00:00`);
    }
    if (filters?.dateTo) {
      query = query.lte("created_at", `${filters.dateTo}T23:59:59.999`);
    }

    const { data, error, count } = await query.range(
      (page - 1) * PAGE_SIZE,
      page * PAGE_SIZE - 1
    );

    if (error) throw error;

    const items = (data || []).map((f: Record<string, unknown>) => ({
      id: f.id,
      client_id: f.client_id,
      client_name: (f.clients as { name?: string })?.name ?? "—",
      amount: parseFloat(String(f.amount || 0)),
      reason: f.reason || "",
      date: f.created_at,
    }));
    return { data: items, total: count ?? 0 };
  } catch {
    return { data: [], total: 0 };
  }
}

export async function fetchFinesTotalForPeriod(
  dateFrom: string,
  dateTo: string
): Promise<number> {
  try {
    let query = supabase
      .from("client_fines")
      .select("amount")
      .gte("created_at", `${dateFrom}T00:00:00`)
      .lte("created_at", `${dateTo}T23:59:59.999`);
    const { data, error } = await query;
    if (error) throw error;
    const list = data || [];
    return list.reduce((s, row) => s + parseFloat(String(row.amount || 0)), 0);
  } catch {
    return 0;
  }
}

export async function fetchFinesByDateRange(dateFrom: string, dateTo: string) {
  try {
    const { data, error } = await supabase
      .from("client_fines")
      .select(`
        id,
        client_id,
        amount,
        reason,
        created_at,
        clients (name)
      `)
      .gte("created_at", `${dateFrom}T00:00:00`)
      .lte("created_at", `${dateTo}T23:59:59.999`)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return (data || []).map((f: Record<string, unknown>) => ({
      id: f.id,
      client_id: f.client_id,
      client_name: (f.clients as { name?: string })?.name ?? "—",
      amount: parseFloat(String(f.amount || 0)),
      reason: f.reason || "",
      date: (f.created_at as string)?.toString().split("T")[0] ?? "",
    }));
  } catch {
    return [];
  }
}

export async function createFine(data: {
  client_id: string;
  amount: number;
  reason: string;
  notes?: string;
}) {
  const { error } = await supabase.from("client_fines").insert([{
    client_id: data.client_id,
    amount: data.amount,
    reason: data.reason,
    notes: data.notes || null,
  }]);
  if (error) throw error;
}
