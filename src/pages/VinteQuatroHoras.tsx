import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Clock, Loader2, Play, RefreshCw, Square, Trash2, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMPANIES, type CompanyId } from "@/lib/companies";
import { COBRANCA_24H_INSTANCE_IDS, getApiKeyForEvolutionInstance, normalizeEvolutionInstanceId, FIXED_EVOLUTION_BASE_URL } from "@/lib/evolution-settings";
import { fetchConnectionStateForInstance, fetchEvolutionQrCodeForInstance, getQrImageUrl } from "@/api/evolution";
import {
  loadCobranca24hConfig,
  saveCobranca24hConfig,
  type Cobranca24hConfig,
} from "@/lib/cobranca-24h-config";
import {
  clearCobranca24hLogs,
  getCobranca24hRunnerState,
  startCobranca24hRunner,
  stopCobranca24hRunner,
  subscribeCobranca24hRunner,
  type Cobranca24hRunnerState,
} from "@/lib/cobranca-24h-runner";
import { fetchPixKeysForClient } from "@/api/pix-keys";
import { getSupabaseClientForCompany } from "@/lib/supabase";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return iso;
  }
}

function typeLabel(t: string): string {
  if (t === "cobranca") return "Cobrança";
  if (t === "lembrete_hoje") return "Vence hoje";
  if (t === "lembrete_amanha") return "Vence amanhã";
  return t;
}

export default function VinteQuatroHoras() {
  const [config, setConfig] = useState<Cobranca24hConfig>(() => loadCobranca24hConfig());
  const [runner, setRunner] = useState<Cobranca24hRunnerState>(() => getCobranca24hRunnerState());

  useEffect(() => subscribeCobranca24hRunner(setRunner), []);

  const instanceNorm = normalizeEvolutionInstanceId(config.instance);
  const instanceOpts = useMemo(
    () => ({
      instance: instanceNorm,
      apiKey: getApiKeyForEvolutionInstance(instanceNorm),
      baseUrl: FIXED_EVOLUTION_BASE_URL,
    }),
    [instanceNorm],
  );

  const {
    data: connection,
    isLoading: connectionLoading,
    isFetching: connectionFetching,
    refetch: refetchConnection,
  } = useQuery({
    queryKey: ["24h-connection", instanceNorm],
    queryFn: () => fetchConnectionStateForInstance(instanceOpts),
    refetchInterval: 30_000,
  });

  const isConnected = connection?.ok === true && connection.connected;

  const {
    data: qrResult,
    isLoading: loadingQr,
    isFetching: qrFetching,
    refetch: refetchQr,
  } = useQuery({
    queryKey: ["24h-qr", instanceNorm, isConnected],
    queryFn: () => fetchEvolutionQrCodeForInstance(instanceOpts),
    enabled: !!instanceNorm && !isConnected,
    staleTime: 0,
    retry: false,
  });

  const refreshInstance = async () => {
    const conn = await refetchConnection();
    const connected = conn.data?.ok === true && conn.data.connected;
    if (connected) {
      toast.success(`Instância ${instanceNorm} conectada`);
      return;
    }
    const qr = await refetchQr();
    if (qr.data?.ok) {
      toast.message(`Instância ${instanceNorm} desconectada — QR atualizado`);
      return;
    }
    const err =
      conn.data && !conn.data.ok
        ? conn.data.error
        : qr.data && !qr.data.ok
          ? qr.data.error
          : "Não foi possível atualizar a instância";
    toast.error(err);
  };

  const instanceRefreshing = connectionFetching || qrFetching;

  const pixQueries = useQueries({
    queries: COMPANIES.map((c) => ({
      queryKey: ["24h-pix", c.id],
      queryFn: () => fetchPixKeysForClient(getSupabaseClientForCompany(c.id)),
      staleTime: 60_000,
    })),
  });

  const pixByCompany = useMemo(() => {
    const out: Record<CompanyId, Array<{ id: string; bank: string; key: string }>> = {
      imperatriz: [],
    };
    COMPANIES.forEach((c, i) => {
      out[c.id] = (pixQueries[i].data || []).map((p) => ({
        id: String(p.id),
        bank: String(p.bank),
        key: String(p.key),
      }));
    });
    return out;
  }, [pixQueries]);

  const persist = useCallback((next: Cobranca24hConfig) => {
    setConfig(next);
    saveCobranca24hConfig(next);
  }, []);

  const toggleAutomation = (on: boolean) => {
    const next = { ...config, enabled: on };
    persist(next);
    if (on) {
      if (!getApiKeyForEvolutionInstance(instanceNorm)) {
        toast.error("Instância sem API key configurada");
        persist({ ...next, enabled: false });
        return;
      }
      startCobranca24hRunner();
      toast.success("Automação 24HORAS iniciada");
    } else {
      stopCobranca24hRunner();
      toast.message("Automação pausada");
    }
  };

  useEffect(() => {
    if (config.enabled && !runner.running) {
      startCobranca24hRunner();
    }
  }, []);

  const updateCompany = (companyId: CompanyId, patch: Partial<Cobranca24hConfig["companies"][CompanyId]>) => {
    persist({
      ...config,
      companies: {
        ...config.companies,
        [companyId]: { ...config.companies[companyId], ...patch },
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            24HORAS
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Cobrança automática em todas as empresas, 24 horas por dia, usando uma única instância WhatsApp.
            Mantenha esta aba aberta no navegador para o robô continuar rodando.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
          <div className="text-right">
            <p className="text-xs font-medium">Automação</p>
            <p className="text-[10px] text-muted-foreground">
              {runner.running ? "Em execução" : config.enabled ? "Retomando..." : "Parada"}
            </p>
          </div>
          <Switch checked={config.enabled} onCheckedChange={toggleAutomation} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="glass-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] uppercase text-muted-foreground font-semibold">Instância</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[10px] gap-1"
              disabled={instanceRefreshing}
              onClick={() => void refreshInstance()}
            >
              {instanceRefreshing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Atualizar instância
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {connectionLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : isConnected ? (
              <Wifi className="h-4 w-4 text-green-600" />
            ) : (
              <WifiOff className="h-4 w-4 text-destructive" />
            )}
            <span className="text-sm font-medium">{instanceNorm}</span>
            <Badge variant={isConnected ? "default" : "destructive"} className="text-[10px]">
              {isConnected ? "Conectada" : "Desconectada"}
            </Badge>
          </div>
          {!isConnected && instanceNorm ? (
            <div className="rounded-md border bg-muted/20 p-3 space-y-2">
              <p className="text-[10px] text-muted-foreground">
                Escaneie o QR Code no WhatsApp para conectar a instância.
              </p>
              {loadingQr ? (
                <div className="h-40 rounded-md bg-muted/50 animate-pulse flex items-center justify-center text-xs text-muted-foreground">
                  Carregando QR...
                </div>
              ) : qrResult?.ok ? (
                <div className="flex flex-col items-center gap-2">
                  <img
                    src={getQrImageUrl(qrResult.code)}
                    alt="QR Code WhatsApp"
                    className="w-40 h-40 rounded-md border bg-white"
                  />
                  {qrResult.pairingCode ? (
                    <p className="text-[10px] text-muted-foreground">
                      Código: <span className="font-mono text-foreground">{qrResult.pairingCode}</span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-[10px] text-destructive">
                  {qrResult && !qrResult.ok ? qrResult.error : "Clique em Atualizar instância para gerar o QR."}
                </p>
              )}
            </div>
          ) : null}
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] uppercase text-muted-foreground font-semibold">Ciclo atual</p>
          <p className="text-sm font-medium mt-2 capitalize">{runner.phase}</p>
          <p className="text-[10px] text-muted-foreground truncate">{runner.currentCompany}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] uppercase text-muted-foreground font-semibold">Enviados / Falhas</p>
          <p className="text-sm font-medium mt-2">
            <span className="text-green-600">{runner.sent}</span>
            {" / "}
            <span className="text-destructive">{runner.failed}</span>
            {" · "}
            <span className="text-muted-foreground">{runner.skipped} ignorados</span>
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] uppercase text-muted-foreground font-semibold">Próxima varredura</p>
          <p className="text-sm font-medium mt-2">{formatTime(runner.nextCycleAt)}</p>
          <p className="text-[10px] text-muted-foreground">Última: {formatTime(runner.lastCycleAt)}</p>
        </div>
      </div>

      <div className="glass-card p-4 space-y-4">
        <p className="text-sm font-semibold">Configuração</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label className="text-xs">Instância WhatsApp</Label>
            <Select
              value={instanceNorm}
              onValueChange={(v) => persist({ ...config, instance: v })}
              disabled={config.enabled}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COBRANCA_24H_INSTANCE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Intervalo entre envios (min)</Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              className="h-9 text-xs"
              value={config.delayMinutes}
              disabled={config.enabled}
              onChange={(e) =>
                persist({ ...config, delayMinutes: Math.max(0, parseFloat(e.target.value) || 0) })
              }
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Intervalo entre ciclos (min)</Label>
            <Input
              type="number"
              min={5}
              step={5}
              className="h-9 text-xs"
              value={config.cycleMinutes}
              disabled={config.enabled}
              onChange={(e) =>
                persist({ ...config, cycleMinutes: Math.max(5, parseInt(e.target.value, 10) || 60) })
              }
            />
          </div>
          <div className="space-y-2 flex flex-col justify-end">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label className="text-xs">Incluir parcelamentos</Label>
              <Switch
                checked={config.includeInstallments}
                disabled={config.enabled}
                onCheckedChange={(v) => persist({ ...config, includeInstallments: v })}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.sendTypes.cobranca}
              disabled={config.enabled}
              onChange={(e) =>
                persist({
                  ...config,
                  sendTypes: { ...config.sendTypes, cobranca: e.target.checked },
                })
              }
            />
            Vencidos (cobrança)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.sendTypes.lembrete_hoje}
              disabled={config.enabled}
              onChange={(e) =>
                persist({
                  ...config,
                  sendTypes: { ...config.sendTypes, lembrete_hoje: e.target.checked },
                })
              }
            />
            Vencem hoje
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.sendTypes.lembrete_amanha}
              disabled={config.enabled}
              onChange={(e) =>
                persist({
                  ...config,
                  sendTypes: { ...config.sendTypes, lembrete_amanha: e.target.checked },
                })
              }
            />
            Vencem amanhã (lembrete)
          </label>
        </div>
      </div>

      <div className="glass-card p-4 space-y-3">
        <p className="text-sm font-semibold">Empresas</p>
        <div className="grid gap-3 md:grid-cols-2">
          {COMPANIES.map((company) => {
            const keys = pixByCompany[company.id];
            const cfg = config.companies[company.id];
            return (
              <div key={company.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{company.name}</span>
                  <Switch
                    checked={cfg.enabled}
                    disabled={config.enabled}
                    onCheckedChange={(v) => updateCompany(company.id, { enabled: v })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Chave PIX</Label>
                  <Select
                    value={cfg.pixKeyId || keys[0]?.id || "none"}
                    onValueChange={(v) =>
                      updateCompany(company.id, { pixKeyId: v === "none" ? "" : v })
                    }
                    disabled={config.enabled || keys.length === 0}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={keys.length ? "Selecione" : "Sem PIX cadastrado"} />
                    </SelectTrigger>
                    <SelectContent>
                      {keys.length === 0 ? (
                        <SelectItem value="none" disabled>
                          Nenhuma chave ativa
                        </SelectItem>
                      ) : (
                        keys.map((k) => (
                          <SelectItem key={k.id} value={k.id}>
                            {k.bank} — {k.key.slice(0, 24)}
                            {k.key.length > 24 ? "…" : ""}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Atividade</p>
            <p className="text-[10px] text-muted-foreground">
              Cliente atual: {runner.currentClient}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => {
                if (config.enabled) {
                  stopCobranca24hRunner();
                  persist({ ...config, enabled: false });
                } else {
                  toggleAutomation(true);
                }
              }}
            >
              {config.enabled ? (
                <>
                  <Square className="h-3.5 w-3.5" /> Parar
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" /> Iniciar agora
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => clearCobranca24hLogs()}
            >
              <Trash2 className="h-3.5 w-3.5" /> Limpar log
            </Button>
          </div>
        </div>
        <ScrollArea className="h-[min(320px,40vh)] rounded-md border">
          {runner.logs.length === 0 ? (
            <p className="text-xs text-muted-foreground p-4 text-center">Nenhum envio registrado ainda.</p>
          ) : (
            <div className="divide-y">
              {runner.logs.map((log, i) => (
                <div key={`${log.at}-${i}`} className="px-3 py-2 text-xs flex flex-wrap gap-x-2 gap-y-1">
                  <span className="text-muted-foreground tabular-nums">{formatTime(log.at)}</span>
                  <span className="font-medium">{log.companyName}</span>
                  <span>{log.clientName}</span>
                  <Badge variant="outline" className="text-[9px] h-5">
                    {typeLabel(log.type)}
                  </Badge>
                  <Badge
                    variant={
                      log.status === "sent" ? "default" : log.status === "failed" ? "destructive" : "secondary"
                    }
                    className="text-[9px] h-5"
                  >
                    {log.status === "sent" ? "Enviado" : log.status === "failed" ? "Falha" : "Ignorado"}
                  </Badge>
                  {log.detail ? <span className="text-muted-foreground">{log.detail}</span> : null}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
