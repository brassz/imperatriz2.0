import { Plus, MessageCircle, Send, KeyRound, FolderOpen, RefreshCw, Clock, Calendar, StopCircle, ListChecks, Play, Pause, BadgePercent, FileDown } from "lucide-react";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deactivatePixKey, fetchPixKeys, insertPixKey } from "@/api/pix-keys";
import { fetchExpenseCategories } from "@/api/categories";
import { getEvolutionConfig, saveEvolutionConfig } from "@/lib/evolution-settings";
import { getSupabaseCompany } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchWhatsAppSchedules,
  insertWhatsAppSchedule,
  updateWhatsAppSchedule,
  deleteWhatsAppSchedule,
  migrateLocalSchedulesToSupabase,
} from "@/api/whatsapp-schedules";
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { fetchLoansForAutomation, type AutomationLoan } from "@/api/automation";
import { fetchInstallments, type InstallmentRow } from "@/api/installments";
import { fetchClientsForSelect } from "@/api/clients";
import { fetchCommissionRows, fetchCommissionSummary } from "@/api/commissions";
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
import { type Agendamento, type DiaSemana, type FiltroAgendamento } from "@/lib/agendamentos";
import { PDF_BRAND } from "@/lib/pdf-branding";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx-js-style";

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
  { value: "vencidos", label: "Vencidos" },
  { value: "vencem_hoje", label: "Vencem hoje" },
  { value: "lembretes", label: "Lembretes (vencem amanhã)" },
  { value: "parcelamentos", label: "Parcelamentos" },
];

function formatPreviewCurrency(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPreviewDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

function nextPendingInstallment(inst: InstallmentRow) {
  const pending = inst.installment_payments
    .filter((p) => p.status === "pending")
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  return pending[0] ?? null;
}

function labelTipoAutomacao(t: AutomationLoan["type"]): string {
  switch (t) {
    case "cobranca":
      return "Vencido";
    case "lembrete_hoje":
      return "Vence hoje";
    case "lembrete_amanha":
      return "Lembrete (amanhã)";
    default:
      return t;
  }
}

function NovoAgendamentoModal({
  evolution,
  pixInfo,
  onCreated,
  open,
  onOpenChange,
}: {
  evolution: { baseUrl: string; apiKey: string; instance: string };
  pixInfo: PixInfo | null;
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
  const [targetClientIds, setTargetClientIds] = useState<string[]>([]);
  const [clientSearch, setClientSearch] = useState("");

  const { data: clientsSelect = [] } = useQuery({
    queryKey: ["clients-select-agendamento"],
    queryFn: fetchClientsForSelect,
    enabled: open,
  });

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clientsSelect;
    return clientsSelect.filter((c) => (c.name || "").toLowerCase().includes(q));
  }, [clientsSelect, clientSearch]);

  const { data: modalPreviewLoans = [], isLoading: loadingModalLoans } = useQuery({
    queryKey: ["agendamento-modal-loans-preview"],
    queryFn: () => fetchLoansForAutomation({ requirePhone: false }),
    enabled: open,
    staleTime: 30_000,
  });
  const { data: modalInstallments = [], isLoading: loadingModalInst } = useQuery({
    queryKey: ["agendamento-modal-installments-preview"],
    queryFn: fetchInstallments,
    enabled: open,
    staleTime: 30_000,
  });

  const modalVencidos = useMemo(
    () => modalPreviewLoans.filter((l) => l.type === "cobranca"),
    [modalPreviewLoans],
  );
  const modalVencemHoje = useMemo(
    () => modalPreviewLoans.filter((l) => l.type === "lembrete_hoje"),
    [modalPreviewLoans],
  );
  const modalLembretes = useMemo(
    () => modalPreviewLoans.filter((l) => l.type === "lembrete_amanha"),
    [modalPreviewLoans],
  );
  const modalParcelRows = useMemo(() => {
    return modalInstallments
      .map((inst) => {
        const next = nextPendingInstallment(inst);
        if (!next) return null;
        return { inst, next };
      })
      .filter(
        (x): x is {
          inst: InstallmentRow;
          next: NonNullable<ReturnType<typeof nextPendingInstallment>>;
        } => x !== null,
      );
  }, [modalInstallments]);

  function renderLoanPreviewRow(item: AutomationLoan) {
    return (
      <div
        key={item.id}
        className="text-xs border-b border-border/40 pb-2 mb-2 last:border-0 last:pb-0 last:mb-0"
      >
        <p className="font-medium text-foreground">{item.loan.client_name}</p>
        <p className="text-muted-foreground">
          <span className="text-muted-foreground/80">{labelTipoAutomacao(item.type)}</span>
          {" · "}
          Venc. {formatPreviewDate(item.loan.due_date)} · {formatPreviewCurrency(item.loan.amount)}
        </p>
        {!item.loan.client_phone?.trim() ? (
          <p className="text-amber-600 dark:text-amber-500 mt-0.5">Sem telefone</p>
        ) : (
          <p className="text-muted-foreground mt-0.5">{item.loan.client_phone}</p>
        )}
      </div>
    );
  }

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

  const handleCriar = async () => {
    if (filtros.length === 0) {
      setErroFiltro("Selecione pelo menos um filtro");
      return;
    }
    if (!pixInfo?.chave?.trim()) {
      toast.error("Selecione uma chave PIX na seção «Envio manual de cobranças» abaixo.");
      return;
    }
    if (!evolution.instance?.trim()) {
      toast.error("Preencha e salve a instância Evolution acima.");
      return;
    }
    try {
      await insertWhatsAppSchedule({
        nome: nome.trim() || "Agendamento sem nome",
        instance: evolution.instance,
        empresa,
        horario,
        dias,
        filtros,
        delayMinutos,
        ativo,
        evolutionBaseUrl: evolution.baseUrl,
        evolutionApiKey: evolution.apiKey,
        pixTipo: pixInfo.tipo,
        pixTitular: pixInfo.titular,
        pixChave: pixInfo.chave,
        targetClientIds,
      });
      toast.success("Agendamento salvo no servidor");
      onCreated();
      onOpenChange(false);
      setNome("");
      setHorario("08:00");
      setDias(["todos"]);
      setFiltros([]);
      setDelayMinutos(7);
      setAtivo(true);
      setTargetClientIds([]);
      setClientSearch("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar agendamento (rode o SQL da tabela no Supabase?)");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Novo Agendamento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
            <Input value={evolution.instance} disabled className="mt-1 bg-muted" />
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
          {filtros.length > 0 && (
            <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-3">
              <p className="text-[11px] text-muted-foreground leading-snug">
                Prévia conforme os filtros marcados (data de hoje em America/Sao_Paulo, igual ao envio automático).
                Lembretes = contratos com vencimento amanhã.
              </p>
              {loadingModalLoans || loadingModalInst ? (
                <p className="text-xs text-muted-foreground">Carregando prévia...</p>
              ) : (
                <div className="space-y-3">
                  {filtros.includes("vencidos") && (
                    <div>
                      <p className="text-xs font-semibold">Vencidos ({modalVencidos.length})</p>
                      <ScrollArea className="h-[min(120px,28vh)] mt-1 rounded border bg-background/50 p-2">
                        <div className="pr-2">
                          {modalVencidos.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nenhum nesta categoria agora.</p>
                          ) : (
                            modalVencidos.map(renderLoanPreviewRow)
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                  {filtros.includes("vencem_hoje") && (
                    <div>
                      <p className="text-xs font-semibold">Vencem hoje ({modalVencemHoje.length})</p>
                      <ScrollArea className="h-[min(120px,28vh)] mt-1 rounded border bg-background/50 p-2">
                        <div className="pr-2">
                          {modalVencemHoje.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nenhum nesta categoria agora.</p>
                          ) : (
                            modalVencemHoje.map(renderLoanPreviewRow)
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                  {filtros.includes("lembretes") && (
                    <div>
                      <p className="text-xs font-semibold">Lembretes — vencem amanhã ({modalLembretes.length})</p>
                      <ScrollArea className="h-[min(120px,28vh)] mt-1 rounded border bg-background/50 p-2">
                        <div className="pr-2">
                          {modalLembretes.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nenhum nesta categoria agora.</p>
                          ) : (
                            modalLembretes.map(renderLoanPreviewRow)
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                  {filtros.includes("parcelamentos") && (
                    <div>
                      <p className="text-xs font-semibold">
                        Parcelamentos — próxima parcela pendente ({modalParcelRows.length})
                      </p>
                      <ScrollArea className="h-[min(120px,28vh)] mt-1 rounded border bg-background/50 p-2">
                        <div className="pr-2">
                          {modalParcelRows.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nenhum parcelamento com parcela pendente.</p>
                          ) : (
                            modalParcelRows.map(({ inst, next }) => (
                              <div
                                key={inst.id}
                                className="text-xs border-b border-border/40 pb-2 mb-2 last:border-0 last:pb-0 last:mb-0"
                              >
                                <p className="font-medium text-foreground">{inst.client_name}</p>
                                <p className="text-muted-foreground">
                                  {formatPreviewCurrency(next.amount)} · venc. {formatPreviewDate(next.due_date)}
                                </p>
                                {!inst.client_phone?.trim() ? (
                                  <p className="text-amber-600 dark:text-amber-500 mt-0.5">Sem telefone</p>
                                ) : (
                                  <p className="text-muted-foreground mt-0.5">{inst.client_phone}</p>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <div>
            <Label className="text-xs">Clientes (opcional)</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
              Sem seleção = todos os elegíveis pelos filtros no dia do envio. Marque para limitar a estes clientes (empréstimos e parcelamentos).
            </p>
            <Input
              placeholder="Buscar cliente..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="h-8 text-xs mb-2"
            />
            <ScrollArea className="h-[140px] rounded-md border border-border/60 p-2">
              <div className="space-y-1 pr-3">
                {filteredClients.map((c) => {
                  const id = String(c.id);
                  return (
                    <label key={id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                      <Checkbox
                        checked={targetClientIds.includes(id)}
                        onCheckedChange={() =>
                          setTargetClientIds((prev) =>
                            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                          )
                        }
                      />
                      <span className="truncate">{c.name}</span>
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
            <div className="flex flex-wrap gap-2 mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setTargetClientIds(filteredClients.map((c) => String(c.id)))}
              >
                Marcar visíveis
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setTargetClientIds([])}
              >
                Limpar seleção
              </Button>
            </div>
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
  const { user } = useAuth();
  const companyId = getSupabaseCompany();
  const queryClient = useQueryClient();
  const config = getEvolutionConfig();
  const [evolution, setEvolution] = useState({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    instance: config.instance,
  });
  const [selectedPixId, setSelectedPixId] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [delayModalOpen, setDelayModalOpen] = useState(false);
  /** IDs dos empréstimos (fila manual) marcados para envio */
  const [manualQueueSelection, setManualQueueSelection] = useState<string[]>([]);
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
  const migratedSchedulesRef = useRef(false);
  const [activeTab, setActiveTab] = useState("whatsapp");
  const [modalAgendamento, setModalAgendamento] = useState(false);
  const [pixModalOpen, setPixModalOpen] = useState(false);
  const [pixForm, setPixForm] = useState({
    bank_name: "",
    account_holder: "",
    pix_key_type: "CNPJ",
    pix_key: "",
  });
  const [commDateFrom, setCommDateFrom] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}-01`;
  });
  const [commDateTo, setCommDateTo] = useState(() => new Date().toISOString().split("T")[0]);

  const {
    data: commissionSummary,
    isLoading: loadingCommissions,
    error: commissionsError,
  } = useQuery({
    queryKey: ["commissions", commDateFrom, commDateTo],
    queryFn: () => fetchCommissionSummary(commDateFrom, commDateTo),
    enabled:
      activeTab === "comissoes" &&
      !!commDateFrom &&
      !!commDateTo &&
      commDateFrom <= commDateTo,
    staleTime: 30_000,
  });

  const {
    data: agendamentos = [],
    refetch: refetchAgendamentos,
    isLoading: loadingAgendamentos,
  } = useQuery({
    queryKey: ["whatsapp-schedules", user?.id, companyId],
    queryFn: fetchWhatsAppSchedules,
    enabled: activeTab === "whatsapp" && !!user?.id,
  });

  const {
    data: previewLoans = [],
    isLoading: loadingPreviewLoans,
    isFetching: fetchingPreviewLoans,
    refetch: refetchPreviewLoans,
    error: previewLoansError,
  } = useQuery({
    queryKey: ["config-whatsapp-automation-preview"],
    queryFn: () => fetchLoansForAutomation({ requirePhone: false }),
    enabled: activeTab === "whatsapp",
    staleTime: 60_000,
  });

  const {
    data: installmentPreview = [],
    isLoading: loadingInstallmentsPreview,
    isFetching: fetchingInstallmentsPreview,
    refetch: refetchInstallmentsPreview,
  } = useQuery({
    queryKey: ["config-whatsapp-installments-preview"],
    queryFn: fetchInstallments,
    enabled: activeTab === "whatsapp",
    staleTime: 60_000,
  });

  const previewVencidos = useMemo(
    () => previewLoans.filter((l) => l.type === "cobranca"),
    [previewLoans],
  );
  const previewVencemHoje = useMemo(
    () => previewLoans.filter((l) => l.type === "lembrete_hoje"),
    [previewLoans],
  );
  const previewLembretes = useMemo(
    () => previewLoans.filter((l) => l.type === "lembrete_amanha"),
    [previewLoans],
  );
  const previewParcelamentosRows = useMemo(() => {
    return installmentPreview
      .map((inst) => {
        const next = nextPendingInstallment(inst);
        if (!next) return null;
        return { inst, next };
      })
      .filter((x): x is { inst: InstallmentRow; next: NonNullable<ReturnType<typeof nextPendingInstallment>> } => x !== null);
  }, [installmentPreview]);

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

  useEffect(() => {
    if (activeTab !== "whatsapp" || !user?.id) return;
    if (migratedSchedulesRef.current) return;
    const pix = getPixInfoForAutomation();
    if (!pix?.chave?.trim()) return;
    migratedSchedulesRef.current = true;
    void migrateLocalSchedulesToSupabase(evolution, {
      tipo: pix.tipo,
      titular: pix.titular,
      chave: pix.chave,
    })
      .then((n) => {
        if (n > 0) {
          toast.success(`${n} agendamento(s) migrados para o servidor.`);
          void refetchAgendamentos();
        }
      })
      .catch(() => {
        migratedSchedulesRef.current = false;
      });
  }, [activeTab, user?.id, evolution, selectedPixId, getPixInfoForAutomation, refetchAgendamentos]);

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
      setManualQueueSelection(loans.map((l) => l.id));
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
        (l) =>
          manualQueueSelection.includes(l.id) &&
          l.loan.client_phone?.trim() &&
          activeTypes.has(l.type),
      );

      if (toSend.length === 0) {
        if (manualQueueSelection.length === 0) {
          toast.error("Selecione ao menos um destinatário na lista.");
        } else {
          toast.info("Nenhum destinatário selecionado com telefone e tipo de envio compatível.");
        }
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

  const toggleAgendamentoAtivo = async (a: Agendamento) => {
    try {
      await updateWhatsAppSchedule(a.id, { ativo: !a.ativo });
      await refetchAgendamentos();
      toast.success(a.ativo ? "Agendamento desativado" : "Agendamento ativado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar agendamento");
    }
  };

  const handleRemoveAgendamento = async (a: Agendamento) => {
    try {
      await deleteWhatsAppSchedule(a.id);
      await refetchAgendamentos();
      toast.success("Agendamento removido");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover agendamento");
    }
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
        <TabsList className="grid w-full max-w-xl grid-cols-4">
          <TabsTrigger value="whatsapp" className="gap-2">
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="pix" className="gap-2">
            <KeyRound className="h-4 w-4" />
            Chaves PIX
          </TabsTrigger>
          <TabsTrigger value="comissoes" className="gap-2">
            <BadgePercent className="h-4 w-4" />
            Comissões
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

          {/* Prévia: mesmas bases usadas no envio manual / agendamentos */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 }}
            className="glass-card p-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <ListChecks className="h-4 w-4" />
                  Prévia para cobrança (empréstimos e parcelamentos)
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                  Vencidos, vencem hoje e Lembretes (vencem amanhã) vêm dos empréstimos com vencimento até amanhã. Parcelamentos: contratos ativos com próxima parcela pendente.
                  Clientes sem telefone aparecem aqui, mas não entram na fila de envio até cadastrar o número.
                </p>
                {previewLoansError ? (
                  <p className="text-xs text-destructive mt-2">
                    {previewLoansError instanceof Error ? previewLoansError.message : "Erro ao carregar empréstimos."}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 shrink-0"
                disabled={loadingPreviewLoans || fetchingPreviewLoans || loadingInstallmentsPreview || fetchingInstallmentsPreview}
                onClick={() => {
                  void refetchPreviewLoans();
                  void refetchInstallmentsPreview();
                }}
              >
                <RefreshCw className="h-3 w-3" />
                Atualizar listas
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {(
                [
                  {
                    title: "Vencidos",
                    items: previewVencidos,
                    empty: "Nenhum empréstimo vencido neste critério.",
                  },
                  {
                    title: "Vencem hoje",
                    items: previewVencemHoje,
                    empty: "Nenhum empréstimo com vencimento hoje.",
                  },
                  {
                    title: "Lembretes",
                    items: previewLembretes,
                    empty: "Nenhum empréstimo com vencimento amanhã.",
                  },
                  {
                    title: "Parcelamentos (próx. pendente)",
                    items: null as AutomationLoan[] | null,
                    empty: "",
                    isParcel: true,
                  },
                ] as const
              ).map((col) => (
                <div
                  key={col.title}
                  className="rounded-lg border border-border/60 bg-muted/20 flex flex-col min-h-[200px]"
                >
                  <div className="px-3 py-2 border-b border-border/50 bg-muted/30">
                    <p className="text-xs font-semibold text-foreground">
                      {col.title}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        (
                        {"isParcel" in col && col.isParcel
                          ? previewParcelamentosRows.length
                          : col.items.length}
                        )
                      </span>
                    </p>
                  </div>
                  <ScrollArea className="flex-1 min-h-[180px] max-h-[280px]">
                    <div className="p-3 space-y-2">
                      {loadingPreviewLoans || loadingInstallmentsPreview ? (
                        <p className="text-xs text-muted-foreground">Carregando...</p>
                      ) : "isParcel" in col && col.isParcel ? (
                        previewParcelamentosRows.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Nenhum parcelamento com parcela pendente.</p>
                        ) : (
                          previewParcelamentosRows.map(({ inst, next }) => (
                            <div
                              key={inst.id}
                              className="text-xs border-b border-border/40 pb-2 mb-2 last:border-0 last:pb-0 last:mb-0"
                            >
                              <p className="font-medium text-foreground">{inst.client_name}</p>
                              <p className="text-muted-foreground">
                                {formatPreviewCurrency(next.amount)} · venc. {formatPreviewDate(next.due_date)}
                              </p>
                              {!inst.client_phone?.trim() ? (
                                <p className="text-amber-600 dark:text-amber-500 mt-0.5">Sem telefone</p>
                              ) : (
                                <p className="text-muted-foreground mt-0.5">{inst.client_phone}</p>
                              )}
                            </div>
                          ))
                        )
                      ) : col.items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{col.empty}</p>
                      ) : (
                        col.items.map((item) => (
                          <div
                            key={item.id}
                            className="text-xs border-b border-border/40 pb-2 mb-2 last:border-0 last:pb-0 last:mb-0"
                          >
                            <p className="font-medium text-foreground">{item.loan.client_name}</p>
                            <p className="text-muted-foreground">
                              Venc. {formatPreviewDate(item.loan.due_date)} ·{" "}
                              {formatPreviewCurrency(item.loan.amount)}
                            </p>
                            {!item.loan.client_phone?.trim() ? (
                              <p className="text-amber-600 dark:text-amber-500 mt-0.5">Sem telefone</p>
                            ) : (
                              <p className="text-muted-foreground mt-0.5">{item.loan.client_phone}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              ))}
            </div>
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

          {/* Agendamentos — persistidos no Supabase; execução no servidor (PM2/cron + scripts/whatsapp-scheduler.mjs) */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="glass-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Agendamentos de envio</h3>
                <p className="text-xs text-muted-foreground">
                  Roda no servidor (não depende do seu PC). A Evolution API e o WhatsApp precisam estar online no mesmo horário.
                </p>
              </div>
              <NovoAgendamentoModal
                evolution={evolution}
                pixInfo={getPixInfoForAutomation()}
                onCreated={() => void refetchAgendamentos()}
                open={modalAgendamento}
                onOpenChange={setModalAgendamento}
              />
            </div>
            {!user?.id ? (
              <p className="text-sm text-muted-foreground py-4">Faça login para gerenciar agendamentos na nuvem.</p>
            ) : loadingAgendamentos ? (
              <p className="text-sm text-muted-foreground py-6">Carregando agendamentos...</p>
            ) : agendamentos.length === 0 ? (
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
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Clientes:{" "}
                          {a.targetClientIds?.length
                            ? `${a.targetClientIds.length} restrito(s)`
                            : "todos os elegíveis pelos filtros"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant={a.ativo ? "secondary" : "outline"}
                          size="icon"
                          className="h-8 w-8"
                          title={a.ativo ? "Pausar agendamento" : "Iniciar agendamento"}
                          onClick={() => toggleAgendamentoAtivo(a)}
                        >
                          {a.ativo ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
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

          {/* Modal: intervalo + seleção de destinatários */}
          <Dialog open={delayModalOpen} onOpenChange={setDelayModalOpen}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Enviar cobranças — fila</DialogTitle>
              </DialogHeader>
              {loadingAutomationLoans ? (
                <p className="text-sm text-muted-foreground py-4">Carregando lista de empréstimos...</p>
              ) : !automationLoans?.length ? (
                <p className="text-sm text-muted-foreground py-4">
                  Nenhum empréstimo elegível (vencidos, hoje ou amanhã) no momento.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Marque quem entra na fila. Defina o intervalo entre mensagens (0 = sem pausa).
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

                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-xs">Destinatários (empréstimos)</Label>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              setManualQueueSelection(automationLoans.map((l) => l.id))
                            }
                          >
                            Marcar todos
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setManualQueueSelection([])}
                          >
                            Desmarcar todos
                          </Button>
                        </div>
                      </div>
                      <ScrollArea className="h-[220px] rounded-md border border-border/60 p-2">
                        <div className="space-y-2 pr-3">
                          {automationLoans.map((item) => (
                            <label
                              key={item.id}
                              className="flex items-start gap-2 text-xs cursor-pointer rounded-md p-1.5 hover:bg-muted/40"
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={manualQueueSelection.includes(item.id)}
                                onCheckedChange={(checked) => {
                                  setManualQueueSelection((prev) => {
                                    if (checked) {
                                      return prev.includes(item.id) ? prev : [...prev, item.id];
                                    }
                                    return prev.filter((x) => x !== item.id);
                                  });
                                }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="font-medium text-foreground">{item.loan.client_name}</span>
                                <span className="text-muted-foreground"> · {labelTipoAutomacao(item.type)}</span>
                                <span className="block text-muted-foreground mt-0.5">
                                  Venc. {formatPreviewDate(item.loan.due_date)} ·{" "}
                                  {formatPreviewCurrency(item.loan.amount)}
                                  {!item.loan.client_phone?.trim() ? (
                                    <span className="text-amber-600 dark:text-amber-500"> · sem telefone</span>
                                  ) : null}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                </>
              )}
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setDelayModalOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleConfirmDelayAndStartQueue}
                  className="gap-2"
                  disabled={
                    loadingAutomationLoans ||
                    !automationLoans?.length ||
                    manualQueueSelection.length === 0
                  }
                >
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

        <TabsContent value="comissoes" className="mt-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-5"
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Comissões</h3>
                <p className="text-xs text-muted-foreground">
                  Base = juros dos pagamentos + parcelas pagas dos parcelamentos.
                </p>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <Label className="text-[11px]">De</Label>
                  <Input
                    type="date"
                    value={commDateFrom}
                    onChange={(e) => setCommDateFrom(e.target.value)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Até</Label>
                  <Input
                    type="date"
                    value={commDateTo}
                    onChange={(e) => setCommDateTo(e.target.value)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2"
                  disabled={loadingCommissions || !commissionSummary}
                  onClick={async () => {
                    try {
                      const rows = await fetchCommissionRows(commDateFrom, commDateTo);

                      const formatBR = (ymd: string) => {
                        const [y, m, d] = String(ymd).split("T")[0].split("-");
                        return d && m && y ? `${d}/${m}/${y}` : ymd;
                      };
                      const title = `ACERTO - ${formatBR(commDateFrom)} / ${formatBR(commDateTo)}`;

                      const sheet = "Extrato Ton";
                      const aoa: any[][] = [];
                      aoa.push([title]);
                      aoa.push(["Vinicius", Number(commissionSummary.vinicius || 0)]);
                      aoa.push(["Douglas", Number(commissionSummary.douglas || 0)]);
                      aoa.push(["Tipo", "Valor", "Data", "Situação", "Comissão", "Multa", "Origem"]);

                      // No modelo: "Comissão" é o valor-base da linha.
                      // Para "Quitado", exibimos o último valor pago em "Valor" e "Comissão" fica "-".
                      const headerRowIndex = 3; // 0-based row where headers live
                      for (const r of rows) {
                        const isQuitado = r.situacao === "Quitado" || r.tipo === "Quitado";
                        aoa.push([
                          r.tipo,
                          isQuitado ? Number(r.valor || 0) : Number(r.valor || 0),
                          formatBR(r.data),
                          r.situacao,
                          isQuitado ? "-" : Number(r.valor || 0),
                          r.multa || "",
                          r.origem,
                        ]);
                      }

                      const wb = XLSX.utils.book_new();
                      const ws = XLSX.utils.aoa_to_sheet(aoa);
                      ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
                      ws["!cols"] = [
                        { wch: 12 }, // Tipo
                        { wch: 12 }, // Valor
                        { wch: 18 }, // Data
                        { wch: 12 }, // Situação
                        { wch: 12 }, // Comissão
                        { wch: 18 }, // Multa
                        { wch: 55 }, // Origem
                      ];

                      // Estilos: cabeçalho profissional + tabela
                      const teal = "14B8A6";
                      const tealDark = "0D9488";
                      const softBg = "F8FAFC";
                      const grid = "E2E8F0";
                      const red = "C00000";

                      const redFont = { color: { rgb: red }, bold: true };
                      const headerFont = { bold: true, color: { rgb: "000000" } };
                      const titleFont = { bold: true, sz: 15, color: { rgb: "FFFFFF" } };
                      const titleSubFont = { bold: true, color: { rgb: "FFFFFF" } };

                      // Fundo do topo (A1:G3)
                      for (let r = 0; r <= 2; r++) {
                        for (let c = 0; c <= 6; c++) {
                          const addr = XLSX.utils.encode_cell({ r, c });
                          const cell = ws[addr] || (ws[addr] = { t: "s", v: "" } as any);
                          cell.s = {
                            fill: { fgColor: { rgb: r === 0 ? tealDark : teal } },
                            border: {
                              top: { style: "thin", color: { rgb: tealDark } },
                              bottom: { style: "thin", color: { rgb: tealDark } },
                              left: { style: "thin", color: { rgb: tealDark } },
                              right: { style: "thin", color: { rgb: tealDark } },
                            },
                          };
                        }
                      }

                      // Título (A1)
                      const a1 = ws["A1"];
                      if (a1) a1.s = { ...(a1.s || {}), font: titleFont, alignment: { horizontal: "center", vertical: "center" } };

                      // Vinicius / Douglas (topo)
                      const a2 = ws["A2"]; const b2 = ws["B2"];
                      const a3 = ws["A3"]; const b3 = ws["B3"];
                      if (a2) a2.s = { ...(a2.s || {}), font: titleSubFont, alignment: { horizontal: "left" } };
                      if (a3) a3.s = { ...(a3.s || {}), font: titleSubFont, alignment: { horizontal: "left" } };
                      if (b2) {
                        b2.z = '"R$" #,##0.00';
                        b2.s = { ...(b2.s || {}), font: titleSubFont, alignment: { horizontal: "left" } };
                      }
                      if (b3) {
                        b3.z = '"R$" #,##0.00';
                        b3.s = { ...(b3.s || {}), font: titleSubFont, alignment: { horizontal: "left" } };
                      }

                      // Header row styles (row 4 in Excel => index 4? Actually aoa header row is row 4 => 1-based 4)
                      for (let c = 0; c <= 6; c++) {
                        const addr = XLSX.utils.encode_cell({ r: headerRowIndex, c });
                        const cell = ws[addr];
                        if (cell) {
                          cell.s = {
                            font: { ...headerFont, color: { rgb: "0F172A" } },
                            fill: { fgColor: { rgb: softBg } },
                            border: {
                              top: { style: "thin", color: { rgb: grid } },
                              bottom: { style: "thin", color: { rgb: grid } },
                              left: { style: "thin", color: { rgb: grid } },
                              right: { style: "thin", color: { rgb: grid } },
                            },
                          };
                        }
                      }

                      // Apply red style to quitado rows
                      for (let rIdx = headerRowIndex + 1; rIdx < aoa.length; rIdx++) {
                        const tipo = aoa[rIdx]?.[0];
                        const situ = aoa[rIdx]?.[3];
                        if (tipo === "Quitado" || situ === "Quitado") {
                          for (let c = 0; c <= 6; c++) {
                            const addr = XLSX.utils.encode_cell({ r: rIdx, c });
                            const cell = ws[addr];
                            if (cell) {
                              cell.s = {
                                ...(cell.s || {}),
                                font: redFont,
                              };
                            }
                          }
                        }
                      }

                      XLSX.utils.book_append_sheet(wb, ws, sheet);

                      const fileName = `ACERTO - ${formatBR(commDateFrom)} - ${formatBR(commDateTo)}.xlsx`;
                      XLSX.writeFile(wb, fileName);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Erro ao gerar Excel");
                    }
                  }}
                >
                  <FileDown className="h-4 w-4" />
                  Excel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2"
                  disabled={loadingCommissions || !commissionSummary}
                  onClick={async () => {
                    try {
                      const rows = await fetchCommissionRows(commDateFrom, commDateTo);
                      const fmtMoney = (n: number) =>
                        n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                      const formatBR = (ymd: string) => {
                        const [y, m, d] = String(ymd).split("T")[0].split("-");
                        return d && m && y ? `${d}/${m}/${y}` : ymd;
                      };

                      const doc = new jsPDF();
                      const pageW = doc.internal.pageSize.getWidth();
                      const pageH = doc.internal.pageSize.getHeight();

                      const teal = PDF_BRAND.colors.primary;
                      const tealDark = PDF_BRAND.colors.primaryDark;
                      const line = PDF_BRAND.colors.line;

                      // Fundo suave da página
                      doc.setFillColor(248, 250, 252);
                      doc.rect(0, 0, pageW, pageH, "F");

                      // Cabeçalho com cor
                      doc.setFillColor(tealDark.r, tealDark.g, tealDark.b);
                      doc.rect(0, 0, pageW, 18, "F");
                      doc.setFillColor(teal.r, teal.g, teal.b);
                      doc.rect(0, 18, pageW, 6, "F");

                      doc.setTextColor(255, 255, 255);
                      doc.setFont("helvetica", "bold");
                      doc.setFontSize(13);
                      doc.text("ACERTO (COMISSÕES)", pageW / 2, 12, { align: "center" });

                      doc.setTextColor(255, 255, 255);
                      doc.setFont("helvetica", "normal");
                      doc.setFontSize(9);
                      doc.text(
                        `${PDF_BRAND.companyName} · ${PDF_BRAND.branch} · ${formatBR(commDateFrom)} a ${formatBR(commDateTo)}`,
                        pageW / 2,
                        22,
                        { align: "center" },
                      );

                      // Card de resumo
                      let y = 34;
                      doc.setDrawColor(line.r, line.g, line.b);
                      doc.setFillColor(255, 255, 255);
                      doc.roundedRect(14, y, pageW - 28, 28, 3, 3, "FD");
                      y += 8;
                      doc.setTextColor(30, 41, 59);
                      doc.setFont("helvetica", "bold");
                      doc.setFontSize(11);
                      doc.text(`Base total: ${fmtMoney(commissionSummary.baseTotal)}`, 18, y);
                      y += 7;
                      doc.setFont("helvetica", "normal");
                      doc.setFontSize(10);
                      doc.text(`Vinicius (66,666%): ${fmtMoney(commissionSummary.vinicius)}`, 18, y);
                      y += 6;
                      doc.text(`Douglas (33,333%): ${fmtMoney(commissionSummary.douglas)}`, 18, y);
                      y += 12;

                      doc.setFont("helvetica", "bold");
                      doc.text(`Base total: ${fmtMoney(commissionSummary.baseTotal)}`, 14, y);
                      y += 6;
                      doc.setFont("helvetica", "normal");
                      doc.text(`Vinicius (66,666%): ${fmtMoney(commissionSummary.vinicius)}`, 14, y);
                      y += 5;
                      doc.text(`Douglas (33,333%): ${fmtMoney(commissionSummary.douglas)}`, 14, y);
                      y += 10;

                      // Cabeçalho da tabela
                      doc.setFillColor(241, 245, 249);
                      doc.roundedRect(14, y - 6, pageW - 28, 10, 2, 2, "F");
                      doc.setTextColor(15, 23, 42);
                      doc.setFont("helvetica", "bold");
                      doc.setFontSize(10);
                      doc.text("Tipo", 16, y);
                      doc.text("Valor", 56, y);
                      doc.text("Data", 92, y);
                      doc.text("Origem", 122, y);
                      y += 7;
                      doc.setDrawColor(line.r, line.g, line.b);
                      doc.line(14, y - 2, pageW - 14, y - 2);
                      doc.setFont("helvetica", "normal");
                      doc.setFontSize(9);

                      for (const r of rows) {
                        if (y > 284) {
                          doc.addPage();
                          // Repete cabeçalho simplificado nas páginas seguintes
                          doc.setFillColor(tealDark.r, tealDark.g, tealDark.b);
                          doc.rect(0, 0, pageW, 12, "F");
                          doc.setTextColor(255, 255, 255);
                          doc.setFont("helvetica", "bold");
                          doc.setFontSize(10);
                          doc.text("ACERTO (COMISSÕES)", pageW / 2, 8, { align: "center" });
                          doc.setTextColor(30, 41, 59);
                          y = 22;

                          doc.setFillColor(241, 245, 249);
                          doc.roundedRect(14, y - 6, pageW - 28, 10, 2, 2, "F");
                          doc.setTextColor(15, 23, 42);
                          doc.setFont("helvetica", "bold");
                          doc.setFontSize(10);
                          doc.text("Tipo", 16, y);
                          doc.text("Valor", 56, y);
                          doc.text("Data", 92, y);
                          doc.text("Origem", 122, y);
                          y += 7;
                          doc.setDrawColor(line.r, line.g, line.b);
                          doc.line(14, y - 2, pageW - 14, y - 2);
                          doc.setFont("helvetica", "normal");
                          doc.setFontSize(9);
                        }
                        const isQuitado = r.tipo === "Quitado" || r.situacao === "Quitado";
                        if (isQuitado) doc.setTextColor(192, 0, 0);
                        doc.text(String(r.tipo).slice(0, 10), 16, y);
                        doc.text(fmtMoney(r.valor).slice(0, 20), 56, y);
                        doc.text(formatBR(r.data), 92, y);
                        const origin = String(r.origem || "").slice(0, 60);
                        doc.text(origin, 122, y);
                        if (isQuitado) doc.setTextColor(0, 0, 0);
                        y += 5;
                      }

                      doc.save(`ACERTO - ${formatBR(commDateFrom)} - ${formatBR(commDateTo)}.pdf`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Erro ao gerar PDF");
                    }
                  }}
                >
                  <FileDown className="h-4 w-4" />
                  PDF
                </Button>
              </div>
            </div>

            {(() => {
              const fmt = (n: number) =>
                n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

              if (commissionsError) {
                return <p className="text-sm text-destructive mt-4">Erro ao calcular comissões.</p>;
              }
              if (loadingCommissions || !commissionSummary) {
                return <p className="text-sm text-muted-foreground mt-4">Calculando...</p>;
              }

              return (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
                    <p className="text-xs text-muted-foreground">Base total</p>
                    <p className="text-lg font-semibold text-foreground mt-1">
                      {fmt(commissionSummary.baseTotal)}
                    </p>
                    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between gap-4">
                        <span>Juros (pagamentos)</span>
                        <span className="font-medium text-foreground">
                          {fmt(commissionSummary.interestTotal)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span>Parcelas (parcelamentos)</span>
                        <span className="font-medium text-foreground">
                          {fmt(commissionSummary.installmentsTotal)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
                    <p className="text-xs text-muted-foreground">Repartição</p>
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-foreground font-medium">Vinicius (66,666%)</span>
                        <span className="font-semibold text-foreground">
                          {fmt(commissionSummary.vinicius)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-foreground font-medium">Douglas (33,333%)</span>
                        <span className="font-semibold text-foreground">
                          {fmt(commissionSummary.douglas)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </motion.div>
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
                    <button
                      className="text-muted-foreground hover:text-destructive transition-colors text-sm"
                      onClick={async () => {
                        if (!confirm("Remover esta chave PIX?")) return;
                        try {
                          await deactivatePixKey(String(p.id));
                          toast.success("Chave PIX removida");
                          queryClient.invalidateQueries({ queryKey: ["pix-keys"] });
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Erro ao remover chave PIX");
                        }
                      }}
                    >
                      Remover
                    </button>
                  </div>
                ))
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 gap-2 nexus-input"
              onClick={() => setPixModalOpen(true)}
            >
              <Plus className="h-3 w-3" />
              Adicionar Chave PIX
            </Button>
          </motion.div>

          <Dialog open={pixModalOpen} onOpenChange={setPixModalOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Adicionar chave PIX</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Banco</Label>
                  <Input
                    value={pixForm.bank_name}
                    onChange={(e) => setPixForm((p) => ({ ...p, bank_name: e.target.value }))}
                    placeholder="Ex: Nubank"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Titular</Label>
                  <Input
                    value={pixForm.account_holder}
                    onChange={(e) => setPixForm((p) => ({ ...p, account_holder: e.target.value }))}
                    placeholder="Nome do titular"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Tipo de chave</Label>
                  <Select
                    value={pixForm.pix_key_type}
                    onValueChange={(v) => setPixForm((p) => ({ ...p, pix_key_type: v }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CPF">CPF</SelectItem>
                      <SelectItem value="CNPJ">CNPJ</SelectItem>
                      <SelectItem value="Email">Email</SelectItem>
                      <SelectItem value="Telefone">Telefone</SelectItem>
                      <SelectItem value="Aleatoria">Aleatória</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Chave</Label>
                  <Input
                    value={pixForm.pix_key}
                    onChange={(e) => setPixForm((p) => ({ ...p, pix_key: e.target.value }))}
                    placeholder="Digite a chave PIX"
                  />
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setPixModalOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={async () => {
                    if (!pixForm.bank_name.trim() || !pixForm.account_holder.trim() || !pixForm.pix_key.trim()) {
                      toast.error("Preencha banco, titular e chave");
                      return;
                    }
                    try {
                      await insertPixKey(pixForm);
                      toast.success("Chave PIX adicionada");
                      queryClient.invalidateQueries({ queryKey: ["pix-keys"] });
                      setPixModalOpen(false);
                      setPixForm({ bank_name: "", account_holder: "", pix_key_type: "CNPJ", pix_key: "" });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Erro ao adicionar chave PIX");
                    }
                  }}
                >
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
