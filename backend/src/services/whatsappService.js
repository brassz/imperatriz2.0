import { getEnv } from "../lib/env.js";
import { getEvolutionApiKey } from "../lib/evolutionKeys.js";

function normalizePhoneToEvolution(numberDigits) {
  const digits = String(numberDigits || "").replace(/\D/g, "");
  if (!digits) return "";
  // If missing country code, assume BR (55)
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export async function sendMessage(phone, text, { instanceId }) {
  const env = getEnv();
  const base = env.EVOLUTION_BASE_URL.replace(/\/+$/, "");
  const url = `${base}/message/sendText/${encodeURIComponent(instanceId)}`;

  const number = normalizePhoneToEvolution(phone);
  if (!number) throw new Error("Missing phone");

  const apikey = getEvolutionApiKey(instanceId);
  if (!apikey) {
    throw new Error(`Sem API key para a instância "${instanceId}". Configure EVOLUTION_KEYS_JSON ou EVOLUTION_API_KEY.`);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      number,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Evolution send failed (${res.status}): ${body}`.slice(0, 500));
  }

  return await res.json().catch(() => ({}));
}

