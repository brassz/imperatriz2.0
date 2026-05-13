import { getTrafficSupabaseClient, type TrafficSource as LibTrafficSource } from "@/lib/traffic-supabase";

export type TrafficSource = "novixcred" | "credcard";
const _assertSame: TrafficSource extends LibTrafficSource ? true : false = true;

export type TrafficLead = {
  source: TrafficSource;
  id: string;
  name: string;
  whatsapp: string;
  city: string;
  value: string;
  worksClt: boolean | null;
  hasCnpj: boolean | null;
  hasGuarantor: boolean | null;
  contacted: boolean;
  contactedAt: string | null;
  createdAt: string;
};

function ymd(isoLike: string): string {
  return String(isoLike || "").split("T")[0].split(" ")[0] || "";
}

function safeBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function safeMaybeBool(v: unknown): boolean | null {
  if (v == null || v === "") return null;
  return safeBool(v);
}

function truthyString(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return Boolean(s) && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined";
}

export async function fetchTrafficLeads(source: TrafficSource): Promise<TrafficLead[]> {
  const supabase = getTrafficSupabaseClient(source);

  const PAGE = 1000;
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += PAGE) {
    const q =
      source === "novixcred"
        ? supabase
            .from("clientes")
            .select("id, nome_completo, whatsapp, valor_desejado, cidade, contatado, created_at, trabalha_clt, possui_cnpj, possui_avalista")
            .order("created_at", { ascending: false })
        : supabase
            .from("leads")
            .select("id, nome, whatsapp, valor, cidade, contatado, contatado_em, created_at, tempo_clt, avalista, cnpj")
            .order("created_at", { ascending: false });

    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw error;
    const batch = (data || []) as Array<Record<string, unknown>>;
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  if (source === "novixcred") {
    return rows.map((r: Record<string, unknown>) => ({
      source,
      id: String(r.id || ""),
      name: String(r.nome_completo || ""),
      whatsapp: String(r.whatsapp || ""),
      city: String(r.cidade || ""),
      value: String(r.valor_desejado ?? ""),
      worksClt: safeMaybeBool(r.trabalha_clt),
      hasCnpj: safeMaybeBool(r.possui_cnpj),
      hasGuarantor: safeMaybeBool(r.possui_avalista),
      contacted: safeBool(r.contatado),
      contactedAt: null,
      createdAt: String(r.created_at || ""),
    }));
  }
  return rows.map((r: Record<string, unknown>) => ({
    source,
    id: String(r.id || ""),
    name: String(r.nome || ""),
    whatsapp: String(r.whatsapp || ""),
    city: String(r.cidade || ""),
    value: String(r.valor ?? ""),
    worksClt: truthyString(r.tempo_clt) ? true : false,
    hasCnpj: safeMaybeBool((r as any).possui_cnpj) ?? (truthyString(r.cnpj) ? true : false),
    hasGuarantor: safeMaybeBool(r.avalista),
    contacted: safeBool(r.contatado),
    contactedAt: r.contatado_em ? String(r.contatado_em) : null,
    createdAt: String(r.created_at || ""),
  }));
}

export type TrafficKpis = {
  total: number;
  contacted: number;
  notContacted: number;
  last30Days: Array<{ day: string; leads: number }>;
};

export function computeTrafficKpis(leads: TrafficLead[]): TrafficKpis {
  const total = leads.length;
  const contacted = leads.filter((l) => l.contacted).length;
  const notContacted = total - contacted;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 29);
  const cutoffYmd = ymd(cutoff.toISOString());

  const byDay: Record<string, number> = {};
  for (const l of leads) {
    const day = ymd(l.createdAt);
    if (!day || day < cutoffYmd) continue;
    byDay[day] = (byDay[day] || 0) + 1;
  }

  const days: string[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    days.push(ymd(d.toISOString()));
  }

  return {
    total,
    contacted,
    notContacted,
    last30Days: days.map((day) => ({ day, leads: byDay[day] || 0 })),
  };
}

