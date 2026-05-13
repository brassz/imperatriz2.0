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
export type EvolutionChatItem = {
  id: string;
  remoteJid: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  updatedAt: number;
  updatedAtLabel: string;
  lastMessageText: string;
  raw: unknown;
};
export type EvolutionMessageItem = {
  id: string;
  remoteJid: string;
  fromMe: boolean;
  text: string;
  messageType: string;
  timestamp: number;
  timestampLabel: string;
  status: string;
  pushName: string;
  raw: unknown;
};

function extractTextFromMessage(message: any): string {
  if (!message || typeof message !== "object") return "";
  if (typeof message.conversation === "string") return message.conversation;
  if (typeof message.extendedTextMessage?.text === "string") return message.extendedTextMessage.text;
  if (typeof message.imageMessage?.caption === "string") return message.imageMessage.caption;
  if (typeof message.videoMessage?.caption === "string") return message.videoMessage.caption;
  if (typeof message.documentMessage?.caption === "string") return message.documentMessage.caption;
  if (typeof message.buttonsResponseMessage?.selectedDisplayText === "string") {
    return message.buttonsResponseMessage.selectedDisplayText;
  }
  if (typeof message.listResponseMessage?.title === "string") return message.listResponseMessage.title;
  if (message.audioMessage) return "[Áudio]";
  if (message.imageMessage) return "[Imagem]";
  if (message.videoMessage) return "[Vídeo]";
  if (message.documentMessage) return "[Documento]";
  if (message.stickerMessage) return "[Sticker]";
  return "";
}

function collectArrayCandidates(data: any, depth = 0, seen = new WeakSet<object>()): any[][] {
  if (depth > 5 || data == null) return [];
  if (Array.isArray(data)) return [data];
  if (typeof data !== "object") return [];
  if (seen.has(data)) return [];
  seen.add(data);

  const directKeys = [
    "data",
    "chats",
    "messages",
    "result",
    "response",
    "records",
    "rows",
    "items",
    "results",
  ];
  const out: any[][] = [];

  for (const key of directKeys) {
    if (Array.isArray((data as any)?.[key])) {
      out.push((data as any)[key]);
    }
  }

  const values = Object.values(data);
  for (const value of values) {
    out.push(...collectArrayCandidates(value, depth + 1, seen));
  }

  if (out.length === 0 && values.length > 0 && values.every((value) => value && typeof value === "object")) {
    out.push(values);
  }
  return out;
}

function unwrapArrayPayload(data: any): any[] {
  const candidates = collectArrayCandidates(data);
  if (candidates.length === 0) return [];
  return [...candidates].sort((a, b) => b.length - a.length)[0];
}

function buildRemoteJidCandidates(remoteJid: string): string[] {
  const base = String(remoteJid || "").trim();
  if (!base) return [];
  const digits = base.replace(/\D/g, "");
  const out = new Set<string>([base]);
  if (digits) {
    out.add(`${digits}@s.whatsapp.net`);
    out.add(`${digits}@lid`);
  }
  if (base.includes(":") && base.includes("@")) {
    out.add(base.replace(/:\d+(?=@)/, ""));
  }
  return Array.from(out).filter(Boolean);
}

function normalizeRemoteJidForMatch(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const cleaned = raw.replace(/:\d+(?=@)/, "");
  const [local = "", domain = ""] = cleaned.split("@");
  if (domain === "g.us") return `${local}@g.us`;
  const digits = local.replace(/\D/g, "");
  return digits || local;
}

function matchesRemoteJid(targetRemoteJid: string, rowRemoteJid: unknown): boolean {
  const rowNorm = normalizeRemoteJidForMatch(rowRemoteJid);
  if (!rowNorm) return false;
  const targets = buildRemoteJidCandidates(targetRemoteJid).map(normalizeRemoteJidForMatch);
  return targets.includes(rowNorm);
}

function parseTimestamp(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  }
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) {
    return num < 1_000_000_000_000 ? num * 1000 : num;
  }
  const asDate = new Date(String(raw || "")).getTime();
  return Number.isFinite(asDate) ? asDate : 0;
}

function formatTimestampLabel(timestamp: number): string {
  if (!timestamp) return "—";
  try {
    return new Date(timestamp).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

async function evolutionRequestJson<T>(
  path: string,
  opts: { instance?: string; apiKey?: string; baseUrl?: string; method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const { baseUrl: cfgBase, apiKey: cfgKey, instance: cfgInstance } = getEvolutionConfig();
  const instance = String(opts.instance || cfgInstance || "").trim();
  const apiKey = String(opts.apiKey || cfgKey || "").trim();
  if (!instance) throw new Error("Instância não informada");
  if (!apiKey) throw new Error("API key não informada");
  const base = normalizeBaseUrl(opts.baseUrl || cfgBase);
  assertNoMixedContent(base);

  const res = await fetch(`${base}${path.replace(":instance", encodeURIComponent(instance))}`, {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  return (await parseJsonSafe(res)) as T;
}

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

/**
 * Mesmo endpoint do `fetchConnectionState`, mas para uma instância específica.
 * Útil para mostrar ✓/✕ no seletor sem depender da instância atualmente selecionada.
 */
export async function fetchConnectionStateForInstance(opts: {
  instance: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<ConnectionStateResult> {
  const { baseUrl: cfgBase } = getEvolutionConfig();
  const instance = String(opts.instance || "").trim();
  const apiKey = String(opts.apiKey || "").trim();
  if (!instance) return { ok: false, error: "Instância não informada" };
  if (!apiKey) return { ok: false, error: "API key não informada" };
  const base = normalizeBaseUrl(opts.baseUrl || cfgBase);
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
  return fetchEvolutionQrCodeForInstance({ instance, apiKey, baseUrl });
}

/**
 * Busca QR para uma instância específica (usa a seleção atual da UI).
 * Evita desencontro quando o usuário troca instância na tela e ainda não clicou em salvar.
 */
export async function fetchEvolutionQrCodeForInstance(opts: {
  instance: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<EvolutionQrResult> {
  const { baseUrl: cfgBase } = getEvolutionConfig();
  const instance = String(opts.instance || "").trim();
  const apiKey = String(opts.apiKey || "").trim();
  if (!instance) return { ok: false, error: "Instância não informada" };
  if (!apiKey) return { ok: false, error: "API key não informada" };
  const base = normalizeBaseUrl(opts.baseUrl || cfgBase);
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

/**
 * Envia texto pela Evolution usando instância + apiKey informados (bypassa config do usuário).
 * Usado para login via token (instância "nexuslogin").
 */
export async function sendWhatsAppTextWithInstance(
  number: string,
  text: string,
  opts: { instance: string; apiKey: string; baseUrl?: string }
): Promise<{ ok: boolean; error?: string }> {
  const num = normalizePhone(number);
  const base = normalizeBaseUrl(opts.baseUrl || getEvolutionConfig().baseUrl);
  try {
    assertNoMixedContent(base);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Configuração inválida" };
  }
  const instance = String(opts.instance || "").trim();
  const apiKey = String(opts.apiKey || "").trim();
  if (!instance) return { ok: false, error: "Instância não informada" };
  if (!apiKey) return { ok: false, error: "API key não informada" };
  const url = `${base}/message/sendText/${encodeURIComponent(instance)}`;

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

export async function fetchEvolutionChatsForInstance(opts: {
  instance: string;
  apiKey: string;
  baseUrl?: string;
  limit?: number;
  offset?: number;
}): Promise<EvolutionChatItem[]> {
  const data = await evolutionRequestJson<unknown>("/chat/findChats/:instance", {
    instance: opts.instance,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    method: "POST",
    body: {
      limit: opts.limit ?? 80,
      offset: opts.offset ?? 0,
    },
  });

  return unwrapArrayPayload(data)
    .map((row: any) => {
      const remoteJid = String(
        row?.remoteJid || row?.id || row?.jid || row?.key?.remoteJid || row?.contact?.id || "",
      ).trim();
      if (!remoteJid) return null;
      const updatedAt = parseTimestamp(
        row?.updatedAt || row?.conversationTimestamp || row?.lastMessageTimestamp || row?.messageTimestamp || row?.createdAt,
      );
      const lastMessageText = String(
        row?.lastMessageText ||
          row?.conversation ||
          extractTextFromMessage(row?.lastMessage?.message || row?.lastMessage || row?.message) ||
          "",
      ).trim();
      return {
        id: String(row?.id || remoteJid),
        remoteJid,
        name: String(row?.name || row?.pushName || row?.contactName || row?.contact?.name || "").trim() || remoteJid,
        isGroup: remoteJid.endsWith("@g.us") || Boolean(row?.isGroup),
        unreadCount: Number(row?.unreadCount || row?.unreadMessages || 0) || 0,
        updatedAt,
        updatedAtLabel: formatTimestampLabel(updatedAt),
        lastMessageText: lastMessageText || "Sem mensagem visível",
        raw: row,
      } satisfies EvolutionChatItem;
    })
    .filter((row): row is EvolutionChatItem => row !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function fetchEvolutionMessagesForChat(opts: {
  instance: string;
  apiKey: string;
  remoteJid: string;
  baseUrl?: string;
}): Promise<EvolutionMessageItem[]> {
  const payloads = await Promise.all(
    buildRemoteJidCandidates(opts.remoteJid).flatMap((jid) => [
      evolutionRequestJson<unknown>("/chat/findMessages/:instance", {
        instance: opts.instance,
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        method: "POST",
        body: {
          where: {
            key: {
              remoteJid: jid,
            },
          },
        },
      }).catch(() => null),
      evolutionRequestJson<unknown>("/chat/findMessages/:instance", {
        instance: opts.instance,
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        method: "POST",
        body: {
          where: {
            remoteJid: jid,
          },
        },
      }).catch(() => null),
    ]),
  );

  const rows = payloads.flatMap((payload) => unwrapArrayPayload(payload));
  const deduped = new Map<string, EvolutionMessageItem>();

  for (const row of rows) {
    const remoteJid = String((row as any)?.key?.remoteJid || (row as any)?.remoteJid || "").trim();
    if (!matchesRemoteJid(opts.remoteJid, remoteJid)) {
      continue;
    }
    const timestamp = parseTimestamp((row as any)?.messageTimestamp || (row as any)?.timestamp || (row as any)?.createdAt || (row as any)?.updatedAt);
    const id =
      String((row as any)?.key?.id || (row as any)?.id || "").trim() ||
      `${opts.remoteJid}-${timestamp}-${String((row as any)?.messageType || (row as any)?.type || "msg")}`;
    const text = String(extractTextFromMessage((row as any)?.message || row) || "").trim() || "[Mensagem não textual]";
    deduped.set(id, {
      id,
      remoteJid: remoteJid || opts.remoteJid,
      fromMe: Boolean((row as any)?.key?.fromMe || (row as any)?.fromMe),
      text,
      messageType: String((row as any)?.messageType || (row as any)?.type || "unknown"),
      timestamp,
      timestampLabel: formatTimestampLabel(timestamp),
      status: String((row as any)?.status || (row as any)?.messageStatus || ""),
      pushName: String((row as any)?.pushName || ""),
      raw: row,
    });
  }

  return Array.from(deduped.values()).sort((a, b) => a.timestamp - b.timestamp);
}
