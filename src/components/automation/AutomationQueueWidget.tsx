import { ChevronUp, ChevronDown, StopCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAutomationQueue } from "@/contexts/AutomationQueueContext";

function labelTipo(t: "cobranca" | "lembrete_hoje" | "lembrete_amanha"): string {
  if (t === "cobranca") return "Cobrança";
  if (t === "lembrete_hoje") return "Cobrança (vencem hoje)";
  return "Lembrete (vencem amanhã)";
}

function formatDurationMs(ms: number): string {
  const x = Math.max(0, Math.round(ms));
  const totalMinutes = Math.floor(x / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}min`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}min`;
}

export function AutomationQueueWidget() {
  const q = useAutomationQueue();

  const shouldShow = q.isRunning || q.phase === "done" || q.logs.length > 0 || q.stats.total > 0;
  if (!shouldShow) return null;

  const progressText = q.stats.total ? `${q.stats.done} / ${q.stats.total}` : "—";
  const pct = q.stats.total ? Math.max(0, Math.min(100, Math.round((q.stats.done / q.stats.total) * 100))) : 0;
  const barSize = 10;
  const filled = Math.round((pct / 100) * barSize);
  const progressBar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, barSize - filled))} ${pct}%`;
  const totalEstimateMs = Math.max(0, (q.stats.total - 1) * (q.delayMs || 0));
  const remainingWaits = Math.max(0, q.stats.total - q.stats.done - 1);
  const remainingEstimateMs = Math.max(0, remainingWaits * (q.delayMs || 0));
  const etaText =
    remainingEstimateMs > 0
      ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
          new Date(Date.now() + remainingEstimateMs),
        )
      : null;

  return (
    <div className="fixed right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] bottom-[max(1rem,env(safe-area-inset-bottom,0px))] max-sm:left-4 max-sm:right-4 max-sm:w-auto">
      <div className="rounded-xl border border-border/60 bg-background/95 backdrop-blur shadow-lg overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">Fila de cobranças</p>
            <p className="text-[11px] text-muted-foreground truncate">
              Progresso: <span className="font-mono">{progressBar}</span> · {progressText} · Sucesso: {q.stats.sent} · Falhas:{" "}
              {q.stats.failed}
              {q.phase === "waiting" ? " · aguardando" : ""}
              {q.phase === "sending" ? " · enviando" : ""}
            </p>
            {q.stats.total > 0 && (q.delayMs || 0) > 0 ? (
              <p className="text-[11px] text-muted-foreground truncate">
                Previsão: {formatDurationMs(totalEstimateMs)}
                {q.stats.done < q.stats.total ? ` · Restante: ${formatDurationMs(remainingEstimateMs)}` : ""}
                {etaText ? ` · Termina ~ ${etaText}` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {q.isRunning ? (
              <Button size="icon" variant="destructive" onClick={q.stop} title="Interromper">
                <StopCircle className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="icon" variant="outline" onClick={q.clear} title="Limpar">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="icon"
              variant="outline"
              onClick={() => q.setMinimized(!q.minimized)}
              title={q.minimized ? "Expandir" : "Minimizar"}
            >
              {q.minimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {!q.minimized ? (
          <div className="px-3 pb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Enviando agora</p>
                <p className="text-xs font-medium text-foreground mt-1 truncate">{q.currentName || "—"}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Próximo</p>
                <p className="text-xs font-medium text-foreground mt-1 truncate">{q.nextName || "—"}</p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Log</p>
              <ScrollArea className="h-40 rounded-lg border border-border/40">
                <div className="p-2 space-y-2">
                  {q.logs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhuma mensagem enviada ainda.</p>
                  ) : (
                    q.logs
                      .slice()
                      .reverse()
                      .slice(0, 40)
                      .map((l) => (
                        <div key={`${l.idx}-${l.clientName}`} className="rounded-md border border-border/30 bg-muted/10 p-2">
                          <p className="text-xs font-medium text-foreground">
                            {l.clientName}{" "}
                            <span className="text-muted-foreground font-normal">· {labelTipo(l.type)}</span>
                          </p>
                          {l.status === "sent" ? (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Enviado com sucesso</p>
                          ) : (
                            <p className="text-xs text-destructive mt-0.5 break-words">
                              Falhou: {l.error || "Motivo não informado"}
                            </p>
                          )}
                        </div>
                      ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

