import {
  Plus,
  MessageCircle,
  Send,
  KeyRound,
  FolderOpen,
  RefreshCw,
  Clock,
  Calendar,
  StopCircle,
  ListChecks,
  Bell,
  Play,
  Pause,
  CircleCheck,
  CircleX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { deactivatePixKey, fetchPixKeys, insertPixKey } from "@/api/pix-keys";
import { fetchExpenseCategories } from "@/api/categories";
import {
  getEvolutionConfig,
  saveEvolutionConfig,
  EVOLUTION_INSTANCE_IDS,
  getApiKeyForEvolutionInstance,
} from "@/lib/evolution-settings";
import { getSupabaseCompany } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useAutomationQueue } from "@/contexts/AutomationQueueContext";
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { toast } from "sonner";
import {
  fetchLoansForAutomation,
  fetchLoansForPaymentReminder,
  paymentReminderTargetDate,
  type AutomationLoan,
} from "@/api/automation";
import { fetchInstallments, type InstallmentRow } from "@/api/installments";
import { fetchClientsForSelect } from "@/api/clients";
import {
  fetchEvolutionQrCodeForInstance,
  getQrImageUrl,
  fetchConnectionStateForInstance,
} from "@/api/evolution";
import {
  buildAutomationCobrancaMessage,
  buildAutomationLembreteMessage,
  buildCobrancaParcelamentoMessage,
  buildLembreteMessage,
  buildLembretePagamentoMessage,
  resolvePixInfoForMessages,
  type PixInfo,
} from "@/lib/whatsapp-messages";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PDF_BRAND } from "@/lib/pdf-branding";

// Agendamentos removidos.

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
      return "Lembrete";
    case "lembrete_pagamento":
      return "Lembrete de pagamento";
    default:
      return t;
  }
}

// Agendamentos/envios automáticos removidos do app.
// Stubs permissivos para não quebrar o build enquanto removemos a UI antiga por completo.
type DiaSemana = any;
type FiltroAgendamento = any;
type Agendamento = any;
const EMPRESAS: any[] = [];
const DIAS_LABELS: any[] = [];
const FILTROS_OPCOES: any[] = [];
async function fetchWhatsAppSchedules(..._args: any[]): Promise<any[]> {
  return [];
}
async function insertWhatsAppSchedule(..._args: any[]): Promise<void> {
  throw new Error("Agendamentos removidos");
}
async function updateWhatsAppSchedule(..._args: any[]): Promise<void> {
  throw new Error("Agendamentos removidos");
}
async function deleteWhatsAppSchedule(..._args: any[]): Promise<void> {
  throw new Error("Agendamentos removidos");
}
async function migrateLocalSchedulesToSupabase(..._args: any[]): Promise<number> {
  return 0;
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
            <p className="text-[10px] text-muted-foreground mt-1">
              Defina a instância na seção Evolution API acima e salve.
            </p>
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
  const queue = useAutomationQueue();
  const cobrancaConfig = getEvolutionConfig("cobranca");
  const [evolution, setEvolution] = useState({
    baseUrl: cobrancaConfig.baseUrl,
    apiKey: cobrancaConfig.apiKey,
    instance: cobrancaConfig.instance,
  });
  const [selectedPixId, setSelectedPixId] = useState<string>("");
  const [delayModalOpen, setDelayModalOpen] = useState(false);
  const [delayModalTab, setDelayModalTab] = useState<"emprestimos" | "parcelamentos">("emprestimos");
  const [manualQueueSelectionParcel, setManualQueueSelectionParcel] = useState<string[]>([]);
  /** IDs dos empréstimos (fila manual) marcados para envio */
  const [manualQueueSelection, setManualQueueSelection] = useState<string[]>([]);
  const [delayMinutes, setDelayMinutes] = useState("2");
  const [automationLoans, setAutomationLoans] = useState<AutomationLoan[] | null>(null);
  const [loadingAutomationLoans, setLoadingAutomationLoans] = useState(false);
  const [recipientFilters, setRecipientFilters] = useState({
    vencidos: true,
    venceHoje: true,
  });
  const [recipientSearch, setRecipientSearch] = useState("");
  const [sendTypes, setSendTypes] = useState({
    cobranca: true,
    lembrete_hoje: true,
    lembrete_amanha: true,
    lembrete_pagamento: false,
  });
  const [lembreteModalOpen, setLembreteModalOpen] = useState(false);
  const [lembreteDaysAhead, setLembreteDaysAhead] = useState("3");
  const [lembreteDelayMinutes, setLembreteDelayMinutes] = useState("2");
  const [lembreteLoans, setLembreteLoans] = useState<AutomationLoan[] | null>(null);
  const [loadingLembreteLoans, setLoadingLembreteLoans] = useState(false);
  const [lembreteSelection, setLembreteSelection] = useState<string[]>([]);
  const [lembreteSearch, setLembreteSearch] = useState("");
  const migratedSchedulesRef = useRef(false);
  const [activeTab, setActiveTab] = useState("whatsapp");
  const [modalAgendamento, setModalAgendamento] = useState(false);
  const [pixModalOpen, setPixModalOpen] = useState(false);
  const [pixForm, setPixForm] = useState({
    bank_name: "",
    account_holder: "",
    pix_key_type: "cnpj",
    pix_key: "",
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

  // Estado de conexão por instância (para mostrar ✓/✕ dentro do seletor).
  const instanceConnectionQueries = useQueries({
    queries: EVOLUTION_INSTANCE_IDS.map((id) => ({
      queryKey: ["evolution-connection-option", companyId, id],
      queryFn: async () => {
        const r = await fetchConnectionStateForInstance({
          instance: id,
          apiKey: getApiKeyForEvolutionInstance(id),
          baseUrl: evolution.baseUrl,
        });
        if (!r.ok) return { connected: false };
        return { connected: r.connected };
      },
      enabled: activeTab === "whatsapp",
      staleTime: 30_000,
      retry: false,
    })),
  });

  const connectionByInstance = useMemo(() => {
    const map: Record<string, boolean> = {};
    EVOLUTION_INSTANCE_IDS.forEach((id, idx) => {
      map[id] = instanceConnectionQueries[idx]?.data?.connected ?? false;
    });
    return map;
  }, [instanceConnectionQueries]);

  const { data: connectionState, refetch: refetchConnection } = useQuery({
    queryKey: ["evolution-connection", "cobranca", activeTab, evolution.instance],
    queryFn: async () => {
      const r = await fetchConnectionStateForInstance({
        instance: evolution.instance,
        apiKey: getApiKeyForEvolutionInstance(evolution.instance),
        baseUrl: evolution.baseUrl,
      });
      if (!r.ok) return { connected: false };
      return { connected: r.connected };
    },
    enabled: activeTab === "whatsapp" && !!evolution.instance?.trim(),
    staleTime: 30_000,
  });

  const isConnected = connectionState?.connected ?? false;

  const { data: qrResult, isLoading: loadingQr, refetch: refetchQr } = useQuery({
    queryKey: ["evolution-qr", "cobranca", activeTab, evolution.instance, isConnected],
    queryFn: () =>
      fetchEvolutionQrCodeForInstance({
        instance: evolution.instance,
        apiKey: getApiKeyForEvolutionInstance(evolution.instance),
        baseUrl: evolution.baseUrl,
      }),
    enabled: activeTab === "whatsapp" && !!evolution.instance?.trim() && !isConnected,
    staleTime: 0,
    retry: false,
    // Mantém o QR sempre atualizado enquanto estiver desconectado.
    // O Evolution normalmente expira/rotaciona o QR; esse polling evita QR "velho".
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
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
    saveEvolutionConfig(evolution, "cobranca");
    toast.success("Configuração salva");
    refetchQr();
    refetchConnection();
  };

  const getPixInfoForAutomation = useCallback((): PixInfo | null => {
    const pix = pixKeys.find((p: Record<string, unknown>) => p.id === selectedPixId) as
      | { bank: string; holder: string; key: string }
      | undefined;
    if (!pix) return null;
    return resolvePixInfoForMessages({
      tipo: pix.bank || "CNPJ",
      titular: pix.holder || "",
      chave: pix.key || "",
    });
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
      const loans = await fetchLoansForAutomation({ includeInstallments: true });
      setAutomationLoans(loans);
      const loanIds = loans.filter((l) => l.source !== "installment").map((l) => l.id);
      const parcIds = loans.filter((l) => l.source === "installment").map((l) => l.id);
      setManualQueueSelection(loanIds);
      setManualQueueSelectionParcel(parcIds);
      setDelayModalTab("emprestimos");
      setRecipientSearch("");
      setRecipientFilters({ vencidos: true, venceHoje: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar clientes para automação");
    } finally {
      setLoadingAutomationLoans(false);
    }
  };

  const filteredEmprestimosFila = useMemo(() => {
    const list = automationLoans || [];
    const q = recipientSearch.trim().toLowerCase();
    return list.filter((item) => {
      if (item.source === "installment") return false;
      if (!recipientFilters.vencidos && item.type === "cobranca") return false;
      if (!recipientFilters.venceHoje && item.type === "lembrete_hoje") return false;
      if (q) {
        const name = String(item.loan?.client_name || "").toLowerCase();
        const phone = String(item.loan?.client_phone || "").toLowerCase();
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      return true;
    });
  }, [automationLoans, recipientFilters, recipientSearch]);

  const filteredParcelamentosFila = useMemo(() => {
    const list = automationLoans || [];
    const q = recipientSearch.trim().toLowerCase();
    return list.filter((item) => {
      if (item.source !== "installment") return false;
      if (!recipientFilters.vencidos && item.type === "cobranca") return false;
      if (!recipientFilters.venceHoje && item.type === "lembrete_hoje") return false;
      if (q) {
        const name = String(item.loan?.client_name || "").toLowerCase();
        const phone = String(item.loan?.client_phone || "").toLowerCase();
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      return true;
    });
  }, [automationLoans, recipientFilters, recipientSearch]);

  const lembreteDaysNum = Math.max(0, parseInt(String(lembreteDaysAhead).replace(/\D/g, ""), 10) || 0);
  const lembreteTargetYmd = useMemo(
    () => paymentReminderTargetDate(lembreteDaysNum),
    [lembreteDaysNum],
  );

  const filteredLembreteFila = useMemo(() => {
    const list = lembreteLoans || [];
    const q = lembreteSearch.trim().toLowerCase();
    return list.filter((item) => {
      if (q) {
        const name = String(item.loan?.client_name || "").toLowerCase();
        const phone = String(item.loan?.client_phone || "").toLowerCase();
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      return true;
    });
  }, [lembreteLoans, lembreteSearch]);

  const handleOpenLembreteModal = async () => {
    if (!getPixInfoForAutomation()) {
      toast.error("Selecione uma chave PIX para as mensagens");
      return;
    }
    setLembreteModalOpen(true);
    setLoadingLembreteLoans(true);
    setLembreteLoans(null);
    try {
      const loans = await fetchLoansForPaymentReminder(lembreteDaysNum, { includeInstallments: true });
      setLembreteLoans(loans);
      setLembreteSelection(loans.map((l) => l.id));
      setLembreteSearch("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao buscar clientes para lembrete");
    } finally {
      setLoadingLembreteLoans(false);
    }
  };

  const handleReloadLembreteList = async () => {
    setLoadingLembreteLoans(true);
    try {
      const loans = await fetchLoansForPaymentReminder(lembreteDaysNum, { includeInstallments: true });
      setLembreteLoans(loans);
      setLembreteSelection((prev) => prev.filter((id) => loans.some((l) => l.id === id)));
      if (loans.length === 0) {
        toast.message("Nenhum cliente com vencimento nesta data.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao buscar");
    } finally {
      setLoadingLembreteLoans(false);
    }
  };

  const handleConfirmLembreteSend = async () => {
    const pixInfo = getPixInfoForAutomation();
    if (!pixInfo) {
      toast.error("Selecione uma chave PIX para as mensagens");
      return;
    }
    if (loadingLembreteLoans || !lembreteLoans) {
      toast.message("Aguarde terminar de carregar a lista.");
      return;
    }
    const min = Math.max(0, parseFloat(String(lembreteDelayMinutes).replace(",", ".")) || 0);
    const delayMs = Math.round(min * 60_000);
    const days = lembreteDaysNum;

    setLembreteModalOpen(false);

    const toSend = lembreteLoans.filter(
      (l) => lembreteSelection.includes(l.id) && l.loan.client_phone?.trim(),
    );

    if (toSend.length === 0) {
      toast.error("Selecione ao menos um cliente com telefone.");
      return;
    }

    const withoutPhone = lembreteLoans.filter((l) => !l.loan.client_phone?.trim());
    if (withoutPhone.length > 0) {
      toast.warning(`${withoutPhone.length} cliente(s) sem telefone serão ignorados`);
    }

    await queue.start({
      items: toSend,
      delayMs,
      pixInfo,
      sendTypes: {
        cobranca: false,
        lembrete_hoje: false,
        lembrete_amanha: false,
        lembrete_pagamento: true,
      },
      buildMessage: (item, pix) =>
        buildLembretePagamentoMessage(item.loan, pix, item.days_until_due ?? days),
    });

    toast.success(`Lembretes enviados: ${queue.stats.sent}${queue.stats.failed > 0 ? ` | Falhas: ${queue.stats.failed}` : ""}`);
  };

  const buildAutomationMessage = (item: AutomationLoan, pixInfo: PixInfo): string => {
    if (item.type === "cobranca" || item.type === "lembrete_hoje") {
      return buildAutomationCobrancaMessage(item.loan, pixInfo, 50, undefined, item.source);
    }
    return buildAutomationLembreteMessage(item.loan, pixInfo, item.days_until_due ?? 1);
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

    try {
      const loans = automationLoans;

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
        return;
      }

      const isParcelTab = delayModalTab === "parcelamentos";
      const selection = isParcelTab ? manualQueueSelectionParcel : manualQueueSelection;
      const toSend = loans.filter(
        (l) =>
          selection.includes(l.id) &&
          l.loan.client_phone?.trim() &&
          activeTypes.has(l.type) &&
          (isParcelTab ? l.source === "installment" : l.source !== "installment"),
      );

      if (toSend.length === 0) {
        if (manualQueueSelection.length === 0) {
          toast.error("Selecione ao menos um destinatário na lista.");
        } else {
          toast.info("Nenhum destinatário selecionado com telefone e tipo de envio compatível.");
        }
        return;
      }

      await queue.start({
        items: toSend,
        delayMs,
        pixInfo,
        sendTypes,
        buildMessage: buildAutomationMessage,
      });

      const sent = queue.stats.sent;
      const failed = queue.stats.failed;
      toast.success(`Fila finalizada. Enviados: ${sent}${failed > 0 ? ` | Falhas: ${failed}` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao executar automação");
    }
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
        <TabsList className="grid w-full max-w-xl grid-cols-3">
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
          {/* Prévia: mesmas bases usadas no envio manual */}
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

          {/* QR só com aba WhatsApp ativa: o painel fica montado ao mudar de aba; a query do QR desliga e qrResult fica indefinido. */}
          {activeTab === "whatsapp" && !isConnected && (
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
                    <p className="text-sm text-destructive mb-2">
                      {qrResult != null &&
                      typeof qrResult === "object" &&
                      "error" in qrResult &&
                      String((qrResult as { error?: unknown }).error || "").trim()
                        ? String((qrResult as { error: unknown }).error)
                        : "Erro ao carregar QR"}
                    </p>
                    <Button variant="outline" size="sm" onClick={() => refetchQr()} className="gap-2">
                      <RefreshCw className="h-3 w-3" />
                      Tentar novamente
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Lembretes de pagamento */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.09 }}
            className="glass-card p-5"
          >
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Enviar lembretes de pagamento
            </h3>
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-[140px]">
                <Label className="text-xs">Dias depois</Label>
                <Input
                  type="number"
                  min={0}
                  max={90}
                  value={lembreteDaysAhead}
                  onChange={(e) => setLembreteDaysAhead(e.target.value)}
                  className="mt-1 h-8"
                  placeholder="Ex: 3"
                />
              </div>
              <div className="min-w-[200px]">
                <Label className="text-xs text-muted-foreground">Vencimento alvo</Label>
                <p className="text-sm font-medium mt-1">{formatPreviewDate(lembreteTargetYmd)}</p>
              </div>
              <Button
                onClick={handleOpenLembreteModal}
                disabled={queue.isRunning || !selectedPixId}
                variant="outline"
                className="gap-2"
              >
                <Bell className="h-4 w-4" />
                Buscar e enviar lembretes
              </Button>
            </div>
          </motion.div>

          {/* Automação manual */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card p-5"
          >
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Send className="h-4 w-4" />
              Envio manual de cobranças
            </h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[140px] max-w-[180px]">
                <Label className="text-xs">Instância WhatsApp</Label>
                <Select
                  value={evolution.instance}
                  onValueChange={(v) =>
                    setEvolution((c) => ({
                      ...c,
                      instance: v,
                      apiKey: getApiKeyForEvolutionInstance(v),
                    }))
                  }
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue placeholder="Instância" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVOLUTION_INSTANCE_IDS.map((id) => (
                      <SelectItem key={id} value={id}>
                        <span className="flex items-center justify-between gap-2 w-full">
                          <span className="truncate">{id}</span>
                          {connectionByInstance[id] ? (
                            <CircleCheck className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <CircleX className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {evolution.instance?.trim() ? (
                isConnected ? (
                  <Badge
                    variant="outline"
                    className="h-8 gap-1 px-2 text-[11px] border-emerald-600/40 text-emerald-700 dark:text-emerald-400 shrink-0"
                  >
                    <CircleCheck className="h-3 w-3" />
                    Conectado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="h-8 gap-1 px-2 text-[11px] text-muted-foreground shrink-0">
                    <CircleX className="h-3 w-3" />
                    Desconectado
                  </Badge>
                )
              ) : null}
              <Button onClick={handleSaveEvolution} variant="outline" size="sm" className="h-8 text-xs shrink-0">
                Salvar
              </Button>
              <div className="min-w-[200px] flex-1">
                <Label className="text-xs">Chave PIX</Label>
                <Select value={selectedPixId} onValueChange={setSelectedPixId}>
                  <SelectTrigger className="mt-1 h-8 text-xs">
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
                disabled={queue.isRunning || !selectedPixId}
                size="sm"
                className="gap-2 h-8 shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                {queue.isRunning ? "Enviando..." : "Enviar cobranças"}
              </Button>
            </div>
          </motion.div>

          {/* Modal: intervalo + seleção de destinatários */}
          <Dialog
            open={delayModalOpen}
            onOpenChange={(open) => {
              setDelayModalOpen(open);
              if (!open) setDelayModalTab("emprestimos");
            }}
          >
            <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Enviar cobranças — fila</DialogTitle>
              </DialogHeader>
              {loadingAutomationLoans ? (
                <p className="text-sm text-muted-foreground py-4">Carregando lista...</p>
              ) : !automationLoans?.length ? (
                <p className="text-sm text-muted-foreground py-4">
                  Nenhum empréstimo ou parcelamento elegível (vencidos, hoje ou amanhã) no momento.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Escolha a subaba <span className="font-medium text-foreground">Empréstimos</span> ou{" "}
                    <span className="font-medium text-foreground">Parcelamentos</span>, marque os destinatários e
                    inicie a fila. Delay e tipos de envio valem para a aba ativa.
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
                          <span>Lembrete</span>
                        </label>
                      </div>
                    </div>

                    <Tabs value={delayModalTab} onValueChange={(v) => setDelayModalTab(v as "emprestimos" | "parcelamentos")}>
                      <TabsList className="grid w-full grid-cols-2 h-9">
                        <TabsTrigger value="emprestimos" className="text-xs">
                          Empréstimos
                        </TabsTrigger>
                        <TabsTrigger value="parcelamentos" className="text-xs">
                          Parcelamentos
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="emprestimos" className="space-y-3 mt-3 outline-none">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Label className="text-xs">Destinatários</Label>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() =>
                                setManualQueueSelection(filteredEmprestimosFila.map((l) => l.id))
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
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="min-w-[220px] flex-1">
                            <Label className="text-[11px] text-muted-foreground">Buscar (nome/telefone)</Label>
                            <Input
                              value={recipientSearch}
                              onChange={(e) => setRecipientSearch(e.target.value)}
                              placeholder="Ex.: Maria, 16..."
                              className="mt-1 h-9"
                            />
                          </div>
                          <div className="flex flex-wrap gap-3">
                            <label className="flex items-center gap-2 text-xs">
                              <Checkbox
                                checked={recipientFilters.vencidos}
                                onCheckedChange={(checked) =>
                                  setRecipientFilters((p) => ({ ...p, vencidos: Boolean(checked) }))
                                }
                              />
                              <span>Vencidos</span>
                            </label>
                            <label className="flex items-center gap-2 text-xs">
                              <Checkbox
                                checked={recipientFilters.venceHoje}
                                onCheckedChange={(checked) =>
                                  setRecipientFilters((p) => ({ ...p, venceHoje: Boolean(checked) }))
                                }
                              />
                              <span>Vencem hoje</span>
                            </label>
                          </div>
                        </div>
                        <ScrollArea className="h-[220px] rounded-md border border-border/60 p-2">
                          <div className="space-y-2 pr-3">
                            {filteredEmprestimosFila.length === 0 ? (
                              <p className="text-xs text-muted-foreground p-2">Nenhum empréstimo com os filtros atuais.</p>
                            ) : (
                              filteredEmprestimosFila.map((item) => (
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
                                    <span className="text-muted-foreground">
                                      {" "}
                                      · Empréstimo · {labelTipoAutomacao(item.type)}
                                    </span>
                                    <span className="block text-muted-foreground mt-0.5">
                                      Venc. {formatPreviewDate(item.loan.due_date)} ·{" "}
                                      {formatPreviewCurrency(item.loan.amount)}
                                      {!item.loan.client_phone?.trim() ? (
                                        <span className="text-amber-600 dark:text-amber-500"> · sem telefone</span>
                                      ) : null}
                                    </span>
                                  </span>
                                </label>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                      </TabsContent>

                      <TabsContent value="parcelamentos" className="space-y-3 mt-3 outline-none">
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          Lista só contratos com parcela pendente nos mesmos critérios de data. A mensagem de WhatsApp
                          usa parcela e multa (sem linha de juros).
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Label className="text-xs">Destinatários</Label>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() =>
                                setManualQueueSelectionParcel(filteredParcelamentosFila.map((l) => l.id))
                              }
                            >
                              Marcar todos
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setManualQueueSelectionParcel([])}
                            >
                              Desmarcar todos
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="min-w-[220px] flex-1">
                            <Label className="text-[11px] text-muted-foreground">Buscar (nome/telefone)</Label>
                            <Input
                              value={recipientSearch}
                              onChange={(e) => setRecipientSearch(e.target.value)}
                              placeholder="Ex.: Maria, 16..."
                              className="mt-1 h-9"
                            />
                          </div>
                          <div className="flex flex-wrap gap-3">
                            <label className="flex items-center gap-2 text-xs">
                              <Checkbox
                                checked={recipientFilters.vencidos}
                                onCheckedChange={(checked) =>
                                  setRecipientFilters((p) => ({ ...p, vencidos: Boolean(checked) }))
                                }
                              />
                              <span>Vencidos</span>
                            </label>
                            <label className="flex items-center gap-2 text-xs">
                              <Checkbox
                                checked={recipientFilters.venceHoje}
                                onCheckedChange={(checked) =>
                                  setRecipientFilters((p) => ({ ...p, venceHoje: Boolean(checked) }))
                                }
                              />
                              <span>Vencem hoje</span>
                            </label>
                          </div>
                        </div>
                        <ScrollArea className="h-[220px] rounded-md border border-border/60 p-2">
                          <div className="space-y-2 pr-3">
                            {filteredParcelamentosFila.length === 0 ? (
                              <p className="text-xs text-muted-foreground p-2">
                                Nenhum parcelamento com os filtros atuais.
                              </p>
                            ) : (
                              filteredParcelamentosFila.map((item) => (
                                <label
                                  key={item.id}
                                  className="flex items-start gap-2 text-xs cursor-pointer rounded-md p-1.5 hover:bg-muted/40"
                                >
                                  <Checkbox
                                    className="mt-0.5"
                                    checked={manualQueueSelectionParcel.includes(item.id)}
                                    onCheckedChange={(checked) => {
                                      setManualQueueSelectionParcel((prev) => {
                                        if (checked) {
                                          return prev.includes(item.id) ? prev : [...prev, item.id];
                                        }
                                        return prev.filter((x) => x !== item.id);
                                      });
                                    }}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="font-medium text-foreground">{item.loan.client_name}</span>
                                    <span className="text-muted-foreground">
                                      {" "}
                                      · Parcelamento · {labelTipoAutomacao(item.type)}
                                    </span>
                                    <span className="block text-muted-foreground mt-0.5">
                                      Parcela {formatPreviewCurrency(item.loan.capital)} · venc.{" "}
                                      {formatPreviewDate(item.loan.due_date)}
                                      {!item.loan.client_phone?.trim() ? (
                                        <span className="text-amber-600 dark:text-amber-500"> · sem telefone</span>
                                      ) : null}
                                    </span>
                                  </span>
                                </label>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                      </TabsContent>
                    </Tabs>
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
                    (delayModalTab === "emprestimos"
                      ? manualQueueSelection.length === 0
                      : manualQueueSelectionParcel.length === 0)
                  }
                >
                  <Send className="h-4 w-4" />
                  Iniciar fila
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={lembreteModalOpen} onOpenChange={setLembreteModalOpen}>
            <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Enviar lembretes de pagamento</DialogTitle>
                <DialogDescription>
                  Clientes com vencimento em {formatPreviewDate(lembreteTargetYmd)} (
                  {lembreteDaysNum === 0
                    ? "hoje"
                    : lembreteDaysNum === 1
                      ? "amanhã"
                      : `daqui a ${lembreteDaysNum} dias`}
                  )
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-wrap items-end gap-3">
                <div className="w-[120px]">
                  <Label className="text-xs">Dias depois</Label>
                  <Input
                    type="number"
                    min={0}
                    max={90}
                    value={lembreteDaysAhead}
                    onChange={(e) => setLembreteDaysAhead(e.target.value)}
                    className="h-8 mt-1"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleReloadLembreteList}
                  disabled={loadingLembreteLoans}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Atualizar lista
                </Button>
              </div>

              {loadingLembreteLoans ? (
                <p className="text-sm text-muted-foreground py-4">Buscando clientes...</p>
              ) : !lembreteLoans?.length ? (
                <p className="text-sm text-muted-foreground py-4">
                  Nenhum empréstimo ou parcelamento com vencimento em {formatPreviewDate(lembreteTargetYmd)}.
                  Ajuste os dias depois e clique em Atualizar lista.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="lembrete-delay" className="text-xs">
                      Intervalo entre envios (minutos)
                    </Label>
                    <Input
                      id="lembrete-delay"
                      type="number"
                      min={0}
                      step={0.5}
                      value={lembreteDelayMinutes}
                      onChange={(e) => setLembreteDelayMinutes(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-xs">
                      Destinatários ({filteredLembreteFila.length})
                    </Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setLembreteSelection(filteredLembreteFila.map((l) => l.id))}
                      >
                        Marcar todos
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setLembreteSelection([])}
                      >
                        Desmarcar
                      </Button>
                    </div>
                  </div>
                  <Input
                    placeholder="Buscar por nome ou telefone..."
                    value={lembreteSearch}
                    onChange={(e) => setLembreteSearch(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <ScrollArea className="h-[min(280px,40vh)] rounded border">
                    <div className="p-2 space-y-1">
                      {filteredLembreteFila.map((item) => (
                        <label
                          key={item.id}
                          className="flex items-start gap-2 rounded-md p-2 hover:bg-muted/50 cursor-pointer text-xs"
                        >
                          <Checkbox
                            checked={lembreteSelection.includes(item.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setLembreteSelection((prev) =>
                                  prev.includes(item.id) ? prev : [...prev, item.id],
                                );
                              } else {
                                setLembreteSelection((prev) => prev.filter((x) => x !== item.id));
                              }
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-foreground">{item.loan.client_name}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              · {item.source === "installment" ? "Parcelamento" : "Empréstimo"}
                            </span>
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
                </>
              )}

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setLembreteModalOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleConfirmLembreteSend}
                  className="gap-2"
                  disabled={loadingLembreteLoans || !lembreteLoans?.length || lembreteSelection.length === 0}
                >
                  <Bell className="h-4 w-4" />
                  Enviar lembretes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Fila de envio agora é global (card flutuante no canto inferior direito) */}
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
                      <SelectItem value="cpf">CPF</SelectItem>
                      <SelectItem value="cnpj">CNPJ</SelectItem>
                      <SelectItem value="email">E-mail</SelectItem>
                      <SelectItem value="phone">Telefone</SelectItem>
                      <SelectItem value="random">Aleatória</SelectItem>
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
                      setPixForm({ bank_name: "", account_holder: "", pix_key_type: "cnpj", pix_key: "" });
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
