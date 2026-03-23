import { supabase } from "@/lib/supabase";

export type EmployeeRow = {
  id: string;
  full_name: string;
  cpf: string;
  birth_date: string | null;
  address: string | null;
  cep: string | null;
  payment_day: number; // 1–31
  salary: number;
  created_at: string;
};

export async function fetchEmployees(): Promise<EmployeeRow[]> {
  const { data, error } = await supabase
    .from("employees")
    .select("id, full_name, cpf, birth_date, address, cep, payment_day, salary, created_at")
    .order("full_name", { ascending: true });

  if (error) throw error;
  return (data || []) as EmployeeRow[];
}

export async function createEmployee(payload: {
  full_name: string;
  cpf: string;
  birth_date?: string | null;
  address?: string | null;
  cep?: string | null;
  payment_day: number;
  salary: number;
}): Promise<EmployeeRow> {
  const { data, error } = await supabase
    .from("employees")
    .insert([
      {
        full_name: payload.full_name,
        cpf: payload.cpf.replace(/\D/g, ""),
        birth_date: payload.birth_date || null,
        address: payload.address || null,
        cep: payload.cep || null,
        payment_day: payload.payment_day,
        salary: payload.salary,
      },
    ])
    .select("id, full_name, cpf, birth_date, address, cep, payment_day, salary, created_at")
    .single();

  if (error) throw error;
  return data as EmployeeRow;
}

export async function fetchEmployeesWithPaymentToday(todayDay: number): Promise<EmployeeRow[]> {
  const { data, error } = await supabase
    .from("employees")
    .select("id, full_name, cpf, birth_date, address, cep, payment_day, salary, created_at")
    .eq("payment_day", todayDay);

  if (error) throw error;
  return (data || []) as EmployeeRow[];
}

export async function updateEmployee(id: string, payload: {
  full_name?: string;
  cpf?: string;
  birth_date?: string | null;
  address?: string | null;
  cep?: string | null;
  payment_day?: number;
  salary?: number;
}): Promise<void> {
  const update: Record<string, unknown> = { ...payload };
  if (update.cpf) update.cpf = String(update.cpf).replace(/\D/g, "");
  const { error } = await supabase
    .from("employees")
    .update(update)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteEmployee(id: string): Promise<void> {
  const { error } = await supabase.from("employees").delete().eq("id", id);
  if (error) throw error;
}

