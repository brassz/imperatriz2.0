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

export async function insertGuarantor(input: {
  client_id: string;
  name: string;
  cpf?: string;
  phone?: string;
  relationship?: string;
  email?: string;
}) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Nome do avalista é obrigatório");
  const { error } = await supabase.from("guarantors").insert({
    client_id: input.client_id,
    name,
    cpf: String(input.cpf || "").trim() || null,
    phone: String(input.phone || "").trim() || null,
    relationship: String(input.relationship || "").trim() || null,
    email: String(input.email || "").trim() || null,
  });
  if (error) throw error;
}

export async function insertEmergencyContact(input: {
  client_id: string;
  name: string;
  phone?: string;
  relationship?: string;
}) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Nome do contato de emergência é obrigatório");
  const { error } = await supabase.from("emergency_contacts").insert({
    client_id: input.client_id,
    name,
    phone: String(input.phone || "").trim() || null,
    relationship: String(input.relationship || "").trim() || null,
  });
  if (error) throw error;
}
