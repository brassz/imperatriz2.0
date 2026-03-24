import { getEvolutionConfig } from "@/lib/evolution-settings";

function normalizeBaseUrl(input: string): string {
  const url = String(input || "").trim().replace(/\/$/, "");
  if (!url) return url;

  // Se não tiver esquema, adiciona um para evitar "URL scheme not supported"
  if (!/^https?:\/\//i.test(url)) {
    const proto = typeof window !== "undefined" ? window.location.protocol : "https:";
    return `${proto}//${url}`;
  }
  return url;
}

function assertNoMixedContent(baseUrl: string) {
  if (typeof window === "undefined") return;
  if (window.location.protocol === "https:" && /^http:\/\//i.test(baseUrl)) {
    throw new Error(
      "A Evolution API está configurada com HTTP, mas o site está em HTTPS. O navegador bloqueia (mixed content). " +
      "Use uma URL HTTPS (recomendado via proxy/reverse-proxy) ou rode o sistema em HTTP no ambiente local."
    );
  }
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.trim().startsWith("<")) {
    throw new Error("Servidor retornou HTML em vez de JSON. Verifique a URL da Evolution API e se está acessível por HTTPS.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Resposta inválida do servidor (não é JSON)");
  }
}

export type EvolutionQrResult = { ok: true; code: string; pairingCode?: string } | { ok: false; error: string };

export type ConnectionStateResult = { ok: true; connected: boolean } | { ok: false; error: string };

export async function fetchConnectionState(): Promise<ConnectionStateResult> {
  const { baseUrl, apiKey, instance } = getEvolutionConfig();
  if (!instance?.trim()) return { ok: false, error: "Instância não configurada" };
  const base = normalizeBaseUrl(baseUrl);
  try {
    assertNoMixedContent(base);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Configuração inválida" };
  }
  const url = `${base}/instance/connectionState/${encodeURIComponent(instance)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { apikey: apiKey },
    });

    if (res.status === 404) return { ok: false, error: "Instância não encontrada" };
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err || `HTTP ${res.status}` };
    }

    const data = (await parseJsonSafe(res)) as { instance?: { state?: string } };
    const state = data?.instance?.state;
    return { ok: true, connected: state === "open" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro de conexão" };
  }
}

export async function fetchEvolutionQrCode(): Promise<EvolutionQrResult> {
  const { baseUrl, apiKey, instance } = getEvolutionConfig();
  if (!instance?.trim()) return { ok: false, error: "Instância não configurada" };
  const base = normalizeBaseUrl(baseUrl);
  try {
    assertNoMixedContent(base);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Configuração inválida" };
  }
  const url = `${base}/instance/connect/${encodeURIComponent(instance)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { apikey: apiKey },
    });

    if (res.status === 404) return { ok: false, error: "Instância não encontrada" };
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err || `HTTP ${res.status}` };
    }

    const data = (await parseJsonSafe(res)) as { code?: string; pairingCode?: string };
    const code = data?.code;
    if (!code || typeof code !== "string") return { ok: false, error: "Resposta inválida (sem code)" };
    return { ok: true, code, pairingCode: data.pairingCode };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro de conexão" };
  }
}

export function getQrImageUrl(code: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(code)}`;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("55") ? digits : "55" + digits;
}

export function buildWhatsAppLink(phone: string, text: string): string {
  const num = normalizePhone(phone);
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

export type SendResult = { ok: boolean; via: "api" | "link"; error?: string };

/**
 * Envia mensagem via Evolution API se conectada, senão abre wa.me.
 */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<SendResult> {
  const state = await fetchConnectionState();
  if (state.ok && state.connected) {
    const res = await sendWhatsAppText(phone, text);
    if (res.ok) return { ok: true, via: "api" };
    window.open(buildWhatsAppLink(phone, text), "_blank");
    return { ok: true, via: "link" };
  }
  window.open(buildWhatsAppLink(phone, text), "_blank");
  return { ok: true, via: "link" };
}

/**
 * Envia PDF (ou outro documento) em base64 puro via Evolution API.
 * @see https://doc.evolution-api.com/v2/api-reference/message-controller/send-media
 */
export async function sendWhatsAppDocument(
  number: string,
  opts: { base64: string; fileName: string; caption?: string },
): Promise<{ ok: boolean; error?: string }> {
  const { baseUrl, apiKey, instance } = getEvolutionConfig();
  const num = normalizePhone(number);
  const base = normalizeBaseUrl(baseUrl);
  try {
    assertNoMixedContent(base);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Configuração inválida" };
  }
  const url = `${base}/message/sendMedia/${encodeURIComponent(instance)}`;
  const fileName = opts.fileName?.trim() || "documento.pdf";
  const body: Record<string, string> = {
    number: num,
    mediatype: "document",
    mimetype: "application/pdf",
    media: opts.base64,
    fileName,
    caption: opts.caption ?? "",
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro de conexão" };
  }
}

/**
 * Envia colinha + PDF. Se não estiver conectado à API, abre wa.me com o texto (PDF já deve ter sido baixado).
 */
export async function sendWhatsAppComprovante(
  phone: string,
  caption: string,
  pdfBase64: string,
  fileName: string,
): Promise<SendResult> {
  const state = await fetchConnectionState();
  if (state.ok && state.connected) {
    const res = await sendWhatsAppDocument(phone, {
      base64: pdfBase64,
      fileName,
      caption,
    });
    if (res.ok) return { ok: true, via: "api" };
    window.open(
      buildWhatsAppLink(
        phone,
        `${caption}\n\n(Baixe o PDF gerado neste computador e anexe na conversa, se necessário.)`,
      ),
      "_blank",
    );
    return { ok: true, via: "link" };
  }
  window.open(
    buildWhatsAppLink(
      phone,
      `${caption}\n\n(Baixe o PDF gerado neste computador e anexe na conversa, se necessário.)`,
    ),
    "_blank",
  );
  return { ok: true, via: "link" };
}

export async function sendWhatsAppText(number: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const { baseUrl, apiKey, instance } = getEvolutionConfig();
  const num = normalizePhone(number);
  const base = normalizeBaseUrl(baseUrl);
  try {
    assertNoMixedContent(base);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Configuração inválida" };
  }
  const url = `${base}/message/sendText/${instance}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({ number: num, text }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro de conexão" };
  }
}
