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
  Send,
  AlertTriangle,
  MessageCircle,
  Gavel,
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
import { fetchAdvocaciaOverdueLoans, type AdvocaciaOverdueLoan } from "@/api/advocacia";
import { fetchPixKeys } from "@/api/pix-keys";
import {
  buildRenegotiationWhatsAppMessage,
  convertRenegotiationToLoan,
  fetchRenegotiationProposals,
  finalizeRenegotiationProposal,
  saveRenegotiationProposal,
  formatRenegotiationDraftDeadline,
  isDraftProposalExpired,
  RENEGOTIATION_DRAFT_VALIDITY_DAYS,
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
import { getCreditorCompanyName, buildProtestWarningWhatsAppMessage } from "@/lib/advocacia-messages";
import {
  buildExtrajudicialPackage,
  sendExtrajudicialNotification,
} from "@/lib/advocacia-extrajudicial-send";
import { interruptibleDelay } from "@/contexts/AutomationQueueContext";
import {
  calcRenegotiationProposal,
  renegotiationAgreementTotal,
  renegotiationModeLabel,
  type RenegotiationMode,
} from "@/lib/renegotiation-calc";
import {
  generatePropostaRenegociacaoPdf,
  propostaRenegociacaoPdfToBase64,
  type PropostaRenegociacaoParams,
} from "@/lib/proposta-renegociacao-pdf";
import { addCalendarDays, calendarDateInBrazil } from "@/lib/brazil-date";

const CONTACT_STORAGE_KEY = "nexus_renegociacoes_contact_phone";
const INSTANCE_STORAGE_KEY = "nexus_renegociacoes_instance";
const DELAY_STORAGE_KEY = "nexus_renegociacoes_delay_seconds";
const PROTEST_DEADLINE_STORAGE_KEY = "nexus_renegociacoes_protest_deadline";
const PIX_STORAGE_KEY = "nexus_renegociacoes_pix_id";

function parseDelayMinutes(raw: string): number {
  const n = parseFloat(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

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

function proposalStatusLabel(proposal: RenegotiationProposal) {
  if (proposal.status === "finalized") return "Finalizada";
  if (proposal.status === "converted") return "Em empréstimos";
  if (isDraftProposalExpired(proposal)) return "Rascunho expirado";
  return `Rascunho até ${formatRenegotiationDraftDeadline(proposal.created_at)}`;
}

function renegotiationBaseLabel(source: AdvocaciaOverdueLoan["source"]) {
  return source === "installment" ? "Valor total" : "Capital";
}

function buildProposalPackage(
  item: AdvocaciaOverdueLoan,
  calc: NonNullable<ReturnType<typeof calcRenegotiationProposal>>,
  mode: RenegotiationMode,
  contactPhone: string,
  preview: boolean,
  downPaymentDueDate?: string,
  draftValidUntil?: string,
) {
  const creditor = getCreditorCompanyName();
  const debtDescription =
    item.source === "installment" ? "parcelamento de dívida" : "contrato de empréstimo pessoal";
  const entradaDueLabel =
    mode === "parcelado_entrada" && downPaymentDueDate ? formatDate(downPaymentDueDate) : "";
  const pdfParams: PropostaRenegociacaoParams = {
    clientName: item.loan.client_name,
    creditorName: creditor,
    debtDescription,
    originalDueDate: item.loan.due_date,
    calc,
    mode,
    contactPhone: contactPhone.trim(),
    preview,
    downPaymentDueDate: entradaDueLabel || undefined,
    draftValidUntil: preview ? draftValidUntil : undefined,
  };
  const text = buildRenegotiationWhatsAppMessage({
    clientName: item.loan.client_name,
    creditorName: creditor,
    calc,
    mode,
    contactPhone: contactPhone.trim(),
    preview,
    downPaymentDueDate: entradaDueLabel || undefined,
    draftValidUntil: preview ? draftValidUntil : undefined,
  });
  const pdf = generatePropostaRenegociacaoPdf(pdfParams);
  const slug = item.loan.client_name.replace(/\s+/g, "-").slice(0, 40);
  const fileName = preview
    ? `previa-proposta-renegociacao-${slug}.pdf`
    : `proposta-renegociacao-${slug}.pdf`;
  return {
    creditor,
    debtDescription,
    text,
    pdf,
    b64: propostaRenegociacaoPdfToBase64(pdf),
    fileName,
    caption: preview
      ? "Prévia da proposta de renegociação — Capital Advocacia"
      : "Proposta de renegociação — Capital Advocacia",
  };
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
  const [downPaymentDueDate, setDownPaymentDueDate] = useState("");
  const [installmentCount, setInstallmentCount] = useState("3");
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [installmentAmountManual, setInstallmentAmountManual] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [protestPreviewOpen, setProtestPreviewOpen] = useState(false);
  const [protestDeadlineDate, setProtestDeadlineDate] = useState(() =>
    loadStored(PROTEST_DEADLINE_STORAGE_KEY, ""),
  );
  const [selectedPixId, setSelectedPixId] = useState(() => loadStored(PIX_STORAGE_KEY, ""));
  const [extrajudicialPreviewItem, setExtrajudicialPreviewItem] = useState<AdvocaciaOverdueLoan | null>(null);
  const [extrajudicialBulkPreviewOpen, setExtrajudicialBulkPreviewOpen] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState(() => loadStored(DELAY_STORAGE_KEY, "1"));
  const [saving, setSaving] = useState(false);
  const [sendingProtest, setSendingProtest] = useState(false);
  const [sendingExtrajudicial, setSendingExtrajudicial] = useState(false);
  const [protestSendStatus, setProtestSendStatus] = useState("");
  const [extrajudicialSendStatus, setExtrajudicialSendStatus] = useState("");
  const abortProtestRef = useRef(false);
  const abortExtrajudicialRef = useRef(false);

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

  const { data: pixKeys = [] } = useQuery({
    queryKey: ["pix-keys"],
    queryFn: fetchPixKeys,
  });

  const selectedPix = useMemo(() => {
    const p = (pixKeys as Array<Record<string, unknown>>).find((x) => String(x.id) === selectedPixId);
    if (!p) return null;
    return {
      bank: String(p.bank || "PIX"),
      holder: String(p.holder || ""),
      key: String(p.key || ""),
    };
  }, [pixKeys, selectedPixId]);

  useEffect(() => {
    if (selectedPixId || !(pixKeys as Array<Record<string, unknown>>).length) return;
    const firstId = String((pixKeys as Array<Record<string, unknown>>)[0].id || "");
    if (firstId) setSelectedPixId(firstId);
  }, [pixKeys, selectedPixId]);

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

  const clientsWithoutContact = useMemo(() => {
    return filtered.filter((item) => {
      const prop = proposalByDebt.get(item.id);
      if (prop?.status === "finalized" || prop?.status === "converted") return false;
      return !!item.loan.client_phone?.trim();
    });
  }, [filtered, proposalByDebt]);

  const clientsForExtrajudicial = useMemo(
    () => filtered.filter((item) => !!item.loan.client_phone?.trim()),
    [filtered],
  );

  const sampleExtrajudicialMessage = useMemo(() => {
    const sample = clientsForExtrajudicial[0];
    if (!sample || !selectedPix?.key) return "";
    return buildExtrajudicialPackage(sample, contactPhone, selectedPix).text;
  }, [clientsForExtrajudicial, contactPhone, selectedPix]);

  const protestDeadlineLabel = useMemo(
    () => (protestDeadlineDate ? formatDate(protestDeadlineDate) : ""),
    [protestDeadlineDate],
  );

  const sampleProtestMessage = useMemo(() => {
    const sample = clientsWithoutContact[0] || filtered[0];
    if (!sample || !protestDeadlineLabel) return "";
    return buildProtestWarningWhatsAppMessage({
      clientName: sample.loan.client_name,
      creditorName: getCreditorCompanyName(),
      contactWhatsApp: contactPhone,
      deadline: protestDeadlineLabel,
    });
  }, [clientsWithoutContact, filtered, contactPhone, protestDeadlineLabel]);

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

  const currentDraftProposal = useMemo(() => {
    if (!proposalItem) return null;
    return proposalByDebt.get(proposalItem.id) ?? null;
  }, [proposalItem, proposalByDebt]);

  const draftDeadlineLabel = useMemo(() => {
    if (!proposalItem) return "";
    const base = currentDraftProposal?.created_at || new Date().toISOString();
    return formatRenegotiationDraftDeadline(base);
  }, [proposalItem, currentDraftProposal]);

  const isCurrentDraftExpired = useMemo(
    () => (currentDraftProposal ? isDraftProposalExpired(currentDraftProposal) : false),
    [currentDraftProposal],
  );

  const previewPackage = useMemo(() => {
    if (!proposalItem || !calc) return null;
    return buildProposalPackage(
      proposalItem,
      calc,
      mode,
      contactPhone,
      true,
      downPaymentDueDate,
      draftDeadlineLabel,
    );
  }, [proposalItem, calc, mode, contactPhone, downPaymentDueDate, draftDeadlineLabel]);

  const openProposal = (item: AdvocaciaOverdueLoan) => {
    const existing = proposalByDebt.get(item.id);
    setProposalItem(item);
    setMode(existing?.proposal_mode || "avista");
    setDiscountPercent(String(existing?.discount_percent ?? 20));
    setDownPayment(existing?.down_payment ? String(existing.down_payment) : "");
    const proposalMode = existing?.proposal_mode || "avista";
    setDownPaymentDueDate(
      existing?.down_payment_due_date ||
        (proposalMode === "parcelado_entrada" ? addCalendarDays(calendarDateInBrazil(), 7) : ""),
    );
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
    setPreviewOpen(false);
    setMode("avista");
    setDiscountPercent("20");
    setDownPayment("");
    setDownPaymentDueDate("");
    setInstallmentCount("3");
    setInstallmentAmount("");
    setInstallmentAmountManual(false);
  };

  const savePrefs = () => {
    localStorage.setItem(CONTACT_STORAGE_KEY, contactPhone.trim());
    localStorage.setItem(INSTANCE_STORAGE_KEY, instance);
    localStorage.setItem(DELAY_STORAGE_KEY, delayMinutes.trim() || "1");
    localStorage.setItem(PROTEST_DEADLINE_STORAGE_KEY, protestDeadlineDate);
    localStorage.setItem(PIX_STORAGE_KEY, selectedPixId);
    toast.success("Preferências salvas");
  };

  const openProtestPreview = () => {
    if (!protestDeadlineDate) {
      toast.error("Selecione a data limite para o aviso de protesto");
      return;
    }
    setProtestPreviewOpen(true);
  };

  const validateProposalSend = (): string | null => {
    if (!proposalItem || !calc) return "Monte a proposta antes de enviar";
    if (mode === "parcelado_entrada" && !downPaymentDueDate) {
      return "Informe a data limite para pagamento da entrada";
    }
    if (!proposalItem.loan.client_phone?.trim()) return "Cliente sem telefone cadastrado";
    if (!contactPhone.trim()) return "Informe o WhatsApp da Capital Advocacia";
    if (!apiKey) return `Configure a API key da instância ${instance}`;
    return null;
  };

  const openPdfPreview = () => {
    if (!previewPackage) return;
    const blob = previewPackage.pdf.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  };

  const sendProposal = async (opts: { finalize: boolean; preview: boolean }) => {
    if (!proposalItem || !calc) return;
    const validationError = validateProposalSend();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const phone = proposalItem.loan.client_phone!.trim();
    const existing = proposalByDebt.get(proposalItem.id);

    setSaving(true);
    try {
      const saved = await saveRenegotiationProposal({
        id: existing?.id,
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
        down_payment_due_date: mode === "parcelado_entrada" ? downPaymentDueDate || null : null,
        installment_count: calc.installmentCount,
        installment_amount: calc.installmentAmount,
        status: "draft",
      });

      const pkg = buildProposalPackage(
        proposalItem,
        calc,
        mode,
        contactPhone,
        opts.preview,
        downPaymentDueDate,
        opts.preview ? formatRenegotiationDraftDeadline(saved.created_at) : undefined,
      );

      const textRes = await sendWhatsAppTextWithInstance(phone, pkg.text, {
        instance,
        apiKey,
        baseUrl: evolutionBase,
      });
      if (!textRes.ok) {
        toast.error(textRes.error || "Falha ao enviar mensagem");
        return;
      }

      const docRes = await sendWhatsAppDocumentWithInstance(phone, {
        base64: pkg.b64,
        fileName: pkg.fileName,
        caption: pkg.caption,
        instance,
        apiKey,
        baseUrl: evolutionBase,
      });
      if (!docRes.ok) {
        toast.error(docRes.error || "Mensagem enviada, mas falha ao enviar PDF");
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["renegotiation-proposals"] });

      if (opts.finalize) {
        await finalizeRenegotiationProposal(saved.id);
        await queryClient.invalidateQueries({ queryKey: ["renegotiated-client-ids"] });
        toast.success(`Proposta finalizada e enviada para ${proposalItem.loan.client_name}`);
        resetProposalDialog();
      } else {
        toast.success(
          opts.preview
            ? `Prévia enviada para ${proposalItem.loan.client_name} (rascunho salvo)`
            : `Proposta enviada para ${proposalItem.loan.client_name}`,
        );
        setPreviewOpen(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar proposta");
    } finally {
      setSaving(false);
    }
  };

  const finalizeAndSend = () => sendProposal({ finalize: true, preview: false });

  const extrajudicialPreviewPackage = useMemo(() => {
    if (!extrajudicialPreviewItem || !selectedPix?.key) return null;
    return buildExtrajudicialPackage(extrajudicialPreviewItem, contactPhone, selectedPix);
  }, [extrajudicialPreviewItem, contactPhone, selectedPix]);

  const openExtrajudicialPdfPreview = () => {
    if (!extrajudicialPreviewPackage) return;
    const blob = extrajudicialPreviewPackage.pdf.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  };

  const handleSendExtrajudicial = async (
    item: AdvocaciaOverdueLoan,
    opts?: { silent?: boolean },
  ): Promise<boolean> => {
    if (!selectedPix?.key) {
      if (!opts?.silent) toast.error("Selecione uma chave PIX");
      return false;
    }
    if (!contactPhone.trim()) {
      if (!opts?.silent) toast.error("Informe o WhatsApp da Capital Advocacia");
      return false;
    }
    if (!apiKey) {
      if (!opts?.silent) toast.error(`Configure a API key da instância ${instance}`);
      return false;
    }

    const result = await sendExtrajudicialNotification({
      item,
      contactPhone,
      pix: selectedPix,
      instance,
      apiKey,
      baseUrl: evolutionBase,
    });
    if (!result.ok) {
      if (!opts?.silent) toast.error(result.error);
      return false;
    }
    if (!opts?.silent) {
      toast.success(`Notificação extrajudicial enviada para ${item.loan.client_name}`);
      setExtrajudicialPreviewItem(null);
    }
    return true;
  };

  const openExtrajudicialBulkPreview = () => {
    if (!selectedPix?.key) {
      toast.error("Selecione uma chave PIX");
      return;
    }
    if (!contactPhone.trim()) {
      toast.error("Informe o WhatsApp da Capital Advocacia");
      return;
    }
    if (clientsForExtrajudicial.length === 0) {
      toast.error("Nenhum cliente com telefone na lista");
      return;
    }
    setExtrajudicialBulkPreviewOpen(true);
  };

  const runExtrajudicialQueue = async () => {
    const list = clientsForExtrajudicial;
    if (list.length === 0) {
      toast.error("Nenhum cliente com telefone na lista");
      return;
    }
    if (!selectedPix?.key) {
      toast.error("Selecione uma chave PIX");
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

    const delayMs = parseDelayMinutes(delayMinutes) * 60 * 1000;
    abortExtrajudicialRef.current = false;
    setSendingExtrajudicial(true);
    let ok = 0;
    let fail = 0;

    try {
      for (let i = 0; i < list.length; i++) {
        if (abortExtrajudicialRef.current) break;

        const item = list[i];
        const next = list[i + 1];
        setExtrajudicialSendStatus(
          `Enviando extrajudicial ${i + 1}/${list.length}: ${item.loan.client_name}${
            next ? ` — próximo: ${next.loan.client_name}` : ""
          }`,
        );

        const sent = await handleSendExtrajudicial(item, { silent: true });
        if (sent) ok++;
        else fail++;

        if (abortExtrajudicialRef.current) break;
        if (i < list.length - 1 && delayMs > 0) {
          setExtrajudicialSendStatus(
            `Aguardando intervalo (${parseDelayMinutes(delayMinutes)} min) antes de ${next!.loan.client_name}…`,
          );
          await interruptibleDelay(delayMs, () => abortExtrajudicialRef.current);
        }
      }
      toast.message(`Extrajudicial: ${ok} enviado(s)${fail > 0 ? `, ${fail} falha(s)` : ""}`);
      setExtrajudicialBulkPreviewOpen(false);
    } finally {
      setSendingExtrajudicial(false);
      setExtrajudicialSendStatus("");
    }
  };

  const sendProtestWarningOne = async (item: AdvocaciaOverdueLoan, opts?: { silent?: boolean }) => {
    const phone = item.loan.client_phone?.trim();
    if (!phone) return false;
    if (!protestDeadlineLabel) {
      if (!opts?.silent) toast.error("Selecione a data limite para o aviso de protesto");
      return false;
    }
    if (!apiKey) {
      if (!opts?.silent) toast.error(`Configure a API key da instância ${instance}`);
      return false;
    }
    if (!contactPhone.trim()) {
      if (!opts?.silent) toast.error("Informe o WhatsApp da Capital Advocacia");
      return false;
    }

    const text = buildProtestWarningWhatsAppMessage({
      clientName: item.loan.client_name,
      creditorName: getCreditorCompanyName(),
      contactWhatsApp: contactPhone.trim(),
      deadline: protestDeadlineLabel,
    });

    const textRes = await sendWhatsAppTextWithInstance(phone, text, {
      instance,
      apiKey,
      baseUrl: evolutionBase,
    });
    if (!textRes.ok) {
      if (!opts?.silent) toast.error(textRes.error || "Falha ao enviar aviso");
      return false;
    }
    if (!opts?.silent) toast.success(`Aviso enviado para ${item.loan.client_name}`);
    return true;
  };

  const runProtestWarningQueue = async () => {
    const list = clientsWithoutContact;
    if (!protestDeadlineLabel) {
      toast.error("Selecione a data limite para o aviso de protesto");
      return;
    }
    if (list.length === 0) {
      toast.error("Nenhum cliente sem contato com telefone cadastrado");
      return;
    }
    if (!apiKey) {
      toast.error(`Configure a API key da instância ${instance}`);
      return;
    }
    if (!contactPhone.trim()) {
      toast.error("Informe o WhatsApp da Capital Advocacia");
      return;
    }

    const delayMs = parseDelayMinutes(delayMinutes) * 60 * 1000;
    abortProtestRef.current = false;
    setSendingProtest(true);
    let ok = 0;
    let fail = 0;

    try {
      for (let i = 0; i < list.length; i++) {
        if (abortProtestRef.current) break;

        const item = list[i];
        const next = list[i + 1];
        setProtestSendStatus(
          `Enviando aviso ${i + 1}/${list.length}: ${item.loan.client_name}${
            next ? ` — próximo: ${next.loan.client_name}` : ""
          }`,
        );

        const sent = await sendProtestWarningOne(item, { silent: true });
        if (sent) ok++;
        else fail++;

        if (abortProtestRef.current) break;
        if (i < list.length - 1 && delayMs > 0) {
          setProtestSendStatus(
            `Aguardando intervalo (${parseDelayMinutes(delayMinutes)} min) antes de ${next!.loan.client_name}…`,
          );
          await interruptibleDelay(delayMs, () => abortProtestRef.current);
        }
      }
      toast.message(`Avisos de protesto: ${ok} enviado(s)${fail > 0 ? `, ${fail} falha(s)` : ""}`);
      setProtestPreviewOpen(false);
    } finally {
      setSendingProtest(false);
      setProtestSendStatus("");
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
          <div className="min-w-[200px]">
            <Label className="text-xs">Chave PIX (notificação)</Label>
            <Select
              value={selectedPixId}
              onValueChange={(v) => {
                setSelectedPixId(v);
                localStorage.setItem(PIX_STORAGE_KEY, v);
              }}
            >
              <SelectTrigger className="mt-1 h-9 text-xs">
                <SelectValue placeholder="Selecione PIX" />
              </SelectTrigger>
              <SelectContent>
                {(pixKeys as Array<Record<string, unknown>>).map((p) => (
                  <SelectItem key={String(p.id)} value={String(p.id)}>
                    {String(p.bank)} – {String(p.holder)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[160px] flex-1">
            <Label className="text-xs">WhatsApp Capital Advocacia</Label>
            <Input
              className="mt-1 h-9 text-xs"
              placeholder="Ex: 16999999999"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
          <div className="w-[110px]">
            <Label className="text-xs">Intervalo (min)</Label>
            <Input
              className="mt-1 h-9 text-xs"
              type="number"
              min={0}
              step={1}
              value={delayMinutes}
              onChange={(e) => setDelayMinutes(e.target.value)}
            />
          </div>
          <div className="w-[148px]">
            <Label className="text-xs">Data limite protesto</Label>
            <Input
              className="mt-1 h-9 text-xs"
              type="date"
              value={protestDeadlineDate}
              onChange={(e) => {
                setProtestDeadlineDate(e.target.value);
                localStorage.setItem(PROTEST_DEADLINE_STORAGE_KEY, e.target.value);
              }}
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
          <Button
            size="sm"
            className="h-9 gap-1 bg-orange-600 text-white hover:bg-orange-700"
            disabled={sendingExtrajudicial || clientsForExtrajudicial.length === 0}
            onClick={openExtrajudicialBulkPreview}
          >
            {sendingExtrajudicial ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gavel className="h-3.5 w-3.5" />}
            Extrajudicial ({clientsForExtrajudicial.length})
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-9 gap-1"
            disabled={sendingProtest || clientsWithoutContact.length === 0 || !protestDeadlineDate}
            onClick={openProtestPreview}
          >
            {sendingProtest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            Avisar protesto ({clientsWithoutContact.length})
          </Button>
        </div>
        {protestSendStatus || extrajudicialSendStatus ? (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            {protestSendStatus || extrajudicialSendStatus}
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            <strong className="text-orange-600">Extrajudicial</strong> envia mensagem + PDF com valor com multas para todos com telefone.
            <strong className="text-destructive"> Avisar protesto</strong> exige data limite e atinge só quem não finalizou renegociação.
            O intervalo é em <strong>minutos</strong> entre cada cliente na fila.
          </p>
        )}
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
          <div className="h-[min(520px,60vh)] overflow-y-auto overflow-x-hidden rounded-lg border">
            <table className="w-full text-xs table-fixed">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                <tr className="border-b">
                  <th className="text-left p-3 font-semibold w-[18%]">Cliente</th>
                  <th className="text-left p-3 font-semibold w-[10%]">Tipo</th>
                  <th className="text-left p-3 font-semibold w-[10%]">Vencimento</th>
                  <th className="text-right p-3 font-semibold w-[7%]">Dias</th>
                  <th className="text-right p-3 font-semibold w-[14%]">Valor sem multas</th>
                  <th className="text-right p-3 font-semibold w-[12%]">Total pago</th>
                  <th className="text-right p-3 font-semibold w-[11%] text-muted-foreground">Com multas</th>
                  <th className="p-3 w-[20%]" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const prop = proposalByDebt.get(item.id);
                  const isRenegotiated = renegotiatedClientIds.has(item.client_id);
                  return (
                    <tr key={item.id} className="border-b border-border/40 hover:bg-muted/30">
                      <td className={`p-3 font-medium truncate ${isRenegotiated ? "text-orange-600 dark:text-orange-400" : ""}`}>
                        {item.loan.client_name}
                        {prop ? (
                          <Badge variant="outline" className="ml-2 text-[9px]">
                            {proposalStatusLabel(prop)}
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
                      <td className="p-3 text-right tabular-nums font-medium text-foreground">
                        {formatCurrency(item.loan.amount)}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1 justify-end">
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
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Notificação extrajudicial"
                            disabled={sendingExtrajudicial || !item.loan.client_phone}
                            onClick={() => setExtrajudicialPreviewItem(item)}
                          >
                            <Gavel className="h-3.5 w-3.5" />
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
          </div>
        )}
      </motion.div>

      <Dialog open={!!proposalItem} onOpenChange={(open) => !open && resetProposalDialog()}>
        <DialogContent className="w-[min(96vw,52rem)] sm:max-w-none max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Proposta de renegociação</DialogTitle>
          </DialogHeader>
          {proposalItem && calc ? (
            <div className="space-y-4 text-sm min-w-0 overflow-x-hidden">
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
                    const nextMode = v as RenegotiationMode;
                    setMode(nextMode);
                    setInstallmentAmountManual(false);
                    if (nextMode === "parcelado_entrada" && !downPaymentDueDate) {
                      setDownPaymentDueDate(addCalendarDays(calendarDateInBrazil(), 7));
                    }
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
                <>
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
                  <div className="space-y-1">
                    <Label className="text-xs">Data limite da entrada</Label>
                    <Input
                      className="h-9"
                      type="date"
                      value={downPaymentDueDate}
                      onChange={(e) => setDownPaymentDueDate(e.target.value)}
                    />
                  </div>
                </>
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
                {calc.downPayment > 0 ? (
                  <p>
                    Entrada: {formatCurrency(calc.downPayment)}
                    {mode === "parcelado_entrada" && downPaymentDueDate
                      ? ` (vencimento: ${formatDate(downPaymentDueDate)})`
                      : ""}
                  </p>
                ) : null}
                {calc.installmentCount > 0 ? (
                  <p>
                    Parcelas: {calc.installmentCount}x de {formatCurrency(calc.installmentAmount)}
                  </p>
                ) : null}
                <p className={isCurrentDraftExpired ? "text-destructive font-medium" : "text-muted-foreground"}>
                  {isCurrentDraftExpired
                    ? `Rascunho expirado — enviar prévia renova o prazo de ${RENEGOTIATION_DRAFT_VALIDITY_DAYS} dias`
                    : `Validade do rascunho: até ${draftDeadlineLabel} (${RENEGOTIATION_DRAFT_VALIDITY_DAYS} dias)`}
                </p>
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex flex-wrap gap-2 justify-end sm:space-x-0">
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={resetProposalDialog}>
              Cancelar
            </Button>
            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              disabled={!proposalItem || !calc}
              onClick={() => setPreviewOpen(true)}
            >
              Ver prévia
            </Button>
            <Button
              variant="secondary"
              className="flex-1 sm:flex-none"
              disabled={saving || !proposalItem}
              onClick={() => void sendProposal({ finalize: false, preview: true })}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar prévia
            </Button>
            <Button className="flex-1 sm:flex-none" disabled={saving || !proposalItem} onClick={() => void finalizeAndSend()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Finalizar e enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="w-[min(96vw,44rem)] sm:max-w-none max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Prévia da proposta</DialogTitle>
          </DialogHeader>
          {proposalItem && calc && previewPackage ? (
            <div className="space-y-4 text-sm min-w-0 overflow-x-hidden">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
                <p className="font-semibold">Resumo</p>
                <p>Cliente: {proposalItem.loan.client_name}</p>
                <p>Modalidade: {renegotiationModeLabel(mode)}</p>
                <p>Total do acordo: {formatCurrency(calc.totalAmount)}</p>
                {calc.downPayment > 0 ? (
                  <p>
                    Entrada: {formatCurrency(calc.downPayment)}
                    {mode === "parcelado_entrada" && downPaymentDueDate
                      ? ` (vencimento: ${formatDate(downPaymentDueDate)})`
                      : ""}
                  </p>
                ) : null}
                {calc.installmentCount > 0 ? (
                  <p>
                    Parcelas: {calc.installmentCount}x de {formatCurrency(calc.installmentAmount)}
                  </p>
                ) : null}
                <p className={isCurrentDraftExpired ? "text-destructive font-medium" : "text-muted-foreground"}>
                  {isCurrentDraftExpired
                    ? `Rascunho expirado — enviar prévia renova o prazo de ${RENEGOTIATION_DRAFT_VALIDITY_DAYS} dias`
                    : `Validade da prévia: até ${draftDeadlineLabel}`}
                </p>
              </div>
                <div className="max-h-56 overflow-y-auto overflow-x-hidden rounded-md border bg-muted/20 p-3">
                  <pre className="text-[11px] whitespace-pre-wrap break-words font-sans">{previewPackage.text}</pre>
                </div>
              </div>

              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={openPdfPreview}>
                <FileText className="h-3.5 w-3.5" />
                Abrir PDF da prévia
              </Button>
            </div>
          ) : null}
          <DialogFooter className="flex flex-wrap gap-2 justify-end sm:space-x-0">
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setPreviewOpen(false)}>
              Fechar
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              disabled={saving}
              onClick={() => void sendProposal({ finalize: false, preview: true })}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar prévia ao cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={protestPreviewOpen} onOpenChange={setProtestPreviewOpen}>
        <DialogContent className="w-[min(96vw,44rem)] sm:max-w-none max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Aviso de protesto{protestDeadlineLabel ? ` — ${protestDeadlineLabel}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm min-w-0 overflow-x-hidden">
            <div className="space-y-1">
              <Label className="text-xs">Data limite para contato</Label>
              <Input
                className="h-9 text-xs"
                type="date"
                value={protestDeadlineDate}
                onChange={(e) => {
                  setProtestDeadlineDate(e.target.value);
                  localStorage.setItem(PROTEST_DEADLINE_STORAGE_KEY, e.target.value);
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Será enviado para <strong className="text-foreground">{clientsWithoutContact.length}</strong> cliente(s)
              que ainda não finalizaram renegociação e possuem telefone cadastrado.
            </p>
            {sampleProtestMessage ? (
              <div className="space-y-2">
                <Label className="text-xs">Texto da mensagem</Label>
                <div className="max-h-64 overflow-y-auto overflow-x-hidden rounded-md border bg-muted/20 p-3">
                  <pre className="text-[11px] whitespace-pre-wrap break-words font-sans">{sampleProtestMessage}</pre>
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter className="flex flex-wrap gap-2 justify-end sm:space-x-0">
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setProtestPreviewOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="flex-1 sm:flex-none"
              disabled={sendingProtest || clientsWithoutContact.length === 0 || !protestDeadlineDate}
              onClick={() => void runProtestWarningQueue()}
            >
              {sendingProtest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar aviso ({clientsWithoutContact.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!extrajudicialPreviewItem} onOpenChange={(open) => !open && setExtrajudicialPreviewItem(null)}>
        <DialogContent className="w-[min(96vw,44rem)] sm:max-w-none max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Notificação extrajudicial</DialogTitle>
          </DialogHeader>
          {extrajudicialPreviewItem ? (
            <div className="space-y-4 text-sm min-w-0 overflow-x-hidden">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
                <p className="font-semibold">{extrajudicialPreviewItem.loan.client_name}</p>
                <p>Credor: {getCreditorCompanyName()}</p>
                <p>Valor com multas: {formatCurrency(extrajudicialPreviewItem.loan.amount)}</p>
                <p>Vencimento: {formatDate(extrajudicialPreviewItem.loan.due_date)}</p>
                {!extrajudicialPreviewItem.loan.client_phone ? (
                  <p className="text-destructive">Cliente sem telefone cadastrado</p>
                ) : null}
                {!selectedPix?.key ? (
                  <p className="text-destructive">Selecione uma chave PIX no topo da página</p>
                ) : null}
              </div>

              {extrajudicialPreviewPackage ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs">Mensagem WhatsApp</Label>
                    <div className="max-h-56 overflow-y-auto overflow-x-hidden rounded-md border bg-muted/20 p-3">
                      <pre className="text-[11px] whitespace-pre-wrap break-words font-sans">
                        {extrajudicialPreviewPackage.text}
                      </pre>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={openExtrajudicialPdfPreview}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Abrir PDF extrajudicial
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="flex flex-wrap gap-2 justify-end sm:space-x-0">
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setExtrajudicialPreviewItem(null)}>
              Cancelar
            </Button>
            <Button
              className="flex-1 sm:flex-none gap-1"
              disabled={
                sendingExtrajudicial ||
                !extrajudicialPreviewItem?.loan.client_phone ||
                !selectedPix?.key
              }
              onClick={() => {
                if (!extrajudicialPreviewItem) return;
                setSendingExtrajudicial(true);
                void handleSendExtrajudicial(extrajudicialPreviewItem).finally(() => setSendingExtrajudicial(false));
              }}
            >
              {sendingExtrajudicial ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageCircle className="h-4 w-4" />
              )}
              Enviar extrajudicial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={extrajudicialBulkPreviewOpen} onOpenChange={setExtrajudicialBulkPreviewOpen}>
        <DialogContent className="w-[min(96vw,44rem)] sm:max-w-none max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Enviar notificação extrajudicial</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm min-w-0 overflow-x-hidden">
            <p className="text-xs text-muted-foreground">
              Será enviado para <strong className="text-foreground">{clientsForExtrajudicial.length}</strong> cliente(s)
              com telefone. Valor utilizado: <strong className="text-foreground">total com multas</strong>.
            </p>
            {sampleExtrajudicialMessage ? (
              <div className="space-y-2">
                <Label className="text-xs">Exemplo de mensagem</Label>
                <div className="max-h-64 overflow-y-auto overflow-x-hidden rounded-md border bg-muted/20 p-3">
                  <pre className="text-[11px] whitespace-pre-wrap break-words font-sans">{sampleExtrajudicialMessage}</pre>
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter className="flex flex-wrap gap-2 justify-end sm:space-x-0">
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setExtrajudicialBulkPreviewOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="flex-1 sm:flex-none gap-1 bg-orange-600 text-white hover:bg-orange-700"
              disabled={sendingExtrajudicial || clientsForExtrajudicial.length === 0}
              onClick={() => void runExtrajudicialQueue()}
            >
              {sendingExtrajudicial ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar ({clientsForExtrajudicial.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailsItem} onOpenChange={(open) => !open && setDetailsItem(null)}>
        <DialogContent className="w-[min(96vw,48rem)] sm:max-w-none max-h-[90vh] overflow-y-auto overflow-x-hidden">
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
        <DialogContent className="w-[min(96vw,48rem)] sm:max-w-none max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Propostas de renegociação</DialogTitle>
          </DialogHeader>
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Nenhuma proposta registrada.</p>
          ) : (
            <div className="h-[min(400px,55vh)] overflow-y-auto overflow-x-hidden pr-1">
              <div className="space-y-2">
                {proposals.map((p) => (
                  <div key={p.id} className="rounded-lg border p-3 text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`font-semibold ${p.status !== "draft" ? "text-orange-600 dark:text-orange-400" : ""}`}>
                        {p.client_name}
                      </span>
                      <Badge variant="outline">{proposalStatusLabel(p)}</Badge>
                    </div>
                    <p className="text-muted-foreground">
                      {renegotiationModeLabel(p.proposal_mode)} · Total {formatCurrency(p.total_amount)}
                      {p.installment_count > 0
                        ? ` · ${p.installment_count}x ${formatCurrency(p.installment_amount)}`
                        : ""}
                    </p>
                    {p.status === "draft" ? (
                      <p className={isDraftProposalExpired(p) ? "text-destructive" : "text-muted-foreground"}>
                        {isDraftProposalExpired(p)
                          ? "Prazo de 5 dias expirado — envie nova prévia para renovar"
                          : `Válida até ${formatRenegotiationDraftDeadline(p.created_at)}`}
                      </p>
                    ) : null}
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
            </div>
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
