import { supabase } from "@/lib/supabase";

const SIGN_TTL_HOURS = 72;

function randomToken(): string {
  // token curto o suficiente pra URL, longo o suficiente pra não adivinhar
  const arr = new Uint8Array(24);
  (globalThis.crypto as Crypto | undefined)?.getRandomValues?.(arr);
  // fallback simples se crypto indisponível
  const bytes = Array.from(arr).map((b) => (Number.isFinite(b) ? b : Math.floor(Math.random() * 256)));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256Hex(input: string): Promise<string> {
  const subtle = (globalThis as any)?.crypto?.subtle as SubtleCrypto | undefined;
  if (subtle?.digest) {
    const data = new TextEncoder().encode(input);
    const hash = await subtle.digest("SHA-256", data);
    const bytes = Array.from(new Uint8Array(hash));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { bytesToHex } = await import("@noble/hashes/utils.js");
  const out = sha256(new TextEncoder().encode(input));
  return bytesToHex(out);
}

export function buildLoanSignatureUrl(token: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/contrato/assinar/${encodeURIComponent(token)}`;
}

export async function createLoanSignatureRequest(
  loanId: string,
  opts?: { contractPdfPath?: string | null },
): Promise<{ token: string; url: string }> {
  const token = randomToken();
  const token_hash = await sha256Hex(token);
  const expires_at = new Date(Date.now() + SIGN_TTL_HOURS * 60 * 60_000).toISOString();

  // Tenta guardar o caminho do PDF no próprio request para o link público conseguir pré-visualizar
  // mesmo se a tabela loans tiver RLS bloqueando SELECT sem login.
  let contract_pdf_path: string | null = String(opts?.contractPdfPath || "").trim() || null;
  if (!contract_pdf_path) {
    try {
      const loan = await supabase.from("loans").select("contract_pdf_path").eq("id", loanId).maybeSingle();
      contract_pdf_path = (loan.data as any)?.contract_pdf_path ?? null;
    } catch {
      contract_pdf_path = null;
    }
  }

  const { error } = await supabase.from("loan_signature_requests").insert([
    {
      loan_id: loanId,
      token_hash,
      expires_at,
      contract_pdf_path,
    },
  ]);
  if (error) throw error;
  return { token, url: buildLoanSignatureUrl(token) };
}

export async function authorizeLoanByToken(input: {
  token: string;
  signerName: string;
  acceptedTerms: boolean;
  signatureDataUrl: string;
}): Promise<{ ok: true; loanId: string } | { ok: false; error: string }> {
  const tok = String(input.token || "").trim();
  if (!tok) return { ok: false, error: "Token inválido" };
  if (!input.acceptedTerms) return { ok: false, error: "É necessário aceitar os termos" };
  const signer = String(input.signerName || "").trim();
  if (!signer) return { ok: false, error: "Informe seu nome completo" };
  const sig = String(input.signatureDataUrl || "").trim();
  if (!sig.startsWith("data:image/")) return { ok: false, error: "Assinatura inválida" };

  const token_hash = await sha256Hex(tok);
  const { data, error } = await supabase
    .from("loan_signature_requests")
    .select("id, loan_id, expires_at, used_at")
    .eq("token_hash", token_hash)
    .maybeSingle();
  if (error) return { ok: false, error: "Erro ao validar token" };
  if (!data) return { ok: false, error: "Link inválido ou expirado" };
  if (data.used_at) return { ok: false, error: "Este link já foi usado" };
  const exp = new Date(String(data.expires_at || ""));
  if (!Number.isFinite(exp.getTime()) || exp.getTime() < Date.now()) return { ok: false, error: "Link expirado" };

  const loanId = String((data as any).loan_id);
  const reqId = String((data as any).id);

  const used_at = new Date().toISOString();
  const upd1 = await supabase
    .from("loan_signature_requests")
    .update({
      used_at,
      accepted_terms: true,
      signer_name: signer,
      signature_data_url: sig,
    })
    .eq("id", reqId);
  if (upd1.error) return { ok: false, error: "Erro ao salvar assinatura" };

  const upd2 = await supabase
    .from("loans")
    .update({ is_authorized: true, authorized_at: used_at })
    .eq("id", loanId);
  if (upd2.error) return { ok: false, error: "Erro ao autorizar empréstimo" };

  return { ok: true, loanId };
}

export async function fetchLoanContractPreviewUrlByToken(input: {
  token: string;
}): Promise<{ ok: true; url: string; loanId: string } | { ok: false; error: string }> {
  const tok = String(input.token || "").trim();
  if (!tok) return { ok: false, error: "Token inválido" };

  const token_hash = await sha256Hex(tok);
  const { data, error } = await supabase
    .from("loan_signature_requests")
    .select("loan_id, expires_at, used_at, contract_pdf_path")
    .eq("token_hash", token_hash)
    .maybeSingle();
  if (error) return { ok: false, error: "Erro ao validar token" };
  if (!data) return { ok: false, error: "Link inválido ou expirado" };
  if (data.used_at) return { ok: false, error: "Este link já foi usado" };
  const exp = new Date(String(data.expires_at || ""));
  if (!Number.isFinite(exp.getTime()) || exp.getTime() < Date.now()) return { ok: false, error: "Link expirado" };

  const loanId = String((data as any).loan_id);
  const path = String((data as any)?.contract_pdf_path || "");
  if (!path) return { ok: false, error: "Contrato não disponível" };

  const bucket = "contratos";
  const signed = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 15);
  if (signed.error) {
    // fallback: se o bucket estiver público, usa URL pública
    const pub = supabase.storage.from(bucket).getPublicUrl(path);
    const pubUrl = String((pub as any)?.data?.publicUrl || "");
    if (pubUrl) return { ok: true, url: pubUrl, loanId };
    return { ok: false, error: signed.error.message || "Erro ao gerar preview do contrato" };
  }
  const url = String(signed.data?.signedUrl || "");
  if (!url) return { ok: false, error: "Preview indisponível" };

  return { ok: true, url, loanId };
}

