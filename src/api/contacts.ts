import { supabase } from "@/lib/supabase";

export async function fetchGuarantors(clientId: string) {
  try {
    const { data, error } = await supabase
      .from("guarantors")
      .select("id, name, cpf, phone, relationship, email")
      .eq("client_id", clientId);

    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

export async function fetchEmergencyContacts(clientId: string) {
  try {
    const { data, error } = await supabase
      .from("emergency_contacts")
      .select("id, name, phone, relationship")
      .eq("client_id", clientId);

    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}
