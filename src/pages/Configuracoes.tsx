import { Plus, MessageCircle, Send, KeyRound, FolderOpen, RefreshCw, Clock, Calendar, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { fetchPixKeys } from "@/api/pix-keys";
import { fetchExpenseCategories } from "@/api/categories";
import { getEvolutionConfig, saveEvolutionConfig } from "@/lib/evolution-settings";
import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { fetchLoansForAutomation, type AutomationLoan } from "@/api/automation";
import {
  fetchEvolutionQrCode,
  getQrImageUrl,
  sendWhatsAppText,
  fetchConnectionState,
} from "@/api/evolution";
import {
  buildCobrancaMessage,
  buildLembreteHojeMessage,
  buildLembreteMessage,
  type PixInfo,
} from "@/lib/whatsapp-messages";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getAgendamentos,
  saveAgendamento,
  updateAgendamento,
  removeAgendamento,
  type Agendamento,
  type DiaSemana,
  type FiltroAgendamento,
} from "@/lib/agendamentos";
import { PDF_BRAND } from "@/lib/pdf-branding";

const EMPRESAS = ["FRANCA", "Litoral", "Mogiana", "Imperatriz"];
const DIAS_LABELS: { value: DiaSemana; label: string }[] = [
  { value: "todos", label: "Todos os Dias" },
  { value: "segunda", label: "Segunda-feira" },
  { value: "terca", label: "Terça-feira" },
  { value: "quarta", label: "Quarta-feira" },
  { value: "quinta", label: "Quinta-feira" },
  { value: "sexta", label: "Sexta-feira" },
  { value: "sabado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
];
const FILTROS_OPCOES: { value: FiltroAgendamento; label: string }[] = [
  { value: "vencem_hoje", label: "Vencem Hoje" },
  { value: "vencidos", label: "Vencidos" },
  { value: "parcelamentos", label: "Parcelamentos" },
];

function NovoAgendamentoModal({
  instance,
  onCreated,
  open,
  onOpenChange,
}: {
  instance: string;
  onCreated: () => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [nome, setNome] = useState("");
  const [empresa, setEmpresa] = useState( PDF_BRAND.branch?.toUpperCase() || "FRANCA");
  const [horario, setHorario] = useState("08:00");
  const [dias, setDias] = useState<DiaSemana[]>(["todos"]);
  const [filtros, setFiltros] = useState<FiltroAgendamento[]>([]);
  const [delayMinutos, setDelayMinutos] = useState(7);
  const [ativo, setAtivo] = useState(true);
  const [erroFiltro, setErroFiltro] = useState("");

  const toggleDia = (d: DiaSemana) => {
    if (d === "todos") {
      setDias(["todos"]);
      return;
    }
    setDias((prev) => {
      const sem = prev.filter((x) => x !== "todos");
      if (sem.includes(d)) {
        const next = sem.filter((x) => x !== d);
        return next.length ? next : ["todos"];
      }
      return [...sem, d];
    });
  };

  const toggleFiltro = (f: FiltroAgendamento) => {
    setFiltros((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]
    );
    setErroFiltro("");
  };

  const handleCriar = () => {
    if (filtros.length === 0) {
      setErroFiltro("Selecione pelo menos um filtro");
      return;
    }
    saveAgendamento({
      nome: nome.trim() || "Agendamento sem nome",
      instance,
      empresa,
      horario,
      dias,
      filtros,
      delayMinutos,
      ativo,
    });
    toast.success("Agendamento criado");
    onCreated();
    onOpenChange(false);
    setNome("");
    setHorario("08:00");
    setDias(["todos"]);
    setFiltros([]);
    setDelayMinutos(7);
    setAtivo(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Novo Agendamento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Agendamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Nome do Agendamento</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Envio Manhã - Vencidos"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Instância WhatsApp</Label>
            <Input value={instance} disabled className="mt-1 bg-muted" />
          </div>
          <div>
            <Label className="text-xs">Empresa</Label>
            <Select value={empresa} onValueChange={setEmpresa}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPRESAS.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1">
              <Clock className="h-3 w-3" /> Horário (HH:MM)
            </Label>
            <Input
              type="time"
              value={horario}
              onChange={(e) => setHorario(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1 mb-2">
              <Calendar className="h-3 w-3" /> Dias da Semana
            </Label>
            <div className="flex flex-wrap gap-2">
              {DIAS_LABELS.map((d) => (
                <Button
                  key={d.value}
                  type="button"
                  variant={dias.includes(d.value) ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleDia(d.value)}
                >
                  {d.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs mb-2 block">Filtros (Selecione um ou mais)</Label>
            <div className="flex flex-wrap gap-2">
              {FILTROS_OPCOES.map((f) => (
                <Button
                  key={f.value}
                  type="button"
                  variant={filtros.includes(f.value) ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleFiltro(f.value)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            {erroFiltro && (
              <p className="text-xs text-destructive mt-2">{erroFiltro}</p>
            )}
          </div>
          <div>
            <Label className="text-xs">Delay entre mensagens (minutos)</Label>
            <Input
              type="number"
              min={1}
              max={60}
              value={delayMinutos}
              onChange={(e) => setDelayMinutos(Number(e.target.value) || 7)}
              className="mt-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="ativo"
              checked={ativo}
              onCheckedChange={(v) => setAtivo(!!v)}
            />
            <Label htmlFor="ativo" className="text-sm cursor-pointer">
              Agendamento ativo
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleCriar}>Criar Agendamento</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDias(dias: DiaSemana[]): string {
  if (dias.includes("todos")) return "Todos os dias";
  const labels = dias.map(
    (d) => DIAS_LABELS.find((x) => x.value === d)?.label ?? d
  );
  return labels.join(", ");
}

function formatFiltros(f: FiltroAgendamento[]): string {
  return f.map((x) => FILTROS_OPCOES.find((o) => o.value === x)?.label ?? x).join(", ");
}

export default function Configuracoes() {
  const config = getEvolutionConfig();
  const [evolution, setEvolution] = useState({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    instance: config.instance,
  });
  const [selectedPixId, setSelectedPixId] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [delayModalOpen, setDelayModalOpen] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState("2");
  const [automationLoans, setAutomationLoans] = useState<AutomationLoan[] | null>(null);
  const [loadingAutomationLoans, setLoadingAutomationLoans] = useState(false);
  const [sendTypes, setSendTypes] = useState({
    cobranca: true,
    lembrete_hoje: true,
    lembrete_amanha: true,
  });
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [queuePhase, setQueuePhase] = useState<"loading" | "sending" | "waiting" | "done">("loading");
  const [queueStats, setQueueStats] = useState({ total: 0, done: 0, sent: 0, failed: 0 });
  const [queueLogs, setQueueLogs] = useState<
    Array<{
      idx: number;
      clientName: string;
      type: AutomationLoan["type"];
      status: "sent" | "failed";
      error?: string;
    }>
  >([]);
  const [queueCurrentName, setQueueCurrentName] = useState("");
  const [queueNextName, setQueueNextName] = useState("");
  const abortQueueRef = useRef(false);
  const [activeTab, setActiveTab] = useState("whatsapp");
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>(() => getAgendamentos());
  const [modalAgendamento, setModalAgendamento] = useState(false);

  const refreshAgendamentos = useCallback(() => setAgendamentos(getAgendamentos()), []);

  // Carrega a fila de clientes para automação sempre que a tela é acessada
  useEffect(() => {
    let cancelled = false;
    const loadLoans = async () => {
      setLoadingAutomationLoans(true);
      try {
        const loans = await fetchLoansForAutomation();
        if (!cancelled) {
          setAutomationLoans(loans);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("Erro ao carregar clientes para automação:", e);
        }
      } finally {
        if (!cancelled) {
          setLoadingAutomationLoans(false);
        }
      }
    };
    loadLoans();
    return () => {
      cancelled = true;
    };
  }, []);

  const { data: connectionState, refetch: refetchConnection } = useQuery({
    queryKey: ["evolution-connection", activeTab, evolution.instance],
    queryFn: async () => {
      const r = await fetchConnectionState();
      if (!r.ok) return { connected: false };
      return { connected: r.connected };
    },
    enabled: activeTab === "whatsapp" && !!evolution.instance?.trim(),
    staleTime: 30_000,
  });

  const isConnected = connectionState?.connected ?? false;

  const { data: qrResult, isLoading: loadingQr, refetch: refetchQr } = useQuery({
    queryKey: ["evolution-qr", activeTab, evolution.instance, isConnected],
    queryFn: fetchEvolutionQrCode,
    enabled: activeTab === "whatsapp" && !!evolution.instance?.trim() && !isConnected,
    staleTime: 0,
    retry: false,
  });

  const { data: pixKeys = [], isLoading: loadingPix } = useQuery({
    queryKey: ["pix-keys"],
    queryFn: fetchPixKeys,
  });

  const { data: categories = [], isLoading: loadingCat } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: fetchExpenseCategories,
  });

  const handleSaveEvolution = () => {
    saveEvolutionConfig(evolution);
    toast.success("Configuração Evolution API salva");
    refetchQr();
    refetchConnection();
  };

  const getPixInfoForAutomation = useCallback((): PixInfo | null => {
    const pix = pixKeys.find((p: Record<string, unknown>) => p.id === selectedPixId) as
      | { bank: string; holder: string; key: string }
      | undefined;
    if (!pix) return null;
    return {
      tipo: pix.bank || "CNPJ",
      titular: pix.holder || "",
      chave: pix.key || "",
    };
  }, [pixKeys, selectedPixId]);

  /** Delay que pode ser interrompido ao fechar o modal ou clicar em Interromper */
  const interruptibleDelay = useCallback((ms: number) => {
    return new Promise<void>((resolve) => {
      const start = Date.now();
      const step = () => {
        if (abortQueueRef.current) {
          resolve();
          return;
        }
        const elapsed = Date.now() - start;
        if (elapsed >= ms) {
          resolve();
          return;
        }
        window.setTimeout(step, Math.min(250, ms - elapsed));
      };
      step();
    });
  }, []);

  const handleOpenCobrancaDelayModal = async () => {
    if (!getPixInfoForAutomation()) {
      toast.error("Selecione uma chave PIX para as mensagens");
      return;
    }
    setDelayModalOpen(true);
    setLoadingAutomationLoans(true);
    setAutomationLoans(null);
    try {
      const loans = await fetchLoansForAutomation();
      setAutomationLoans(loans);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar clientes para automação");
    } finally {
      setLoadingAutomationLoans(false);
    }
  };

  const buildAutomationMessage = (item: AutomationLoan, pixInfo: PixInfo): string => {
    if (item.type === "cobranca") return buildCobrancaMessage(item.loan, pixInfo, 50);
    if (item.type === "lembrete_hoje") {
      // Vencem hoje também são tratados como cobrança
      return buildCobrancaMessage(item.loan, pixInfo, 50);
    }
    return buildLembreteMessage(item.loan, pixInfo);
  };

  const handleConfirmDelayAndStartQueue = async () => {
    const pixInfo = getPixInfoForAutomation();
    if (!pixInfo) {
      toast.error("Selecione uma chave PIX para as mensagens");
      return;
    }
    if (loadingAutomationLoans || !automationLoans) {
      toast.message("Aguarde terminar de carregar os clientes antes de iniciar.");
      return;
    }
    const min = Math.max(0, parseFloat(String(delayMinutes).replace(",", ".")) || 0);
    const delayMs = Math.round(min * 60_000);

    setDelayModalOpen(false);
    abortQueueRef.current = false;
    setIsSending(true);
    setQueueModalOpen(true);
    setQueuePhase("loading");
    setQueueStats({ total: 0, done: 0, sent: 0, failed: 0 });
    setQueueLogs([]);
    setQueueCurrentName("Carregando fila...");
    setQueueNextName("—");

    try {
      const loans = automationLoans;
      if (abortQueueRef.current) {
        toast.message("Envio cancelado");
        return;
      }

      const withoutPhone = loans.filter((l) => !l.loan.client_phone?.trim());
      if (withoutPhone.length > 0) {
        toast.warning(`${withoutPhone.length} cliente(s) sem telefone serão ignorados`);
      }
      const activeTypes = new Set<AutomationLoan["type"]>(
        ([
          sendTypes.cobranca && "cobranca",
          sendTypes.lembrete_hoje && "lembrete_hoje",
          sendTypes.lembrete_amanha && "lembrete_amanha",
        ].filter(Boolean) as AutomationLoan["type"][])
      );

      if (activeTypes.size === 0) {
        toast.error("Selecione ao menos um tipo de envio (vencidos, vencem hoje ou lembretes).");
        setQueuePhase("done");
        setQueueCurrentName("—");
        setQueueNextName("—");
        return;
      }

      const toSend = loans.filter(
        (l) => l.loan.client_phone?.trim() && activeTypes.has(l.type)
      );

      if (toSend.length === 0) {
        toast.info("Nenhum cliente na fila para enviar.");
        setQueuePhase("done");
        setQueueCurrentName("—");
        setQueueNextName("—");
        return;
      }

      setQueueStats({ total: toSend.length, done: 0, sent: 0, failed: 0 });

      let sent = 0;
      let failed = 0;

      for (let i = 0; i < toSend.length; i++) {
        if (abortQueueRef.current) break;

        const item = toSend[i];
        const nextItem = toSend[i + 1];

        setQueuePhase("sending");
        setQueueCurrentName(item.loan.client_name);
        setQueueNextName(nextItem ? nextItem.loan.client_name : "—");

        const text = buildAutomationMessage(item, pixInfo);
        const { ok, error } = await sendWhatsAppText(item.loan.client_phone, text);
        if (ok) sent++;
        else {
          failed++;
          console.error(`Erro ao enviar para ${item.loan.client_name}:`, error);
        }

        setQueueLogs((prev) => [
          ...prev,
          {
            idx: i,
            clientName: item.loan.client_name,
            type: item.type,
            status: ok ? "sent" : "failed",
            error: ok ? undefined : error ?? "Erro desconhecido",
          },
        ]);

        setQueueStats({ total: toSend.length, done: i + 1, sent, failed });

        if (abortQueueRef.current) break;

        if (i < toSend.length - 1 && delayMs > 0) {
          setQueuePhase("waiting");
          setQueueCurrentName("Aguardando intervalo...");
          setQueueNextName(nextItem ? nextItem.loan.client_name : "—");
          await interruptibleDelay(delayMs);
        }
      }

      if (abortQueueRef.current) {
        toast.warning(`Interrompido. Enviados: ${sent}${failed > 0 ? ` | Falhas: ${failed}` : ""}`);
      } else {
        toast.success(`Enviados: ${sent}${failed > 0 ? ` | Falhas: ${failed}` : ""}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao executar automação");
    } finally {
      setIsSending(false);
      setQueuePhase("done");
      if (!abortQueueRef.current) {
        setQueueCurrentName("—");
        setQueueNextName("—");
      }
    }
  };

  const handleInterruptQueue = () => {
    abortQueueRef.current = true;
  };

  const handleQueueModalOpenChange = (open: boolean) => {
    if (!open && isSending) {
      abortQueueRef.current = true;
    }
    setQueueModalOpen(open);
  };

  const toggleAgendamentoAtivo = (a: Agendamento) => {
    updateAgendamento(a.id, { ativo: !a.ativo });
    refreshAgendamentos();
    toast.success(a.ativo ? "Agendamento desativado" : "Agendamento ativado");
  };

  const handleRemoveAgendamento = (a: Agendamento) => {
    removeAgendamento(a.id);
    refreshAgendamentos();
    toast.success("Agendamento removido");
  };

  const isLoading = loadingPix || loadingCat;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Configurações</h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="glass-card p-8 animate-pulse h-64 rounded-xl" />
          <div className="glass-card p-8 animate-pulse h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground">Configurações gerais do sistema</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="whatsapp" className="gap-2">
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="pix" className="gap-2">
            <KeyRound className="h-4 w-4" />
            Chaves PIX
          </TabsTrigger>
          <TabsTrigger value="categorias" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Categorias
          </TabsTrigger>
        </TabsList>

        <TabsContent value="whatsapp" className="space-y-4 mt-4">
          {/* Evolution API config */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-5"
          >
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Evolution API
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Configure a conexão com a Evolution API para cobranças via WhatsApp.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <Label className="text-xs">URL da API</Label>
                <Input
                  value={evolution.baseUrl}
                  onChange={(e) => setEvolution((c) => ({ ...c, baseUrl: e.target.value }))}
                  placeholder="http://ip:3000"
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">API Key</Label>
                <Input
                  type="password"
                  value={evolution.apiKey}
                  onChange={(e) => setEvolution((c) => ({ ...c, apiKey: e.target.value }))}
                  placeholder="Sua API Key"
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Instância</Label>
                <Input
                  value={evolution.instance}
                  onChange={(e) => setEvolution((c) => ({ ...c, instance: e.target.value }))}
                  placeholder="nexussistema"
                  className="mt-1 h-8 text-xs"
                />
              </div>
            </div>
            <Button onClick={handleSaveEvolution} variant="outline" size="sm">
              Salvar configuração
            </Button>
          </motion.div>

          {/* QR Code - só exibido quando NÃO conectado */}
          {!isConnected && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass-card p-5"
            >
              <h3 className="text-sm font-semibold text-foreground mb-2">Parear WhatsApp</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Escaneie o QR Code com o app WhatsApp para conectar a instância.
              </p>
              <div className="flex flex-col items-center gap-3">
                {!evolution.instance?.trim() ? (
                  <p className="text-sm text-muted-foreground py-8">
                    Salve a configuração com uma instância válida para gerar o QR Code.
                  </p>
                ) : loadingQr ? (
                  <div className="w-[280px] h-[280px] rounded-lg bg-muted/50 animate-pulse flex items-center justify-center">
                    <span className="text-sm text-muted-foreground">Carregando QR...</span>
                  </div>
                ) : qrResult?.ok ? (
                  <>
                    <img
                      src={getQrImageUrl(qrResult.code)}
                      alt="QR Code WhatsApp"
                      className="w-[280px] h-[280px] rounded-lg border border-border"
                    />
                    {qrResult.pairingCode && (
                      <p className="text-xs text-muted-foreground">
                        Código: <span className="font-mono font-medium text-foreground">{qrResult.pairingCode}</span>
                      </p>
                    )}
                    <Button variant="outline" size="sm" onClick={() => refetchQr()} className="gap-2">
                      <RefreshCw className="h-3 w-3" />
                      Atualizar QR Code
                    </Button>
                  </>
                ) : (
                  <div className="text-center py-6">
                    <p className="text-sm text-destructive mb-2">{qrResult?.error || "Erro ao carregar QR"}</p>
                    <Button variant="outline" size="sm" onClick={() => refetchQr()} className="gap-2">
                      <RefreshCw className="h-3 w-3" />
                      Tentar novamente
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Agendamentos - exibido quando conectado */}
          {isConnected && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass-card p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Agendamentos</h3>
                  <p className="text-xs text-muted-foreground">Configure envios automáticos de cobranças</p>
                </div>
                <NovoAgendamentoModal
                  instance={evolution.instance}
                  onCreated={refreshAgendamentos}
                  open={modalAgendamento}
                  onOpenChange={setModalAgendamento}
                />
              </div>
              {agendamentos.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6">Nenhum agendamento criado. Clique em Novo Agendamento.</p>
              ) : (
                <div className="space-y-3">
                  {agendamentos.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between py-3 px-3 rounded-lg border border-border/50 bg-muted/30"
                    >
                      <div>
                        <p className="font-medium text-foreground">{a.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.horario} • {formatDias(a.dias)} • {formatFiltros(a.filtros)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Empresa: {a.empresa} • Delay: {a.delayMinutos} min
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleAgendamentoAtivo(a)}
                        >
                          {a.ativo ? "Desativar" : "Ativar"}
                        </Button>
                        <button
                          className="text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveAgendamento(a)}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Automação manual */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card p-5"
          >
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Send className="h-4 w-4" />
              Envio manual de cobranças
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Cobranças (vencidos), cobranças (vencem hoje) e lembretes (vencem amanhã).
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[200px]">
                <Label className="text-xs">Chave PIX para mensagens</Label>
                <Select value={selectedPixId} onValueChange={setSelectedPixId}>
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue placeholder="Selecione uma chave" />
                  </SelectTrigger>
                  <SelectContent>
                    {pixKeys.map((p: Record<string, unknown>) => (
                      <SelectItem key={String(p.id)} value={String(p.id)}>
                        {String(p.bank)} – {String(p.holder)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleOpenCobrancaDelayModal}
                disabled={isSending || !selectedPixId}
                className="gap-2"
              >
                <Send className="h-4 w-4" />
                {isSending ? "Enviando..." : "Enviar cobranças agora"}
              </Button>
            </div>
          </motion.div>

          {/* Modal: intervalo entre envios */}
          <Dialog open={delayModalOpen} onOpenChange={setDelayModalOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Intervalo entre envios</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Defina quantos minutos esperar entre o envio de uma mensagem e a próxima (0 = sem pausa).
              </p>
              <div className="space-y-4 mt-3">
                <div className="space-y-2">
                  <Label htmlFor="delay-minutes" className="text-xs">
                    Delay (minutos)
                  </Label>
                  <Input
                    id="delay-minutes"
                    type="number"
                    min={0}
                    step={0.5}
                    value={delayMinutes}
                    onChange={(e) => setDelayMinutes(e.target.value)}
                    className="h-9"
                  />
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Tipos para enviar</p>
                  <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={sendTypes.cobranca}
                        onCheckedChange={(checked) =>
                          setSendTypes((prev) => ({ ...prev, cobranca: Boolean(checked) }))
                        }
                      />
                      <span>Cobranças (vencidos)</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={sendTypes.lembrete_hoje}
                        onCheckedChange={(checked) =>
                          setSendTypes((prev) => ({ ...prev, lembrete_hoje: Boolean(checked) }))
                        }
                      />
                      <span>Cobranças (vencem hoje)</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={sendTypes.lembrete_amanha}
                        onCheckedChange={(checked) =>
                          setSendTypes((prev) => ({ ...prev, lembrete_amanha: Boolean(checked) }))
                        }
                      />
                      <span>Lembretes (vencem amanhã)</span>
                    </label>
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setDelayModalOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleConfirmDelayAndStartQueue} className="gap-2">
                  <Send className="h-4 w-4" />
                  Iniciar fila
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Modal: fila de envio (atual, próximo, interromper) */}
          <Dialog open={queueModalOpen} onOpenChange={handleQueueModalOpenChange}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Fila de cobranças</DialogTitle>
              </DialogHeader>

              {queuePhase === "loading" ? (
                <p className="text-sm text-muted-foreground">Montando a lista de clientes...</p>
              ) : (
                <div className="space-y-3 text-sm">
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Enviando agora</p>
                    <p className="font-medium text-foreground mt-1">{queueCurrentName || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Próximo na fila</p>
                    <p className="font-medium text-foreground mt-1">{queueNextName || "—"}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Progresso: {queueStats.total ? `${queueStats.done} / ${queueStats.total}` : "—"} · Sucesso:{" "}
                    {queueStats.sent} · Falhas: {queueStats.failed}
                    {queuePhase === "waiting" ? " · aguardando intervalo" : ""}
                  </p>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Log de mensagens</p>
                    <ScrollArea className="h-44 rounded-lg border border-border/40">
                      <div className="p-3 space-y-2">
                        {queueLogs.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Nenhuma mensagem enviada ainda.</p>
                        ) : (
                          queueLogs.map((l) => (
                            <div
                              key={`${l.idx}-${l.clientName}`}
                              className="rounded-md border border-border/30 bg-muted/10 p-2"
                            >
                              <p className="text-xs font-medium text-foreground">
                                {l.clientName}{" "}
                                <span className="text-muted-foreground font-normal">
                                  ·{" "}
                                  {l.type === "cobranca"
                                    ? "Cobrança"
                                    : l.type === "lembrete_hoje"
                                      ? "Cobrança (vencem hoje)"
                                      : "Lembrete (vencem amanhã)"}
                                </span>
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

                  {queuePhase === "done" ? (
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Relatório final</p>
                      <p className="text-sm font-medium text-foreground mt-1">
                        Sucesso: {queueStats.sent} · Falhas: {queueStats.failed}
                      </p>
                      {queueStats.failed > 0 ? (
                        <div className="mt-2 space-y-2">
                          {queueLogs
                            .filter((l) => l.status === "failed")
                            .map((l) => (
                              <div key={`fail-${l.idx}-${l.clientName}`} className="text-xs">
                                <p className="font-medium text-destructive">{l.clientName}</p>
                                <p className="text-muted-foreground break-words">{l.error || "Motivo não informado"}</p>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-2">Nenhuma falha registrada.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                {queuePhase === "loading" ? (
                  <Button
                    variant="outline"
                    className="gap-2 w-full sm:w-auto"
                    onClick={() => {
                      abortQueueRef.current = true;
                      setQueueModalOpen(false);
                    }}
                  >
                    <StopCircle className="h-4 w-4" />
                    Cancelar
                  </Button>
                ) : queuePhase !== "done" && isSending ? (
                  <Button variant="destructive" className="gap-2 w-full sm:w-auto" onClick={handleInterruptQueue}>
                    <StopCircle className="h-4 w-4" />
                    Interromper
                  </Button>
                ) : (
                  <span />
                )}
                {queuePhase === "done" ? (
                  <Button className="w-full sm:w-auto" onClick={() => setQueueModalOpen(false)}>
                    Fechar
                  </Button>
                ) : null}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="pix" className="mt-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-5"
          >
            <h3 className="text-sm font-semibold text-foreground mb-4">Chaves PIX</h3>
            <div className="space-y-3">
              {pixKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma chave PIX cadastrada</p>
              ) : (
                pixKeys.map((p: Record<string, unknown>) => (
                  <div key={String(p.id)} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-foreground">{String(p.bank)} — {String(p.type)}</p>
                      <p className="text-xs text-muted-foreground font-mono">{String(p.key)}</p>
                    </div>
                    <button className="text-muted-foreground hover:text-destructive transition-colors text-sm">Remover</button>
                  </div>
                ))
              )}
            </div>
            <Button variant="outline" size="sm" className="mt-4 gap-2 nexus-input">
              <Plus className="h-3 w-3" />
              Adicionar Chave PIX
            </Button>
          </motion.div>
        </TabsContent>

        <TabsContent value="categorias" className="mt-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-5"
          >
            <h3 className="text-sm font-semibold text-foreground mb-4">Categorias de Despesas</h3>
            <div className="space-y-2">
              {categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada</p>
              ) : (
                categories.map((c: Record<string, unknown>) => (
                  <div key={String(c.id)} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-foreground">{String(c.name)}</p>
                      <p className="text-xs text-muted-foreground">{String(c.description)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <Button variant="outline" size="sm" className="mt-4 gap-2 nexus-input">
              <Plus className="h-3 w-3" />
              Adicionar Categoria
            </Button>
          </motion.div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
