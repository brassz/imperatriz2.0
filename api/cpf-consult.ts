import type { VercelRequest, VercelResponse } from "@vercel/node";

const UPSTREAM = "https://api.infoseekdata.com.br/api/validate/cpf";

/**
 * Proxy server-side para consulta por CPF (produção na Vercel).
 * Chave: INFOSEEK_API_KEY (recomendado) ou VITE_INFOSEEK_API_KEY no painel Environment Variables.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).setHeader("Allow", "POST, OPTIONS").json({ error: "Use POST" });
  }

  const key = String(process.env.INFOSEEK_API_KEY || process.env.VITE_INFOSEEK_API_KEY || "").trim();
  if (!key) {
    return res.status(503).json({
      error:
        "Configure INFOSEEK_API_KEY nas variáveis de ambiente do projeto na Vercel (Settings → Environment Variables).",
    });
  }

  let value: unknown;
  const raw = req.body;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw).value;
    } catch {
      return res.status(400).json({ error: "JSON inválido" });
    }
  } else if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) {
    value = (raw as { value?: unknown }).value;
  } else {
    return res.status(400).json({ error: "Corpo inválido" });
  }

  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 11) {
    return res.status(400).json({ error: "CPF deve ter 11 dígitos" });
  }

  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": key,
    },
    body: JSON.stringify({ value: digits }),
  });

  const text = await upstream.text();
  const ct = upstream.headers.get("content-type") || "application/json";
  res.status(upstream.status).setHeader("Content-Type", ct);
  res.send(text);
}
