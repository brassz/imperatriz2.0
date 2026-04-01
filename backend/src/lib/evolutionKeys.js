/**
 * Chaves Evolution por instância (header apikey).
 * Podem ser sobrescritas por EVOLUTION_KEYS_JSON no .env (mesmo formato de objeto).
 */

const DEFAULT_INSTANCE_KEYS = {
  omnibot2: "47D7D2601B26-4433-A14E-19C9C521E405",
  omni2: "47D7D2601B26-4433-A14E-19C9C521E405",
  douglas: "C90BA26A8886-42A1-88CA-32876067F1D2",
  vinicius: "142CE646BFB4-49A2-9BB5-D775F2B4FD22",
};

export function normalizeEvolutionInstanceId(instanceId) {
  const id = String(instanceId || "")
    .trim()
    .toLowerCase();
  if (id === "omni2" || id === "omnibot") return "omnibot2";
  return id;
}

export function getEvolutionApiKey(instanceId) {
  const norm = normalizeEvolutionInstanceId(instanceId);
  let merged = { ...DEFAULT_INSTANCE_KEYS };
  const raw = process.env.EVOLUTION_KEYS_JSON;
  if (raw && String(raw).trim()) {
    try {
      const parsed = JSON.parse(String(raw).trim());
      if (parsed && typeof parsed === "object") merged = { ...merged, ...parsed };
    } catch {
      // ignore invalid JSON; defaults still apply
    }
  }
  const fromMap = merged[norm] || merged[instanceId];
  if (fromMap) return String(fromMap);
  const legacy = process.env.EVOLUTION_API_KEY;
  return legacy ? String(legacy) : "";
}
