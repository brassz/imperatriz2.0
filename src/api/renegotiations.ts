import { supabase } from "@/lib/supabase";
import { getSupabaseCompany } from "@/lib/supabase";
import type { RenegotiationCalcResult, RenegotiationMode } from "@/lib/renegotiation-calc";
import { createLoan } from "./loans";
import { addCalendarDays, calendarDateInBrazil } from "@/lib/brazil-date";

export type RenegotiationProposalStatus = "draft" | "finalized" | "converted";

export type RenegotiationProposal = {
  id: string;
  client_id: string;
  debt_ref: string;
  source_type: "loan" | "installment";
  client_name: string;
  client_phone: string;
  proposal_mode: RenegotiationMode;
  base_capital: number;
  discount_percent: number;
  total_amount: number;
  down_payment: number;
  installment_count: number;
  installment_amount: number;
  status: RenegotiationProposalStatus;
  new_loan_id?: string | null;
  notes?: string | null;
  created_at: string;
  finalized_at?: string | null;
};

const LS_KEY_PREFIX = "nexus_renegotiation_proposals_";

function lsKey() {
  return `${LS_KEY_PREFIX}${getSupabaseCompany()}`;
}

function readLocal(): RenegotiationProposal[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(lsKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RenegotiationProposal[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(rows: RenegotiationProposal[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(lsKey(), JSON.stringify(rows));
}

function mapRow(r: Record<string, unknown>): RenegotiationProposal {
  return {
    id: String(r.id),
    client_id: String(r.client_id),
    debt_ref: String(r.debt_ref),
    source_type: r.source_type === "installment" ? "installment" : "loan",
    client_name: String(r.client_name || ""),
    client_phone: String(r.client_phone || ""),
    proposal_mode: String(r.proposal_mode) as RenegotiationMode,
    base_capital: parseFloat(String(r.base_capital || 0)),
    discount_percent: parseFloat(String(r.discount_percent || 0)),
    total_amount: parseFloat(String(r.total_amount || 0)),
    down_payment: parseFloat(String(r.down_payment || 0)),
    installment_count: parseInt(String(r.installment_count || 0), 10) || 0,
    installment_amount: parseFloat(String(r.installment_amount || 0)),
    status: (String(r.status || "draft") as RenegotiationProposalStatus),
    new_loan_id: r.new_loan_id ? String(r.new_loan_id) : null,
    notes: r.notes ? String(r.notes) : null,
    created_at: String(r.created_at || new Date().toISOString()),
    finalized_at: r.finalized_at ? String(r.finalized_at) : null,
  };
}

let tableMissing = false;

const TABLE_MISSING_LS_PREFIX = "nexus_renegotiation_table_missing_";

function tableMissingLsKey() {
  return `${TABLE_MISSING_LS_PREFIX}${getSupabaseCompany()}`;
}

function isTableKnownMissing(): boolean {
  if (tableMissing) return true;
  if (typeof window !== "undefined" && localStorage.getItem(tableMissingLsKey()) === "1") {
    tableMissing = true;
    return true;
  }
  return false;
}

function markTableMissing() {
  tableMissing = true;
  if (typeof window !== "undefined") localStorage.setItem(tableMissingLsKey(), "1");
}

function isRenegotiationTableMissing(error: { code?: string; message?: string; details?: string; hint?: string } | null): boolean {
  if (!error) return false;
  const blob = `${error.code || ""} ${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    blob.includes("renegotiation_proposals") ||
    blob.includes("does not exist") ||
    blob.includes("schema cache") ||
    blob.includes("not found")
  );
}

function newProposalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function fetchRenegotiationProposals(): Promise<RenegotiationProposal[]> {
  if (isTableKnownMissing()) return readLocal();

  const { data, error } = await supabase
    .from("renegotiation_proposals")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    if (isRenegotiationTableMissing(error)) {
      markTableMissing();
      return readLocal();
    }
    throw error;
  }

  return (data || []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function saveRenegotiationProposal(
  input: Omit<RenegotiationProposal, "id" | "created_at" | "status" | "finalized_at" | "new_loan_id"> & {
    id?: string;
    status?: RenegotiationProposalStatus;
  },
): Promise<RenegotiationProposal> {
  const payload = {
    client_id: input.client_id,
    debt_ref: input.debt_ref,
    source_type: input.source_type,
    client_name: input.client_name,
    client_phone: input.client_phone || "",
    proposal_mode: input.proposal_mode,
    base_capital: input.base_capital,
    discount_percent: input.discount_percent,
    total_amount: input.total_amount,
    down_payment: input.down_payment,
    installment_count: input.installment_count,
    installment_amount: input.installment_amount,
    status: input.status || "draft",
    notes: input.notes || null,
  };

  if (isTableKnownMissing()) {
    const rows = readLocal();
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    const row: RenegotiationProposal = {
      id: input.id || newProposalId(),
      ...payload,
      new_loan_id: existing?.new_loan_id ?? null,
      created_at: existing?.created_at || new Date().toISOString(),
      finalized_at: existing?.finalized_at ?? null,
    };
    const next = existing ? rows.map((r) => (r.id === row.id ? row : r)) : [row, ...rows];
    writeLocal(next);
    return row;
  }

  if (input.id) {
    const { data, error } = await supabase
      .from("renegotiation_proposals")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) {
      if (!isRenegotiationTableMissing(error)) throw error;
      markTableMissing();
      return saveRenegotiationProposal(input);
    }
    return mapRow(data as Record<string, unknown>);
  }

  const { data, error } = await supabase.from("renegotiation_proposals").insert(payload).select("*").single();
  if (error) {
    if (!isRenegotiationTableMissing(error)) throw error;
    markTableMissing();
    return saveRenegotiationProposal(input);
  }
  return mapRow(data as Record<string, unknown>);
}

export async function finalizeRenegotiationProposal(id: string): Promise<RenegotiationProposal> {
  const finalized_at = new Date().toISOString();

  if (isTableKnownMissing()) {
    const rows = readLocal();
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error("Proposta não encontrada");
    const updated = { ...row, status: "finalized" as const, finalized_at };
    writeLocal(rows.map((r) => (r.id === id ? updated : r)));
    return updated;
  }

  const { data, error } = await supabase
    .from("renegotiation_proposals")
    .update({ status: "finalized", finalized_at })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    if (!isRenegotiationTableMissing(error)) throw error;
    markTableMissing();
    return finalizeRenegotiationProposal(id);
  }
  return mapRow(data as Record<string, unknown>);
}

export async function convertRenegotiationToLoan(
  proposalId: string,
  opts?: { interest_rate?: number; due_days?: number },
): Promise<{ proposal: RenegotiationProposal; loanId: string }> {
  const proposals = await fetchRenegotiationProposals();
  const proposal = proposals.find((p) => p.id === proposalId);
  if (!proposal) throw new Error("Proposta não encontrada");
  if (proposal.status !== "finalized") throw new Error("Finalize a proposta antes de criar o empréstimo");

  const today = calendarDateInBrazil();
  const dueDate = addCalendarDays(today, opts?.due_days ?? 30);
  const interestRate = opts?.interest_rate ?? 20;

  const inserted = await createLoan({
    client_id: proposal.client_id,
    amount: proposal.total_amount,
    interest_rate: interestRate,
    loan_date: today,
    due_date: dueDate,
  });

  const loanId = String((inserted as { id?: string }).id || "");
  if (!loanId) throw new Error("Empréstimo criado sem ID");

  if (isTableKnownMissing()) {
    const rows = readLocal();
    const updated = rows.map((r) =>
      r.id === proposalId ? { ...r, status: "converted" as const, new_loan_id: loanId } : r,
    );
    writeLocal(updated);
    const p = updated.find((r) => r.id === proposalId)!;
    return { proposal: p, loanId };
  }

  const { data, error } = await supabase
    .from("renegotiation_proposals")
    .update({ status: "converted", new_loan_id: loanId })
    .eq("id", proposalId)
    .select("*")
    .single();

  if (error) {
    if (!isRenegotiationTableMissing(error)) throw error;
    markTableMissing();
    const rows = readLocal().map((r) =>
      r.id === proposalId ? { ...r, status: "converted" as const, new_loan_id: loanId } : r,
    );
    writeLocal(rows);
    return { proposal: rows.find((r) => r.id === proposalId)!, loanId };
  }

  return { proposal: mapRow(data as Record<string, unknown>), loanId };
}

export async function fetchRenegotiatedClientIds(): Promise<string[]> {
  const rows = await fetchRenegotiationProposals();
  return [
    ...new Set(
      rows.filter((r) => r.status === "finalized" || r.status === "converted").map((r) => r.client_id),
    ),
  ];
}

export function buildRenegotiationWhatsAppMessage(params: {
  clientName: string;
  creditorName: string;
  calc: RenegotiationCalcResult;
  mode: RenegotiationMode;
  contactPhone: string;
}): string {
  const nome = params.clientName.trim() || "Cliente";
  const contato = params.contactPhone.trim() || "(informar contato)";

  let condicao = "";
  if (params.mode === "avista_desconto") {
    condicao = `Quitação à vista com ${params.calc.discountPercent}% de desconto: *${params.calc.totalAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}* (base capital, sem multas).`;
  } else if (params.mode === "avista") {
    condicao = `Quitação à vista: *${params.calc.totalAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}* (somente capital, sem multas).`;
  } else if (params.mode === "parcelado_entrada") {
    condicao = `Entrada de *${params.calc.downPayment.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}* + *${params.calc.installmentCount}x* de *${params.calc.installmentAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}*.`;
  } else {
    condicao = `Parcelamento em *${params.calc.installmentCount}x* de *${params.calc.installmentAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}* (sem multas).`;
  }

  return `Prezado(a) Sr(a). ${nome},

A *Capital Advocacia*, em nome de ${params.creditorName}, apresenta *proposta de renegociação* do seu débito:

${condicao}

As multas diárias foram dispensadas nesta negociação.

Em anexo segue o PDF oficial da proposta. Para aceitar, responda esta mensagem ou contate *${contato}* em até 48 horas.

*Capital Advocacia*
Departamento de Renegociação.`;
}
