import {
  consultaScoreDotClass,
  consultaScoreTextClass,
  infoseekFieldTitle,
  type InfoseekConsultResult,
} from "@/api/infoseek";

type Props = {
  result: InfoseekConsultResult;
};

/** Conteúdo comum da consulta Infoseek (score oficial, cadastro, endereços com rótulos, extras). */
export function InfoseekConsultBody({ result }: Props) {
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-muted-foreground">Score:</span>
        <span
          className={`inline-flex items-center gap-1 font-semibold tabular-nums ${consultaScoreTextClass(result.scoreNumeric)}`}
        >
          <span className={`h-2 w-2 rounded-full shrink-0 ${consultaScoreDotClass(result.scoreNumeric)}`} />
          {result.scoreNumeric != null
            ? `${result.scoreNumeric}${result.scoreLabel ? ` (${result.scoreLabel})` : ""}`
            : "Score indisponível nesta consulta"}
        </span>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
        <div className="sm:col-span-2 font-medium text-foreground">{result.nome}</div>
        {result.cpf ? <div className="font-mono">CPF: {result.cpf}</div> : null}
        {result.nascimento ? <div>Nasc.: {result.nascimento}</div> : null}
        {result.nomeMae ? <div className="sm:col-span-2">Mãe: {result.nomeMae}</div> : null}
        {result.renda ? <div>Renda: {result.renda}</div> : null}
      </div>
      {result.emails.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">E-mails</p>
          <ul className="space-y-0.5 font-mono text-[11px]">
            {result.emails.map((em, i) => (
              <li key={`${em.email}-${i}`}>
                {em.email || "—"}
                {em.scoreLabel ? <span className="text-muted-foreground ml-1">({em.scoreLabel})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.telefones.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Telefones</p>
          <ul className="space-y-0.5 font-mono text-[11px]">
            {result.telefones.map((t, i) => (
              <li key={`${t.telefone}-${i}`}>
                {t.telefone || "—"}
                {t.classificacao ? <span className="text-muted-foreground ml-1">({t.classificacao})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.enderecos.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Endereços</p>
          <ul className="space-y-2 text-[11px]">
            {result.enderecos.map((a, i) => (
              <li key={i} className="rounded border border-border/30 bg-background/50 p-2">
                {Object.entries(a).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-muted-foreground">{infoseekFieldTitle(k)}:</span>{" "}
                    <span className="font-mono">{v}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.cadastroExtras.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Outros dados</p>
          <ul className="space-y-1 rounded border border-border/30 bg-background/50 p-2 text-[11px]">
            {result.cadastroExtras.map((row) => (
              <li key={row.key}>
                <span className="text-muted-foreground">{row.label}:</span>{" "}
                <span className="font-mono break-words">{row.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
