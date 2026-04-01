import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  AutoSchedule,
  clearQueue,
  deleteAutoSchedule,
  executeAutoSchedule,
  getQueueStats,
  listAutoSchedules,
  saveAutoSchedule,
  stopQueue,
} from "@/api/auto-send-backend";
import { getAutoSendSocket } from "@/lib/auto-send-socket";

type InstanceId = "omnibot2" | "vinicius" | "douglas";

const INSTANCE_OPTIONS: { id: InstanceId; label: string }[] = [
  { id: "omnibot2", label: "omnibot2" },
  { id: "vinicius", label: "vinicius" },
  { id: "douglas", label: "douglas" },
];

const COMPANY_OPTIONS: AutoSchedule["company"][] = ["franca", "litoral", "mogiana", "imperatriz", "all"];

const COMPANY_LABELS: Record<AutoSchedule["company"], string> = {
  franca: "FRANCA",
  litoral: "LITORAL",
  mogiana: "MOGIANA",
  imperatriz: "IMPERATRIZ",
  all: "TODAS",
};

const DAY_OPTIONS: AutoSchedule["days"][number][] = [
  "all",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DAY_LABELS: Record<AutoSchedule["days"][number], string> = {
  all: "Todos os dias",
  monday: "Segunda",
  tuesday: "Terça",
  wednesday: "Quarta",
  thursday: "Quinta",
  friday: "Sexta",
  saturday: "Sábado",
  sunday: "Domingo",
};

const FILTER_OPTIONS: AutoSchedule["filters"][number][] = ["overdue", "dueToday", "installments"];

const FILTER_LABELS: Record<AutoSchedule["filters"][number], string> = {
  overdue: "Vencidos",
  dueToday: "Vencem hoje",
  installments: "Parcelamentos",
};

function formatDaysList(days: AutoSchedule["days"]): string {
  return days.map((d) => DAY_LABELS[d] ?? d).join(", ");
}

function formatFiltersList(filters: AutoSchedule["filters"]): string {
  return filters.map((f) => FILTER_LABELS[f] ?? f).join(", ");
}

function newScheduleId(): string {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `sch_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function defaultSchedule(): AutoSchedule {
  return {
    id: newScheduleId(),
    name: "Agendamento",
    company: "franca",
    time: "07:30",
    days: ["all"],
    filters: ["overdue", "dueToday"],
    delayMinutes: 7,
    instanceId: "vinicius",
    active: true,
  };
}

export default function EnviosAutomaticos() {
  const { toast } = useToast();
  const [selectedInstance, setSelectedInstance] = useState<InstanceId>("vinicius");
  const [schedules, setSchedules] = useState<AutoSchedule[]>([]);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [editing, setEditing] = useState<AutoSchedule>(() => defaultSchedule());
  const [queueStats, setQueueStats] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);

  const runningSchedules = useMemo(() => schedules.filter((s) => s.active), [schedules]);
  const pausedSchedules = useMemo(() => schedules.filter((s) => !s.active), [schedules]);

  async function refresh() {
    const data = await listAutoSchedules();
    setSchedules(data);
  }

  async function refreshStats() {
    const stats = await getQueueStats(selectedInstance);
    setQueueStats(stats);
  }

  useEffect(() => {
    refresh().catch((e) => toast({ title: "Erro", description: String(e?.message || e), variant: "destructive" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshStats().catch(() => {});
    const t = setInterval(() => refreshStats().catch(() => {}), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstance]);

  useEffect(() => {
    const socket = getAutoSendSocket();
    const handler = (eventName: string) => (payload: any) => {
      const instanceId = payload?.instanceId;
      if (instanceId && instanceId !== selectedInstance) return;
      setEvents((prev) => [{ event: eventName, payload, at: new Date().toISOString() }, ...prev].slice(0, 100));
    };

    const watched = [
      "queue:added",
      "queue:processing",
      "queue:item:processing",
      "queue:sent",
      "queue:failed",
      "queue:stopped",
      "queue:cleared",
      "schedule:executed",
      "schedule:failed",
      "schedule:loaded",
    ];

    const handlers: Array<[string, (p: any) => void]> = watched.map((e) => [e, handler(e)]);
    for (const [e, h] of handlers) socket.on(e, h);
    return () => {
      for (const [e, h] of handlers) socket.off(e, h);
    };
  }, [selectedInstance]);

  function toggleArray<T>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
  }

  async function onSave() {
    const saved = await saveAutoSchedule(editing);
    toast({ title: "Salvo", description: `Agendamento ${saved.name} salvo.` });
    setIsCreatingNew(false);
    await refresh();
  }

  async function onTogglePaused(s: AutoSchedule) {
    await saveAutoSchedule({ ...s, active: !s.active });
    toast({
      title: s.active ? "Pausado" : "Em execução",
      description: s.active ? "O agendamento foi pausado." : "O agendamento voltou a executar no horário.",
    });
    await refresh();
  }

  async function onExecuteNow(id: string) {
    const r = await executeAutoSchedule(id);
    toast({ title: "Executado", description: `Buscou ${r.fetched} e colocou ${r.added} na fila.` });
    await refresh();
    await refreshStats();
  }

  async function onDelete(id: string) {
    await deleteAutoSchedule(id);
    toast({ title: "Removido", description: "Agendamento removido." });
    await refresh();
  }

  async function onStopQueue() {
    await stopQueue(selectedInstance);
    toast({ title: "Fila", description: "Parada solicitada." });
  }

  async function onClearQueue() {
    await clearQueue(selectedInstance);
    toast({ title: "Fila", description: "Fila limpa." });
    await refreshStats();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Envios automáticos</h1>
          <p className="text-sm text-muted-foreground">
            Agendamentos e fila por instância do WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Instância</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedInstance}
            onChange={(e) => setSelectedInstance(e.target.value as InstanceId)}
          >
            {INSTANCE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Agendamentos</h2>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(defaultSchedule());
                setIsCreatingNew(true);
              }}
            >
              Novo agendamento
            </Button>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Em execução ({runningSchedules.length})</h3>
            <div className="space-y-2">
              {runningSchedules.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium truncate">{s.name}</span>
                      <Badge variant="outline">{s.instanceId}</Badge>
                      <Badge variant="outline">{COMPANY_LABELS[s.company] ?? s.company.toUpperCase()}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.time} · dias: {formatDaysList(s.days)} · filtros: {formatFiltersList(s.filters)} · delay:{" "}
                      {s.delayMinutes} min
                    </div>
                    {s.lastRun && (
                      <div className="text-xs text-muted-foreground">
                        último: {new Date(s.lastRun).toLocaleString("pt-BR")} · execuções: {s.runCount || 0}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => onTogglePaused(s)}>
                      Pausar
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onExecuteNow(s.id)}>
                      Executar agora
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => onDelete(s.id)}>
                      Remover
                    </Button>
                  </div>
                </div>
              ))}
              {runningSchedules.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum agendamento em execução.</p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Pausados ({pausedSchedules.length})</h3>
            <div className="space-y-2">
              {pausedSchedules.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-lg border border-dashed p-3 bg-muted/20"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium truncate">{s.name}</span>
                      <Badge variant="secondary">Pausado</Badge>
                      <Badge variant="outline">{s.instanceId}</Badge>
                      <Badge variant="outline">{COMPANY_LABELS[s.company] ?? s.company.toUpperCase()}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.time} · dias: {formatDaysList(s.days)} · filtros: {formatFiltersList(s.filters)} · delay:{" "}
                      {s.delayMinutes} min
                    </div>
                    {s.lastRun && (
                      <div className="text-xs text-muted-foreground">
                        último: {new Date(s.lastRun).toLocaleString("pt-BR")} · execuções: {s.runCount || 0}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => onTogglePaused(s)}>
                      Retomar
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onExecuteNow(s.id)}>
                      Executar agora
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => onDelete(s.id)}>
                      Remover
                    </Button>
                  </div>
                </div>
              ))}
              {pausedSchedules.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum agendamento pausado.</p>
              )}
            </div>
          </div>

        </Card>

        <Card className="p-4 space-y-3">
          <h2 className="text-base font-semibold">Fila ({selectedInstance})</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded border p-2">
              <div className="text-xs text-muted-foreground">Pendentes</div>
              <div className="font-semibold">{queueStats?.pending ?? "-"}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-xs text-muted-foreground">Em processamento</div>
              <div className="font-semibold">{queueStats?.processing ? "Sim" : "Não"}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-xs text-muted-foreground">Enviadas</div>
              <div className="font-semibold">{queueStats?.sent ?? "-"}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-xs text-muted-foreground">Falhas</div>
              <div className="font-semibold">{queueStats?.failed ?? "-"}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refreshStats().catch(() => {})}>
              Atualizar
            </Button>
            <Button variant="outline" onClick={() => onStopQueue().catch(() => {})}>
              Parar
            </Button>
            <Button variant="destructive" onClick={() => onClearQueue().catch(() => {})}>
              Limpar
            </Button>
          </div>
        </Card>
      </div>

      {isCreatingNew && (
      <Card className="p-4 space-y-4 border-primary/30">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Novo agendamento</h2>
          <Button variant="ghost" size="sm" onClick={() => setIsCreatingNew(false)}>
            Cancelar
          </Button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome</label>
            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Empresa</label>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm w-full"
              value={editing.company}
              onChange={(e) => setEditing({ ...editing, company: e.target.value as any })}
            >
              {COMPANY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {COMPANY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Instância</label>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm w-full"
              value={editing.instanceId}
              onChange={(e) => setEditing({ ...editing, instanceId: e.target.value as any })}
            >
              {INSTANCE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Horário</label>
            <Input value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} placeholder="07:30" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Delay (min)</label>
            <Input
              type="number"
              value={editing.delayMinutes}
              onChange={(e) => setEditing({ ...editing, delayMinutes: Number(e.target.value || 0) })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Ativo</label>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm w-full"
              value={editing.active ? "1" : "0"}
              onChange={(e) => setEditing({ ...editing, active: e.target.value === "1" })}
            >
              <option value="1">Sim</option>
              <option value="0">Não</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Dias</div>
          <div className="flex flex-wrap gap-2">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setEditing({ ...editing, days: toggleArray(editing.days, d) })}
                className={`px-3 py-1 rounded-md border text-sm ${
                  editing.days.includes(d) ? "bg-primary/10 border-primary text-primary" : "bg-background"
                }`}
              >
                {DAY_LABELS[d]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Filtros</div>
          <div className="flex flex-wrap gap-2">
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setEditing({ ...editing, filters: toggleArray(editing.filters, f) })}
                className={`px-3 py-1 rounded-md border text-sm ${
                  editing.filters.includes(f) ? "bg-primary/10 border-primary text-primary" : "bg-background"
                }`}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => onSave().catch((e) => toast({ title: "Erro", description: String(e?.message || e), variant: "destructive" }))}>
            Salvar
          </Button>
          <Button variant="outline" onClick={() => setEditing(defaultSchedule())}>
            Limpar formulário
          </Button>
        </div>
      </Card>
      )}

      <Card className="p-4 space-y-3">
        <h2 className="text-base font-semibold">Eventos (instância filtrada)</h2>
        <div className="text-xs text-muted-foreground">
          Mostrando apenas eventos cujo payload possui <code>instanceId</code> igual à instância selecionada.
        </div>
        <div className="space-y-2 max-h-[320px] overflow-auto">
          {events.map((e, idx) => (
            <div key={idx} className="rounded border p-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">{e.event}</div>
                <div className="text-xs text-muted-foreground">{new Date(e.at).toLocaleTimeString("pt-BR")}</div>
              </div>
              <pre className="text-xs whitespace-pre-wrap break-words text-muted-foreground mt-1">
                {JSON.stringify(e.payload, null, 2)}
              </pre>
            </div>
          ))}
          {events.length === 0 && (
            <div className="text-sm text-muted-foreground">Nenhum evento recebido ainda.</div>
          )}
        </div>
      </Card>
    </div>
  );
}

