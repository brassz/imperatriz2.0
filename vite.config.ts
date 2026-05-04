import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { componentTagger } from "lovable-tagger";

const CPFA_HOST = "api.infoseekdata.com.br";
const CPFA_PATH_DEFAULT = "/api/validate/cpf";

function cpfaUpstreamJsonField(env: Record<string, string>): string {
  const f = String(env.CPFA_JSON_FIELD || env.VITE_CPFA_JSON_FIELD || "value").trim();
  return f || "value";
}

/** Caminho após o host (ex.: `/api/validate/cpf`). Só aceita rotas `/api/validate/…` por segurança. */
function cpfaValidatePathFromEnv(env: Record<string, string>): string {
  const raw = String(env.CPFA_VALIDATE_PATH || env.VITE_CPFA_VALIDATE_PATH || CPFA_PATH_DEFAULT).trim();
  const p = raw.startsWith("/") ? raw : `/${raw}`;
  if (!/^\/api\/validate\/[\w-]+$/.test(p)) return CPFA_PATH_DEFAULT;
  return p;
}

function cpfaCpfFormattedFlag(env: Record<string, string>): boolean {
  const v = String(env.CPFA_CPF_FORMATTED || env.VITE_CPFA_CPF_FORMATTED || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function cpfaPayloadCpfString(digits: string, formatted: boolean): string {
  if (!formatted || digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function buildCpfaUpstreamBody(digits: string, field: string, formatted: boolean): string {
  const k = String(field || "value").trim() || "value";
  const value = cpfaPayloadCpfString(digits, formatted);
  return JSON.stringify({ [k]: value });
}

function extractCpfaDigitsFromClientBody(parsed: Record<string, unknown>, jsonField: string): string {
  const fromKey = parsed[jsonField];
  const s = String(parsed.value ?? parsed.cpf ?? parsed.document ?? fromKey ?? "").replace(/\D/g, "");
  return s;
}

/**
 * Middleware no dev que repassa POST /api/cpf-consult → API externa (evita CORS no browser).
 * Implementação explícita em vez de só `server.proxy`, para reduzir conflito com outros middlewares.
 */
function cpfaDevProxyPlugin(
  apiKey: string,
  upstreamJsonField: string,
  upstreamPath: string,
  sendFormattedCpf: boolean,
): Plugin {
  return {
    name: "cpfa-dev-proxy",
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const pathname = (req.url ?? "").split("?")[0] ?? "";
        if (pathname !== "/api/cpf-consult") {
          next();
          return;
        }

        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST, OPTIONS");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Método não permitido. Use POST." }));
          return;
        }

        if (!apiKey) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: "Configure INFOSEEK_API_KEY ou VITE_INFOSEEK_API_KEY no .env e reinicie o dev server.",
            }),
          );
          return;
        }

        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        req.on("error", (err) => {
          if (res.headersSent) return;
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err.message }));
        });
        req.on("end", () => {
          let outbound: string;
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            let parsed: Record<string, unknown>;
            try {
              parsed = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "JSON inválido" }));
              return;
            }
            const digits = extractCpfaDigitsFromClientBody(parsed, upstreamJsonField);
            if (digits.length !== 11) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "CPF deve ter 11 dígitos" }));
              return;
            }
            outbound = buildCpfaUpstreamBody(digits, upstreamJsonField, sendFormattedCpf);
          } catch (e) {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }));
            }
            return;
          }

          const proxyReq = https.request(
            {
              hostname: CPFA_HOST,
              path: upstreamPath,
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Content-Length": String(Buffer.byteLength(outbound, "utf8")),
                "X-API-Key": apiKey,
              },
            },
            (proxyRes) => {
              const bufs: Buffer[] = [];
              proxyRes.on("data", (b: Buffer) => bufs.push(Buffer.from(b)));
              proxyRes.on("end", () => {
                const out = Buffer.concat(bufs);
                const code = proxyRes.statusCode ?? 502;
                if (code >= 400) {
                  const snip = out.toString("utf8").slice(0, 800);
                  console.error("[cpfa-dev-proxy] upstream", code, snip || "(corpo vazio)");
                }
                res.statusCode = code;
                const ct = proxyRes.headers["content-type"];
                if (ct) res.setHeader("Content-Type", Array.isArray(ct) ? ct[0] : ct);
                res.end(out);
              });
              proxyRes.on("error", (err) => {
                if (res.headersSent) return;
                res.statusCode = 502;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: err.message }));
              });
            },
          );
          proxyReq.on("error", (err) => {
            if (res.headersSent) return;
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err.message }));
          });
          proxyReq.write(outbound);
          proxyReq.end();
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const cpfaApiKey = String(env.INFOSEEK_API_KEY || env.VITE_INFOSEEK_API_KEY || "").trim();
  const cpfaJsonField = cpfaUpstreamJsonField(env);
  const cpfaPath = cpfaValidatePathFromEnv(env);
  const cpfaFormatted = cpfaCpfFormattedFlag(env);

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      cpfaDevProxyPlugin(cpfaApiKey, cpfaJsonField, cpfaPath, cpfaFormatted),
      react(),
      mode === "development" && componentTagger(),
    ].filter(Boolean) as Plugin[],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
