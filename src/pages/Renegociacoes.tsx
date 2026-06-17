import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Handshake,
  Loader2,
  RefreshCw,
  Search,
  FileText,
  CircleCheck,
  CircleX,
  List,
  PlusCircle,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchAdvocaciaOverdueLoans, type AdvocaciaOverdueLoan } from "@/api/advocacia";
import {
  buildRenegotiationWhatsAppMessage,
  convertRenegotiationToLoan,
  fetchRenegotiationProposals,
  finalizeRenegotiationProposal,
  saveRenegotiationProposal,
  type RenegotiationProposal,
} from "@/api/renegotiations";
import {
  fetchConnectionStateForInstance,
  sendWhatsAppDocumentWithInstance,
  sendWhatsAppTextWithInstance,
} from "@/api/evolution";
import {
  ADVOCACIA_INSTANCE_IDS,
  getApiKeyForEvolutionInstance,
  getEvolutionConfig,
} from "@/lib/evolution-settings";
import { getCreditorCompanyName } from "@/lib/advocacia-messages";
import {
  calcRenegotiationProposal,
  renegotiationAgreementTotal,
  renegotiationModeLabel,
  type RenegotiationMode,
} from "@/lib/renegotiation-calc";
import {
  generatePropostaRenegociacaoPdf,
  propostaRenegociacaoPdfToBase64,
} from "@/lib/proposta-renegociacao-pdf";

const CONTACT_STORAGE_KEY = "nexus_renegociacoes_contact_phone";
const INSTANCE_STORAGE_KEY = "nexus_renegociacoes_instance";

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(s: string) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

function loadStored(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) || fallback;
}

function proposalStatusLabel(status: RenegotiationProposal["status"]) {
  if (status === "finalized") return "Finalizada";
  if (status === "converted") return "Em empréstimos";
  return "Rascunho";
}

function renegotiationBaseLabel(source: AdvocaciaOverdueLoan["source"]) {
  return source === "installment" ? "Valor total" : "Capital";
}

function DebtDetailsPanel({ item }: { item: AdvocaciaOverdueLoan }) {
  const d = item.details;
  const rows: Array<{ label: string; value: string }> = [
    { label: "Total pago", value: formatCurrency(d.total_paid) },
  ];

  if (item.source === "loan") {
    rows.push(
      { label: "Capital original", value: formatCurrency(d.original_amount ?? 0) },
      { label: "Valor do contrato", value: formatCurrency(d.loan_amount ?? 0) },
      { label: "Aluguel (taxa)", value: `${d.interest_rate ?? 0}%` },
      { label: "Data do empréstimo", value: formatDate(d.loan_date || "") },
      { label: "Vencimento", value: formatDate(item.loan.due_date) },
      { label: "Capital pago", value: formatCurrency(d.capital_paid ?? 0) },
      { label: "Aluguel pago", value: formatCurrency(d.interest_paid ?? 0) },
      { label: "Multas pagas", value: formatCurrency(d.fines_paid ?? 0) },
      { label: "Capital restante", value: formatCurrency(d.capital_remaining ?? 0) },
      { label: "Aluguel restante", value: formatCurrency(d.interest_remaining ?? 0) },
      { label: "Saldo com multas (atual)", value: formatCurrency(item.loan.amount) },
      { label: "Multas em aberto", value: formatCurrency(item.loan.fine) },
    );
  } else {
    rows.push(
      { label: "Valor total do parcelamento", value: formatCurrency(item.loan.capital) },
      { label: "Valor da parcela", value: formatCurrency(d.installment_amount ?? 0) },
      { label: "Parcelas", value: `${d.paid_installments ?? 0} pagas / ${d.total_installments ?? 0} total` },
      { label: "Parcelas pendentes", value: String(d.pending_installments ?? 0) },
      { label: "Valor pendente", value: formatCurrency(d.pending_amount ?? 0) },
      { label: "1º vencimento", value: formatDate(d.first_due_date || "") },
      { label: "Próximo vencimento", value: formatDate(item.loan.due_date) },
      { label: "Dias em atraso", value: String(item.days_overdue) },
      { label: "Multas em aberto", value: formatCurrency(item.loan.fine) },
      { label: "Total com multas", value: formatCurrency(item.loan.amount) },
    );
    if (d.linked_loan_id) {
      rows.push({ label: "Empréstimo vinculado", value: d.linked_loan_id.slice(0, 8) + "…" });
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="rounded-md border bg-muted/20 px-3 py-2">
          <p className="text-[10px] text-muted-foreground">{r.label}</p>
          <p className="font-medium tabular-nums mt-0.5">{r.value}</p>
        </div>
      ))}
    </div>
  );
}

export default function Renegociacoes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [instance, setInstance] = useState(() => loadStored(INSTANCE_STORAGE_KEY, ADVOCACIA_INSTANCE_IDS[0]));
  const [contactPhone, setContactPhone] = useState(() => loadStored(CONTACT_STORAGE_KEY, ""));
  const [proposalItem, setProposalItem] = useState<AdvocaciaOverdueLoan | null>(null);
  const [detailsItem, setDetailsItem] = useState<AdvocaciaOverdueLoan | null>(null);
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const [mode, setMode] = useState<RenegotiationMode>("avista");
  const [discountPercent, setDiscountPercent] = useState("20");
  const [downPayment, setDownPayment] = useState("");
  const [installmentCount, setInstallmentCount] = useState("3");
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [installmentAmountManual, setInstallmentAmountManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef(false);

  const evolutionBase = getEvolutionConfig().baseUrl;
  const apiKey = getApiKeyForEvolutionInstance(instance);

  const { data: rows = [], isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["renegociacoes-overdue-60"],
    queryFn: () => fetchAdvocaciaOverdueLoans({ requirePhone: false, minDaysOverdue: 60 }),
    staleTime: 60_000,
  });

  const { data: proposals = [], refetch: refetchProposals } = useQuery({
    queryKey: ["renegotiation-proposals"],
    queryFn: fetchRenegotiationProposals,
    staleTime: 30_000,
  });

  const { data: connectionState } = useQuery({
    queryKey: ["renegociacoes-connection", instance],
    queryFn: () =>
      fetchConnectionStateForInstance({
        instance,
        apiKey: getApiKeyForEvolutionInstance(instance),
        baseUrl: evolutionBase,
      }),
    enabled: !!instance,
    staleTime: 30_000,
  });

  const isConnected = connectionState?.ok ? connectionState.connected : false;

  const proposalByDebt = useMemo(() => {
    const map = new Map<string, RenegotiationProposal>();
    for (const p of proposals) map.set(p.debt_ref, p);
    return map;
  }, [proposals]);

  const renegotiatedClientIds = useMemo(
    () =>
      new Set(
        proposals
          .filter((p) => p.status === "finalized" || p.status === "converted")
          .map((p) => p.client_id),
      ),
    [proposals],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.loan.client_name.toLowerCase().includes(q) ||
        r.loan.client_phone.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const autoCalc = useMemo(() => {
    if (!proposalItem) return null;
    const baseCapital = proposalItem.loan.capital;
    return calcRenegotiationProposal({
      mode,
      baseCapital,
      discountPercent: parseFloat(discountPercent.replace(",", ".")) || 20,
      downPayment: parseFloat(downPayment.replace(",", ".")) || 0,
      installmentCount: parseInt(installmentCount, 10) || 1,
    });
  }, [proposalItem, mode, discountPercent, downPayment, installmentCount]);

  useEffect(() => {
    if (!autoCalc || installmentAmountManual) return;
    if (autoCalc.installmentCount > 0) {
      setInstallmentAmount(String(autoCalc.installmentAmount));
    } else {
      setInstallmentAmount("");
    }
  }, [autoCalc, installmentAmountManual]);

  const calc = useMemo(() => {
    if (!autoCalc) return null;
    if (autoCalc.installmentCount === 0) return autoCalc;

    const parsed = parseFloat(installmentAmount.replace(",", "."));
    const installmentAmt =
      Number.isFinite(parsed) && parsed > 0
        ? Math.round(parsed * 100) / 100
        : autoCalc.installmentAmount;

    return {
      ...autoCalc,
      installmentAmount: installmentAmt,
      totalAmount: renegotiationAgreementTotal({
        downPayment: autoCalc.downPayment,
        installmentAmount: installmentAmt,
        installmentCount: autoCalc.installmentCount,
      }),
    };
  }, [autoCalc, installmentAmount]);

  const openProposal = (item: AdvocaciaOverdueLoan) => {
    const existing = proposalByDebt.get(item.id);
    setProposalItem(item);
    setMode(existing?.proposal_mode || "avista");
    setDiscountPercent(String(existing?.discount_percent ?? 20));
    setDownPayment(existing?.down_payment ? String(existing.down_payment) : "");
    setInstallmentCount(String(existing?.installment_count || 3));
    if (existing?.installment_count && existing.installment_amount > 0) {
      setInstallmentAmount(String(existing.installment_amount));
      setInstallmentAmountManual(true);
    } else {
      setInstallmentAmount("");
      setInstallmentAmountManual(false);
    }
  };

  const resetProposalDialog = () => {
    setProposalItem(null);
    setMode("avista");
    setDiscountPercent("20");
    setDownPayment("");
    setInstallmentCount("3");
    setInstallmentAmount("");
    setInstallmentAmountManual(false);
  };

  const savePrefs = () => {
    localStorage.setItem(CONTACT_STORAGE_KEY, contactPhone.trim());
    localStorage.setItem(INSTANCE_STORAGE_KEY, instance);
    toast.success("Preferências salvas");
  };

  const finalizeAndSend = async () => {
    if (!proposalItem || !calc) return;
    const phone = proposalItem.loan.client_phone?.trim();
    if (!phone) {
      toast.error("Cliente sem telefone cadastrado");
      return;
    }
    if (!contactPhone.trim()) {
      toast.error("Informe o WhatsApp da Capital Advocacia");
      return;
    }
    if (!apiKey) {
      toast.error(`Configure a API key da instância ${instance}`);
      return;
    }

    setSaving(true);
    abortRef.current = false;
    try {
      const saved = await saveRenegotiationProposal({
        client_id: proposalItem.client_id,
        debt_ref: proposalItem.id,
        source_type: proposalItem.source,
        client_name: proposalItem.loan.client_name,
        client_phone: phone,
        proposal_mode: mode,
        base_capital: calc.baseCapital,
        discount_percent: calc.discountPercent,
        total_amount: calc.totalAmount,
        down_payment: calc.downPayment,
        installment_count: calc.installmentCount,
        installment_amount: calc.installmentAmount,
        status: "draft",
      });

      const creditor = getCreditorCompanyName();
      const debtDescription =
        proposalItem.source === "installment" ? "parcelamento de dívida" : "contrato de empréstimo pessoal";

      const text = buildRenegotiationWhatsAppMessage({
        clientName: proposalItem.loan.client_name,
        creditorName: creditor,
        calc,
        mode,
        contactPhone: contactPhone.trim(),
      });

      const pdf = generatePropostaRenegociacaoPdf({
        clientName: proposalItem.loan.client_name,
        creditorName: creditor,
        debtDescription,
        originalDueDate: proposalItem.loan.due_date,
        calc,
        mode,
        contactPhone: contactPhone.trim(),
      });
      const b64 = propostaRenegociacaoPdfToBase64(pdf);
      const fileName = `proposta-renegociacao-${proposalItem.loan.client_name.replace(/\s+/g, "-").slice(0, 40)}.pdf`;

      const textRes = await sendWhatsAppTextWithInstance(phone, text, {
        instance,
        apiKey,
        baseUrl: evolutionBase,
      });
      if (!textRes.ok) {
        toast.error(textRes.error || "Falha ao enviar mensagem");
        return;
      }

      const docRes = await sendWhatsAppDocumentWithInstance(phone, {
        base64: b64,
        fileName,
        caption: "Proposta de renegociação — Capital Advocacia",
        instance,
        apiKey,
        baseUrl: evolutionBase,
      });
      if (!docRes.ok) {
        toast.error(docRes.error || "Mensagem enviada, mas falha ao enviar PDF");
        return;
      }

      await finalizeRenegotiationProposal(saved.id);
      await queryClient.invalidateQueries({ queryKey: ["renegotiation-proposals"] });
      await queryClient.invalidateQueries({ queryKey: ["renegotiated-client-ids"] });
      toast.success(`Proposta finalizada e enviada para ${proposalItem.loan.client_name}`);
      resetProposalDialog();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao finalizar proposta");
    } finally {
      setSaving(false);
    }
  };

  const handleConvertToLoan = async (proposal: RenegotiationProposal) => {
    try {
      const { loanId } = await convertRenegotiationToLoan(proposal.id);
      await queryClient.invalidateQueries({ queryKey: ["renegotiation-proposals"] });
      await queryClient.invalidateQueries({ queryKey: ["renegotiated-client-ids"] });
      toast.success(`Empréstimo criado (${loanId.slice(0, 8)}…). Veja em Empréstimos.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar empréstimo");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Handshake className="h-5 w-5" />
          Renegociações
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Clientes vencidos há mais de 60 dias — propostas sem multas diárias (Capital Advocacia).
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <Label className="text-xs">Instância WhatsApp</Label>
            <Select
              value={instance}
              onValueChange={(v) => {
                setInstance(v);
                localStorage.setItem(INSTANCE_STORAGE_KEY, v);
              }}
            >
              <SelectTrigger className="mt-1 h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADVOCACIA_INSTANCE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {instance ? (
            isConnected ? (
              <Badge variant="outline" className="h-9 gap-1.5 border-emerald-600/40 text-emerald-700">
                <CircleCheck className="h-3.5 w-3.5" />
                Conectado
              </Badge>
            ) : (
              <Badge variant="outline" className="h-9 gap-1.5 text-muted-foreground">
                <CircleX className="h-3.5 w-3.5" />
                Desconectado
              </Badge>
            )
          ) : null}
          <div className="min-w-[160px] flex-1">
            <Label className="text-xs">WhatsApp Capital Advocacia</Label>
            <Input
              className="mt-1 h-9 text-xs"
              placeholder="Ex: 16999999999"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" className="h-9" onClick={savePrefs}>
            Salvar
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" className="h-9 gap-1" onClick={() => setProposalsOpen(true)}>
            <List className="h-3.5 w-3.5" />
            Ver propostas ({proposals.length})
          </Button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-sm font-semibold">
              Inadimplentes +60 dias{" "}
              <span className="text-muted-foreground font-normal">({filtered.length})</span>
            </p>
            {error ? (
              <p className="text-xs text-destructive mt-1">
                {error instanceof Error ? error.message : "Erro ao carregar"}
              </p>
            ) : null}
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-9 text-xs"
              placeholder="Buscar cliente ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhum empréstimo ou parcelamento vencido há mais de 60 dias.
          </div>
        ) : (
          <ScrollArea className="h-[min(520px,60vh)] rounded-lg border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                <tr className="border-b">
                  <th className="text-left p-3 font-semibold">Cliente</th>
                  <th className="text-left p-3 font-semibold">Tipo</th>
                  <th className="text-left p-3 font-semibold">Vencimento</th>
                  <th className="text-right p-3 font-semibold">Dias</th>
                  <th className="text-right p-3 font-semibold">Valor sem multas</th>
                  <th className="text-right p-3 font-semibold">Total pago</th>
                  <th className="text-right p-3 font-semibold text-muted-foreground">Com multas</th>
                  <th className="p-3 w-44" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const prop = proposalByDebt.get(item.id);
                  const isRenegotiated = renegotiatedClientIds.has(item.client_id);
                  return (
                    <tr key={item.id} className="border-b border-border/40 hover:bg-muted/30">
                      <td className={`p-3 font-medium ${isRenegotiated ? "text-orange-600 dark:text-orange-400" : ""}`}>
                        {item.loan.client_name}
                        {prop ? (
                          <Badge variant="outline" className="ml-2 text-[9px]">
                            {proposalStatusLabel(prop.status)}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {item.source === "installment" ? "Parcelamento" : "Empréstimo"}
                        </Badge>
                      </td>
                      <td className="p-3">{formatDate(item.loan.due_date)}</td>
                      <td className="p-3 text-right tabular-nums">{item.days_overdue}</td>
                      <td className="p-3 text-right tabular-nums font-medium">
                        <span className="block">{formatCurrency(item.loan.capital)}</span>
                        <span className="text-[9px] text-muted-foreground font-normal">
                          {renegotiationBaseLabel(item.source)}
                        </span>
                      </td>
                      <td className="p-3 text-right tabular-nums text-green-700 dark:text-green-400 font-medium">
                        {formatCurrency(item.details.total_paid)}
                      </td>
                      <td className="p-3 text-right tabular-nums text-muted-foreground line-through">
                        {formatCurrency(item.loan.amount)}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1 justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Detalhes"
                            onClick={() => setDetailsItem(item)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] gap-1"
                            onClick={() => openProposal(item)}
                          >
                            <FileText className="h-3 w-3" />
                            Proposta
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </motion.div>

      <Dialog open={!!proposalItem} onOpenChange={(open) => !open && resetProposalDialog()}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Proposta de renegociação</DialogTitle>
          </DialogHeader>
          {proposalItem && calc ? (
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <p className="font-medium">{proposalItem.loan.client_name}</p>
                <DebtDetailsPanel item={proposalItem} />
              </div>

              <p className="text-muted-foreground text-xs">
                {renegotiationBaseLabel(proposalItem.source)} base para proposta:{" "}
                <span className="font-medium text-foreground">{formatCurrency(calc.baseCapital)}</span> (sem multas)
              </p>

              <div className="space-y-2">
                <Label className="text-xs">Modalidade</Label>
                <Select
                  value={mode}
                  onValueChange={(v) => {
                    setMode(v as RenegotiationMode);
                    setInstallmentAmountManual(false);
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="avista">
                      {proposalItem.source === "installment" ? "À vista (valor total)" : "À vista (somente capital)"}
                    </SelectItem>
                    <SelectItem value="avista_desconto">À vista com 20% de desconto</SelectItem>
                    <SelectItem value="parcelado_entrada">Parcelado com entrada</SelectItem>
                    <SelectItem value="parcelado_total">Parcelado total (sem entrada)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mode === "avista_desconto" ? (
                <div className="space-y-1">
                  <Label className="text-xs">Desconto (%)</Label>
                  <Input
                    className="h-9"
                    type="number"
                    min={0}
                    max={100}
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                  />
                </div>
              ) : null}

              {mode === "parcelado_entrada" ? (
                <div className="space-y-1">
                  <Label className="text-xs">Valor da entrada (R$)</Label>
                  <Input
                    className="h-9"
                    value={downPayment}
                    onChange={(e) => {
                      setDownPayment(e.target.value);
                      setInstallmentAmountManual(false);
                    }}
                    placeholder="0,00"
                  />
                </div>
              ) : null}

              {mode === "parcelado_entrada" || mode === "parcelado_total" ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Quantidade de parcelas</Label>
                    <Input
                      className="h-9"
                      type="number"
                      min={1}
                      value={installmentCount}
                      onChange={(e) => {
                        setInstallmentCount(e.target.value);
                        setInstallmentAmountManual(false);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Valor da parcela (R$)</Label>
                    <Input
                      className="h-9"
                      value={installmentAmount}
                      onChange={(e) => {
                        setInstallmentAmount(e.target.value);
                        setInstallmentAmountManual(true);
                      }}
                      placeholder={
                        autoCalc && autoCalc.installmentAmount > 0
                          ? String(autoCalc.installmentAmount)
                          : "0,00"
                      }
                    />
                    {autoCalc && autoCalc.installmentAmount > 0 ? (
                      <p className="text-[10px] text-muted-foreground">
                        {installmentAmountManual
                          ? `Sugestão automática: ${formatCurrency(autoCalc.installmentAmount)}`
                          : `Calculado automaticamente com base no capital e nas parcelas.`}
                        {installmentAmountManual ? (
                          <button
                            type="button"
                            className="ml-2 text-primary underline-offset-2 hover:underline"
                            onClick={() => setInstallmentAmountManual(false)}
                          >
                            Restaurar automático
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}

              <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
                <p className="font-semibold">Resumo da proposta</p>
                <p>Modalidade: {renegotiationModeLabel(mode)}</p>
                {mode === "avista_desconto" ? <p>Desconto: {calc.discountPercent}%</p> : null}
                <p>Total do acordo: {formatCurrency(calc.totalAmount)}</p>
                {calc.downPayment > 0 ? <p>Entrada: {formatCurrency(calc.downPayment)}</p> : null}
                {calc.installmentCount > 0 ? (
                  <p>
                    Parcelas: {calc.installmentCount}x de {formatCurrency(calc.installmentAmount)}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={resetProposalDialog}>
              Cancelar
            </Button>
            <Button disabled={saving || !proposalItem} onClick={() => void finalizeAndSend()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Finalizar e enviar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailsItem} onOpenChange={(open) => !open && setDetailsItem(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do {detailsItem?.source === "installment" ? "parcelamento" : "empréstimo"}</DialogTitle>
          </DialogHeader>
          {detailsItem ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">{detailsItem.loan.client_name}</p>
              <DebtDetailsPanel item={detailsItem} />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsItem(null)}>
              Fechar
            </Button>
            {detailsItem ? (
              <Button onClick={() => { openProposal(detailsItem); setDetailsItem(null); }}>
                Montar proposta
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={proposalsOpen} onOpenChange={setProposalsOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Propostas de renegociação</DialogTitle>
          </DialogHeader>
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Nenhuma proposta registrada.</p>
          ) : (
            <ScrollArea className="h-[min(400px,55vh)]">
              <div className="space-y-2 pr-2">
                {proposals.map((p) => (
                  <div key={p.id} className="rounded-lg border p-3 text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`font-semibold ${p.status !== "draft" ? "text-orange-600 dark:text-orange-400" : ""}`}>
                        {p.client_name}
                      </span>
                      <Badge variant="outline">{proposalStatusLabel(p.status)}</Badge>
                    </div>
                    <p className="text-muted-foreground">
                      {renegotiationModeLabel(p.proposal_mode)} · Total {formatCurrency(p.total_amount)}
                      {p.installment_count > 0
                        ? ` · ${p.installment_count}x ${formatCurrency(p.installment_amount)}`
                        : ""}
                    </p>
                    {p.status === "finalized" ? (
                      <Button
                        size="sm"
                        className="h-7 gap-1"
                        onClick={() => void handleConvertToLoan(p)}
                      >
                        <PlusCircle className="h-3.5 w-3.5" />
                        Adicionar em Empréstimos
                      </Button>
                    ) : null}
                    {p.status === "converted" && p.new_loan_id ? (
                      <Button asChild size="sm" variant="outline" className="h-7">
                        <Link to="/emprestimos">Ver em Empréstimos</Link>
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => void refetchProposals()}>
              Atualizar
            </Button>
            <Button variant="outline" onClick={() => setProposalsOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
