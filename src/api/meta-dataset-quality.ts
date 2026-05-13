export type MetaDatasetQualityResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status?: number };

/**
 * Dataset Quality da Meta não tem endpoint estável/documentado em todos os ambientes.
 * Mantemos o caminho configurável e tratamos falhas com mensagens legíveis.
 */
export async function fetchMetaDatasetQuality(): Promise<MetaDatasetQualityResult> {
  const datasetId = String(import.meta.env.VITE_META_DATASET_ID || "").trim();
  const token = String(import.meta.env.VITE_META_DATASET_QUALITY_TOKEN || "").trim();
  const version = String(import.meta.env.VITE_META_GRAPH_VERSION || "v20.0").trim();
  // Dataset Quality API usa o endpoint fixo `/dataset_quality` com query param `dataset_id`.
  // Docs: GET /{version}/dataset_quality?dataset_id=...&fields=...
  const endpoint = "dataset_quality";
  const fields =
    String(import.meta.env.VITE_META_DATASET_QUALITY_FIELDS || "").trim()
    || "web{event_match_quality,event_name}";
  const agentName = String(import.meta.env.VITE_META_DATASET_QUALITY_AGENT_NAME || "").trim();
  // legado: algumas configs antigas colocavam "dataset_quality" aqui — mantemos sem efeito.
  void String(import.meta.env.VITE_META_DATASET_QUALITY_ENDPOINT || "");

  if (!datasetId || !token) {
    return { ok: false, error: "Meta Dataset Quality não configurado (VITE_META_DATASET_ID / VITE_META_DATASET_QUALITY_TOKEN)." };
  }

  const qs = new URLSearchParams();
  qs.set("dataset_id", datasetId);
  qs.set("access_token", token);
  if (agentName) qs.set("agent_name", agentName);
  if (fields) qs.set("fields", fields);

  const url = `https://graph.facebook.com/${encodeURIComponent(version)}/${endpoint}?${qs.toString()}`;

  try {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // mantém texto cru
    }
    if (!res.ok) {
      const msg =
        data && typeof data === "object" && data != null && "error" in data
          ? JSON.stringify((data as any).error)
          : typeof data === "string"
            ? data
            : "Erro ao consultar Meta";
      return { ok: false, error: msg, status: res.status };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao consultar Meta" };
  }
}

