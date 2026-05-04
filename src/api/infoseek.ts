/** Resposta normalizada da consulta por CPF (campos usados na UI). */
export type InfoseekConsultResult = {
  success: true;
  nome: string;
  cpf: string;
  nascimento?: string;
  nomeMae?: string;
  renda?: string;
  emails: Array<{ email: string; scoreLabel?: string }>;
  telefones: Array<{ telefone: string; classificacao?: string }>;
  enderecos: Array<Record<string, string>>;
  /** Demais campos do cadastro (API) com rótulos amigáveis, sem duplicar o que já vai no resumo/endereço. */
  cadastroExtras: Array<{ key: string; label: string; value: string }>;
  scoreNumeric: number | null;
  scoreLabel: string | null;
};

export type InfoseekConsultError = {
  success: false;
  error: string;
};

function cpfaRequestBodyJson(cpfDigits: string): string {
  const k = String(import.meta.env.VITE_CPFA_JSON_FIELD || "value").trim() || "value";
  return JSON.stringify({ [k]: cpfDigits });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function formatCpfHint(digits: string): string {
  const x = String(digits || "").replace(/\D/g, "");
  if (x.length !== 11) return x;
  return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
}

/** Mensagem amigável quando o proxy retorna JSON de erro (vários formatos comuns). */
export function parseUpstreamErrorMessage(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  for (const k of ["error", "message", "detail", "msg", "descricao", "mensagem"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Normaliza chave para lookup de rótulo (minúsculas, sem underscore). */
function normFieldKey(k: string): string {
  return k
    .toLowerCase()
    .replace(/_/g, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Título amigável para campos comuns da Infoseek / painel (chaves camelCase ou MAIÚSCULAS).
 */
export function infoseekFieldTitle(key: string): string {
  const n = normFieldKey(key);
  const map: Record<string, string> = {
    municipionasci: "Município de nascimento",
    municipionascimento: "Município de nascimento",
    naturalidade: "Naturalidade",
    enderecomuni: "Município (endereço)",
    enderecologr: "Logradouro",
    endereconu: "Número",
    enderecoba: "Bairro",
    enderecoce: "CEP",
    enderecouf: "UF (endereço)",
    enderecocomplemento: "Complemento",
    enderecotipo: "Tipo de endereço",
    rgnumero: "Número do RG",
    rgorgaoemi: "Órgão emissor (RG)",
    rguf: "UF (RG)",
    rgdataemissao: "Data de emissão (RG)",
    telefone: "Telefone",
    celular: "Celular",
    cns: "CNS",
    tituloeleitor: "Título de eleitor",
    pis: "PIS",
    nis: "NIS",
    escolaridade: "Escolaridade",
    estadocivil: "Estado civil",
    sexo: "Sexo",
    nacionalidade: "Nacionalidade",
    profissao: "Profissão",
    rendaestimada: "Renda estimada",
    nomepai: "Nome do pai",
    nomesocial: "Nome social",
    obito: "Óbito",
    datanascimento: "Data de nascimento",
    uf: "UF",
    pais: "País",
  };
  if (map[n]) return map[n];
  if (n.startsWith("endereco") && n.length > 8) {
    const tail = n.slice("endereco".length);
    const tailMap: Record<string, string> = {
      muni: "Município",
      logr: "Logradouro",
      nu: "Número",
      ba: "Bairro",
      ce: "CEP",
      uf: "UF",
      complemento: "Complemento",
      tipo: "Tipo",
    };
    if (tailMap[tail]) return `${tailMap[tail]} (endereço)`;
  }
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function formatInfoseekScalar(fieldKey: string, v: unknown): string {
  if (v == null) return "";
  const nk = normFieldKey(fieldKey);
  if (typeof v === "number" && Number.isFinite(v)) {
    if ((nk.includes("data") || nk.includes("emissao") || nk.includes("emis")) && v > 1e11 && v < 1e14) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("pt-BR");
    }
    return String(v);
  }
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

const LEGACY_LABEL_TO_POINTS: Record<string, number> = {
  OTIMO: 92,
  EXCELENTE: 92,
  BOM: 72,
  BOA: 72,
  REGULAR: 52,
  MEDIO: 52,
  RUIM: 32,
  BAIXO: 32,
  PESSIMO: 22,
};

function parseScoreNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractSerasaScore(data: Record<string, unknown>): { numeric: number | null; label: string | null } {
  const readFromObject = (o: Record<string, unknown>): { numeric: number | null; label: string | null } | null => {
    const scoreKeys = [
      "pontuacao",
      "score",
      "valor",
      "PONTUACAO",
      "SCORE",
      "pontos",
      "pontuacaoSerasa",
      "scoreSerasa",
      "pontuacao_credito",
    ];
    for (const k of scoreKeys) {
      const n = parseScoreNumber(o[k]);
      if (n != null) {
        const lbl =
          String(o.classificacao ?? o.faixa ?? o.descricao ?? o.CLASSIFICACAO ?? o.FAIXA ?? "").trim() || null;
        return { numeric: n, label: lbl };
      }
    }
    return null;
  };

  const top = readFromObject(data);
  if (top?.numeric != null) return top;

  for (const key of Object.keys(data)) {
    if (!/serasa|SERASA|experian|EXPERIAN|credito|CREDITO|score/i.test(key)) continue;
    const v = data[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const r = readFromObject(v as Record<string, unknown>);
      if (r?.numeric != null) return r;
    }
  }

  const dados = data.dadosCPF as Record<string, unknown> | undefined;
  if (dados) {
    const r = readFromObject(dados);
    if (r?.numeric != null) return r;
  }

  return { numeric: null, label: null };
}

function legacyScoreFromEmailLabels(emails: Array<{ scoreLabel?: string }>): { numeric: number | null; label: string | null } {
  let best = -1;
  let label: string | null = null;
  for (const e of emails) {
    const raw = String(e.scoreLabel || "").trim();
    if (!raw) continue;
    const key = raw.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "");
    const n = LEGACY_LABEL_TO_POINTS[key] ?? 0;
    if (n > best) {
      best = n;
      label = raw;
    }
  }
  if (best < 0) return { numeric: null, label: null };
  return { numeric: Math.min(100, Math.max(1, best)), label };
}

function findDadosCpfRecord(o: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!o) return {};
  const nestedKeys = ["dadosCPF", "dados_cpf", "DadosCPF", "cadastro", "pessoa", "pf", "consumer", "dados"];
  for (const k of nestedKeys) {
    const inner = asRecord(o[k]);
    if (
      inner &&
      (inner.CPF != null ||
        inner.cpf != null ||
        inner.NOME != null ||
        inner.nome != null ||
        inner.name != null)
    ) {
      return inner;
    }
  }
  if (o.CPF != null || o.cpf != null || o.NOME != null || o.nome != null || o.name != null) return o;
  return {};
}

function resolveDataRoot(root: Record<string, unknown>): Record<string, unknown> {
  const fromNested =
    asRecord(root.data) ?? asRecord(root.result) ?? asRecord(root.payload) ?? asRecord(root.body);
  if (fromNested && Object.keys(fromNested).length > 0) return fromNested;
  if (root.success !== false && !parseUpstreamErrorMessage(root)) {
    const self = asRecord(root);
    if (self && ("dadosCPF" in self || "emails" in self || "telefones" in self || "cpf" in self || "CPF" in self)) {
      return self;
    }
  }
  return fromNested ?? {};
}

function rowToStrings(row: Record<string, unknown>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    if (typeof v === "object") o[k] = JSON.stringify(v);
    else o[k] = String(v);
  }
  return o;
}

function extractEmailsFlex(data: Record<string, unknown>): Array<{ email: string; scoreLabel?: string }> {
  const raw = data.emails ?? data.EMAILS ?? data.email_list ?? data.Email;
  const out: Array<{ email: string; scoreLabel?: string }> = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item == null) continue;
      if (typeof item === "string") {
        if (item.trim()) out.push({ email: item.trim() });
        continue;
      }
      if (typeof item !== "object") continue;
      const e = item as Record<string, unknown>;
      const email = String(e.EMAIL ?? e.email ?? e.Email ?? e.value ?? e.endereco ?? "").trim();
      if (!email) continue;
      const scoreLabel =
        e.EMAIL_SCORE != null
          ? String(e.EMAIL_SCORE)
          : e.email_score != null
            ? String(e.email_score)
            : e.score != null
              ? String(e.score)
              : undefined;
      out.push({ email, scoreLabel });
    }
  }
  const single = data.email ?? data.EMAIL ?? data.Email;
  if (typeof single === "string" && single.trim()) out.push({ email: single.trim() });
  return out;
}

function extractTelefonesFlex(data: Record<string, unknown>, d: Record<string, unknown>): Array<{ telefone: string; classificacao?: string }> {
  const raw =
    data.telefones ??
    data.TELEFONES ??
    data.phones ??
    data.celulares ??
    data.telefone_list ??
    data.telefone;
  const out: Array<{ telefone: string; classificacao?: string }> = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item == null) continue;
      if (typeof item === "string") {
        if (item.trim()) out.push({ telefone: item.trim() });
        continue;
      }
      if (typeof item !== "object") continue;
      const t = item as Record<string, unknown>;
      const telefone = String(
        t.TELEFONE ?? t.telefone ?? t.phone ?? t.numero ?? t.number ?? t.celular ?? "",
      ).trim();
      if (!telefone) continue;
      const classificacao =
        t.CLASSIFICACAO != null
          ? String(t.CLASSIFICACAO)
          : t.classificacao != null
            ? String(t.classificacao)
            : t.tipo != null
              ? String(t.tipo)
              : undefined;
      out.push({ telefone, classificacao });
    }
  }
  const single =
    data.telefone ?? data.TELEFONE ?? data.celular ?? data.phone ?? d.telefone ?? d.TELEFONE ?? d.celular;
  if (single != null && String(single).trim()) {
    const t = String(single).trim();
    if (!out.some((x) => x.telefone === t)) out.push({ telefone: t });
  }
  return out;
}

function extractEnderecosFlex(data: Record<string, unknown>): Array<Record<string, string>> {
  const raw = data.enderecos ?? data.ENDEREÇOS ?? data.endereco_list ?? data.addresses;
  const out: Array<Record<string, string>> = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = rowToStrings(item as Record<string, unknown>);
        if (Object.keys(o).length) out.push(o);
      }
    }
  }
  const singleKeys = ["endereco", "enderecoPrincipal", "address", "ENDERECO"];
  for (const k of singleKeys) {
    const v = data[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = rowToStrings(v as Record<string, unknown>);
      if (Object.keys(o).length) out.push(o);
    }
  }
  return out;
}

/** Endereço “achatado” no objeto cadastro (enderecoLogr, enderecoBa, …). */
function flatEnderecoFromDados(d: Record<string, unknown>): Record<string, string> | null {
  const prefix = /^endereco/i;
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) {
    if (!prefix.test(k)) continue;
    if (v == null || String(v).trim() === "") continue;
    o[k] = formatInfoseekScalar(k, v);
  }
  return Object.keys(o).length ? o : null;
}

function buildCadastroExtras(
  d: Record<string, unknown>,
  excludeNorm: Set<string>,
): Array<{ key: string; label: string; value: string }> {
  const out: Array<{ key: string; label: string; value: string }> = [];
  for (const [k, v] of Object.entries(d)) {
    const nk = normFieldKey(k);
    if (excludeNorm.has(nk)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) continue;
    const value = formatInfoseekScalar(k, v);
    if (!value) continue;
    out.push({ key: k, label: infoseekFieldTitle(k), value });
  }
  out.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return out;
}

export function normalizeInfoseekPayload(api: unknown, cpfDigitsHint?: string): InfoseekConsultResult | InfoseekConsultError {
  const root = api as Record<string, unknown>;
  if (!root || typeof root !== "object") {
    return { success: false, error: "Resposta inválida da consulta" };
  }

  if (root.success === false) {
    const msg =
      (typeof root.error === "string" && root.error.trim()) ||
      parseUpstreamErrorMessage(api) ||
      "Consulta não retornou sucesso";
    return { success: false, error: msg };
  }

  if (typeof root.error === "string" && root.error.trim() && root.success !== true) {
    return { success: false, error: root.error.trim() };
  }

  const data = resolveDataRoot(root);
  let d = findDadosCpfRecord(data);
  if (Object.keys(d).length === 0) d = findDadosCpfRecord(root);

  const nome = String(d.NOME ?? d.nome ?? d.name ?? d.Nome ?? "—");
  const cpfVal = String(d.CPF ?? d.cpf ?? d.document ?? d.documento ?? "");
  const cpf = cpfVal || (cpfDigitsHint ? formatCpfHint(cpfDigitsHint) : "");

  const nascimentoV = [d.NASCIMENTO, d.nascimento, d.dataNascimento, d.birthDate].find((x) => x != null);
  const nascimento = nascimentoV != null ? String(nascimentoV) : undefined;
  const nomeMaeV = [d.NOME_MAE, d.nome_mae, d.nomeMae, d.mae].find((x) => x != null);
  const nomeMae = nomeMaeV != null ? String(nomeMaeV) : undefined;
  const rendaV = [d.RENDA, d.renda, d.income].find((x) => x != null);
  const renda = rendaV != null ? String(rendaV) : undefined;

  const emails = extractEmailsFlex(data);
  const telefones = extractTelefonesFlex(data, d);
  let enderecos = extractEnderecosFlex(data);
  const flatAddr = flatEnderecoFromDados(d);
  if (flatAddr) enderecos = [flatAddr, ...enderecos];

  const excludeNorm = new Set<string>([
    "nome",
    "cpf",
    "document",
    "documento",
    "nascimento",
    "datanascimento",
    "birthdate",
    "nome_mae",
    "nomemae",
    "mae",
    "renda",
    "income",
  ]);
  for (const k of Object.keys(flatAddr || {})) {
    excludeNorm.add(normFieldKey(k));
  }
  if (telefones.length) {
    excludeNorm.add("telefone");
    excludeNorm.add("celular");
  }
  if (emails.length) {
    excludeNorm.add("email");
  }

  const cadastroExtras = buildCadastroExtras(d, excludeNorm);

  const mergedForScore = { ...root, ...data } as Record<string, unknown>;
  const serasa = extractSerasaScore(mergedForScore);
  const legacy = legacyScoreFromEmailLabels(emails);
  const numeric = serasa.numeric != null ? serasa.numeric : legacy.numeric;
  const label = serasa.numeric != null ? serasa.label : legacy.label;

  return {
    success: true,
    nome,
    cpf,
    nascimento,
    nomeMae,
    renda,
    emails,
    telefones,
    enderecos,
    cadastroExtras,
    scoreNumeric: numeric,
    scoreLabel: label,
  };
}

/**
 * Consulta por CPF via proxy na mesma origem (evita CORS no navegador).
 */
export async function consultInfoseekCpf(cpf: string): Promise<InfoseekConsultResult> {
  const digits = String(cpf || "").replace(/\D/g, "");
  if (digits.length !== 11) {
    throw new Error("Informe um CPF com 11 dígitos");
  }

  const customBase = String(import.meta.env.VITE_CPFA_API_URL || "").trim();
  const url = (customBase || "/api/cpf-consult").replace(/\/$/, "");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cpfaRequestBodyJson(digits),
    });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "Erro de rede na consulta");
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error(`Resposta inválida (${response.status})`);
  }

  if (!response.ok) {
    const parsed = parseUpstreamErrorMessage(raw);
    const msg = parsed || `Erro ${response.status}`;
    throw new Error(msg);
  }

  const normalized = normalizeInfoseekPayload(raw, digits);
  if (!normalized.success) {
    throw new Error(normalized.error);
  }
  return normalized;
}

export function consultaScoreDotClass(n: number | null): string {
  if (n == null) return "bg-muted-foreground/35";
  if (n > 100) {
    if (n >= 700) return "bg-emerald-500";
    if (n >= 500) return "bg-primary";
    if (n >= 300) return "bg-amber-500";
    return "bg-red-500";
  }
  if (n >= 80) return "bg-emerald-500";
  if (n >= 60) return "bg-primary";
  if (n >= 40) return "bg-amber-500";
  return "bg-red-500";
}

export function consultaScoreTextClass(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n > 100) {
    if (n >= 700) return "text-emerald-600";
    if (n >= 500) return "text-primary";
    if (n >= 300) return "text-amber-600";
    return "text-red-600";
  }
  if (n >= 80) return "text-emerald-600";
  if (n >= 60) return "text-primary";
  if (n >= 40) return "text-amber-600";
  return "text-red-600";
}
