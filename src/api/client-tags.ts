import { supabase } from "@/lib/supabase";

export type ClientTagRow = {
  id: string;
  client_id: string;
  text: string;
  created_at: string;
  created_by?: string | null;
  created_by_name?: string | null;
  color?: string | null;
};

export async function fetchClientTags(clientId: string): Promise<ClientTagRow[]> {
  const { data, error } = await supabase
    .from("client_tags")
    .select("id, client_id, text, created_at, created_by, created_by_name, color")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as ClientTagRow[];
}

export async function createClientTag(params: {
  client_id: string;
  text: string;
  created_by?: string;
  created_by_name?: string;
  color?: string;
}): Promise<ClientTagRow> {
  const { data, error } = await supabase
    .from("client_tags")
    .insert([
      {
        client_id: params.client_id,
        text: params.text,
        created_by: params.created_by ?? null,
        created_by_name: params.created_by_name ?? null,
        color: params.color ?? null,
      },
    ])
    .select("id, client_id, text, created_at, created_by, created_by_name, color")
    .single();

  if (error) throw error;
  return data as ClientTagRow;
}

export async function deleteClientTag(id: string): Promise<void> {
  const { error } = await supabase.from("client_tags").delete().eq("id", id);
  if (error) throw error;
}

