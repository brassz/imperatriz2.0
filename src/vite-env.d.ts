/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Filial lógica (ex.: Franca) — usada em foro, etc. */
  readonly VITE_COMPANY_BRANCH?: string;
  /** Nome comercial no PDF (ex.: FRANCACRED). Sobrescreve o mapa por filial. */
  readonly VITE_COMPANY_DISPLAY_NAME?: string;
  /** Alias opcional para nome comercial no PDF. */
  readonly VITE_COMPANY_NAME?: string;
  /** Razão social na barra superior do PDF (se vazio, usa o nome comercial da filial). */
  readonly VITE_COMPANY_LEGAL_NAME?: string;
  /** Chave da API de consulta por CPF — no dev o Vite lê também do .env para o proxy (pode usar INFOSEEK_API_KEY sem VITE_). */
  readonly VITE_INFOSEEK_API_KEY?: string;
  /** Nome do campo JSON enviado ao provedor (padrão `value`). Use se a documentação exigir outro (ex.: `document`). */
  readonly VITE_CPFA_JSON_FIELD?: string;
  /** Caminho do endpoint Infoseek (padrão `/api/validate/cpf`). Ex.: `/api/validate/painel_completo` para consulta completa se o plano permitir. */
  readonly VITE_CPFA_VALIDATE_PATH?: string;
  /** Se `true`, envia CPF como `000.000.000-00` em vez de só dígitos. */
  readonly VITE_CPFA_CPF_FORMATTED?: string;
  /** URL completa do proxy de consulta CPF em produção (POST JSON `{ value: "cpf" }` + X-API-Key no servidor). */
  readonly VITE_CPFA_API_URL?: string;
  /** Se "true", não desregistra service workers no boot (útil só se precisar de PWA da plataforma). */
  readonly VITE_KEEP_SERVICE_WORKER?: string;
}
