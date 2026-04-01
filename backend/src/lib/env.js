import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4010),
  NODE_ENV: z.string().optional(),
  AUTO_SCHEDULES_FILE: z.string().default("./auto-schedules.json"),
  SUPABASE_COMPANIES_JSON: z.string(),
  EVOLUTION_BASE_URL: z.string().url(),
  /** Fallback único; preferir chaves por instância (evolutionKeys.js / EVOLUTION_KEYS_JSON). */
  EVOLUTION_API_KEY: z.string().optional(),
  /** JSON opcional: {"omnibot2":"...","vinicius":"...","douglas":"..."} */
  EVOLUTION_KEYS_JSON: z.string().optional(),
  FINE_PER_DAY: z.coerce.number().default(50),
  PIX_BANK: z.string().optional(),
  PIX_HOLDER: z.string().optional(),
  PIX_KEY: z.string().optional(),
  FRONTEND_ORIGIN: z.string().optional(),
});

export function getEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid backend env:\n${msg}`);
  }
  return parsed.data;
}

export function parseCompaniesJson(raw) {
  let value = raw;
  if (typeof value !== "string" || !value.trim()) return [];
  value = value.trim();
  const jsonStart = value.indexOf("[");
  const jsonEnd = value.lastIndexOf("]");
  if (jsonStart >= 0 && jsonEnd > jsonStart) value = value.slice(jsonStart, jsonEnd + 1);

  const arr = JSON.parse(value);
  const CompanySchema = z.object({
    company: z.enum(["franca", "litoral", "mogiana", "imperatriz"]),
    url: z.string().url(),
    key: z.string().min(1),
  });
  return z.array(CompanySchema).parse(arr);
}

