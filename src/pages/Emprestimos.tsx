import {
  Plus,
  Search,
  Pencil,
  Wallet,
  MessageCircle,
  CheckCircle,
  FileText,
  FileDown,
  Users,
  AlertTriangle,
  Trash2,
  ExternalLink,
  Eye,
  Tag as TagIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import {
  fetchLoans,
  createLoan,
  updateLoan,
  markLoanAsPaid,
  fetchLoanById,
} from "@/api/loans";
import { fetchInstallments, type InstallmentRow } from "@/api/installments";
import { createPayment, createRenewalPayment, fetchPaymentsByLoanId, deletePayment } from "@/api/payments";
import { calculateLoanRemaining, calculateNextDueDate, type LoanRemainingResult } from "@/api/loan-calc";
import { fetchPixKeys } from "@/api/pix-keys";
import { sendWhatsAppMessage } from "@/api/evolution";
import { buildCobrancaMessage, buildComprovanteMessage } from "@/lib/whatsapp-messages";
import { createFine } from "@/api/fines";
import { fetchClientsForSelect, fetchClientHistory, fetchClientScore } from "@/api/clients";
import { fetchClientTags, createClientTag, deleteClientTag, type ClientTagRow } from "@/api/client-tags";
import { fetchGuarantors, fetchEmergencyContacts } from "@/api/contacts";
import { supabase } from "@/lib/supabase";
import { useState } from "react";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import { addPdfHeader, addPdfFooter, getPdfMargin, PDF_BRAND } from "@/lib/pdf-utils";
import { Pagination } from "@/components/Pagination";
import { PAGE_SIZE } from "@/lib/constants";
import { useAuth } from "@/contexts/AuthContext";

function isTerm20Days(loanDate: string, dueDate: string): boolean {
  if (!loanDate || !dueDate) return false;
  const d1 = new Date(String(loanDate).split("T")[0]);
  const d2 = new Date(String(dueDate).split("T")[0]);
  const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  return diff >= 18 && diff <= 22;
}

function getLoanStatusFromDueDate(dueDate: string, dbStatus: string | null): string {
  if (dbStatus === "paid") return "paid";
  if (dbStatus === "cancelled") return "cancelled";

  if (!dueDate) return "active";
  const due = new Date(String(dueDate).split("T")[0]);
  const today = new Date();
  const dueNorm = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (dueNorm.getTime() < todayNorm.getTime()) return "overdue";
  if (dueNorm.getTime() === todayNorm.getTime()) return "due_today";
  return "active";
}

const statusMap: Record<string, { label: string; className: string }> = {
  active: { label: "Ativo", className: "bg-primary/10 text-primary" },
  due_today: { label: "Vence Hoje", className: "bg-warning/10 text-warning" },
  overdue: { label: "Vencido", className: "bg-destructive/10 text-destructive" },
  partial_paid: { label: "Pago parcial", className: "bg-warning/10 text-warning" },
  paid: { label: "Quitado", className: "bg-success/10 text-success" },
  cancelled: { label: "Cancelado", className: "bg-muted text-muted-foreground" },
};

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(d: string) {
  if (!d) return "-";
  const s = String(d).split("T")[0];
  const [y, m, day] = s.split("-");
  return `${day}/${m}/${y}`;
}
function toInputDate(d: string) {
  if (!d) return "";
  return String(d).split("T")[0];
}


type LoanRow = Record<string, unknown>;

const iconVariants = {
  edit: "text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300",
  payment: "text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300",
  whatsapp: "text-[#25D366] hover:text-[#20BD5A] dark:text-[#25D366] dark:hover:text-[#2EE56D]",
  complete: "text-green-600 hover:text-green-500 dark:text-green-400 dark:hover:text-green-300",
  document: "text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300",
  pdf: "text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300",
  contacts: "text-violet-600 hover:text-violet-500 dark:text-violet-400 dark:hover:text-violet-300",
  warning: "text-amber-600 hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300",
  delete: "text-destructive hover:text-destructive/80",
  view: "text-muted-foreground hover:text-foreground",
} as const;

function LoanActionButton({
  icon: Icon,
  label,
  onClick,
  variant = "edit",
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  variant?: keyof typeof iconVariants;
  disabled?: boolean;
}) {
  const colorClass = iconVariants[variant] || iconVariants.edit;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={`p-1.5 rounded-md transition-colors ${colorClass} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export default function Emprestimos() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [registerPaymentOpen, setRegisterPaymentOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [quitarOpen, setQuitarOpen] = useState(false);
  const [multaOpen, setMultaOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [viewDetailsOpen, setViewDetailsOpen] = useState(false);
  const [comprovanteOpen, setComprovanteOpen] = useState(false);
  const [comprovanteData, setComprovanteData] = useState<{
    clientName: string;
    clientPhone: string;
    valorPago: number;
    proximoVencimento: string;
  } | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<LoanRow | null>(null);
  const [editForm, setEditForm] = useState({ amount: "", interest_rate: "", loan_date: "", due_date: "", status: "active" });
  const [quitarDate, setQuitarDate] = useState(toInputDate(new Date().toISOString()));
  const [multaForm, setMultaForm] = useState({ amount: "", reason: "", notes: "" });
  const [paymentForm, setPaymentForm] = useState({
    payment_date: toInputDate(new Date().toISOString()),
    amount: "",
    payment_type: "pix",
    notes: "",
    fine_amount: "",
    include_fine: false,
    change_due_date: false,
    new_due_date: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [newLoanOpen, setNewLoanOpen] = useState(false);
  const [newLoanClientSearch, setNewLoanClientSearch] = useState("");
  const [newLoanForm, setNewLoanForm] = useState({
    client_id: "",
    amount: "",
    interest_rate: "",
    term_days: "30" as "20" | "30",
    loan_date: toInputDate(new Date().toISOString()),
    due_date: "",
  });
  const [confirmDueDateOpen, setConfirmDueDateOpen] = useState(false);
  const [renewalOptionsOpen, setRenewalOptionsOpen] = useState(false);
  const [renewalDays, setRenewalDays] = useState<30 | 20>(30);
  const [overrideDueDate, setOverrideDueDate] = useState("");
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [newTagText, setNewTagText] = useState("");
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagDialogClientId, setTagDialogClientId] = useState<string | null>(null);
  const [tagDialogClientName, setTagDialogClientName] = useState<string>("");
  const [tagDialogColor, setTagDialogColor] = useState<string>("blue");

  const isParcelamentos = statusFilter === "parcelamentos";

  const { data, isLoading, error } = useQuery({
    queryKey: ["loans", statusFilter, page, search],
    queryFn: () => fetchLoans(statusFilter, page, search),
    enabled: !isParcelamentos,
  });
  const loans = data?.data ?? [];
  const totalLoans = data?.total ?? 0;

  const { data: installments = [], isLoading: installmentsLoading, error: installmentsError } = useQuery({
    queryKey: ["installments"],
    queryFn: fetchInstallments,
    enabled: isParcelamentos,
  });

  const { data: pixKeys = [] } = useQuery({
    queryKey: ["pix-keys"],
    queryFn: fetchPixKeys,
    enabled: whatsappOpen,
  });

  const { data: loanFull } = useQuery({
    queryKey: ["loan-full", selectedLoan?.id],
    queryFn: () => fetchLoanById(String(selectedLoan?.id)),
    enabled: !!selectedLoan?.id && (editOpen || quitarOpen || viewDetailsOpen),
  });

  const { data: clientsForSelect = [] } = useQuery({
    queryKey: ["clients-for-select"],
    queryFn: fetchClientsForSelect,
    enabled: newLoanOpen,
  });

  const { data: clientHistory, isLoading: clientHistoryLoading } = useQuery({
    queryKey: ["client-history", newLoanForm.client_id],
    queryFn: () => fetchClientHistory(newLoanForm.client_id),
    enabled: newLoanOpen && !!newLoanForm.client_id,
  });
  const { data: loanRemaining } = useQuery<LoanRemainingResult>({
    queryKey: ["loan-remaining", selectedLoan?.id],
    queryFn: () => calculateLoanRemaining(String(selectedLoan?.id)),
    enabled: !!selectedLoan?.id && (registerPaymentOpen || viewDetailsOpen || whatsappOpen),
  });
  const { data: loanPayments = [] } = useQuery({
    queryKey: ["loan-payments", selectedLoan?.id],
    queryFn: () => fetchPaymentsByLoanId(String(selectedLoan?.id)),
    enabled: !!selectedLoan?.id && viewDetailsOpen,
  });
  const { data: clientTags = [], isLoading: clientTagsLoading } = useQuery({
    queryKey: ["client-tags", selectedLoan?.client_id],
    queryFn: () => fetchClientTags(String(selectedLoan?.client_id)),
    enabled: !!selectedLoan?.client_id && viewDetailsOpen,
  });

  const [guarantors, setGuarantors] = useState<Array<{ id: string; name: string; phone: string }>>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<Array<{ id: string; name: string; phone: string }>>([]);

  // Quando `search` está preenchido, a busca é feita no backend (por CPF ou nome do cliente).
  const filtered = loans;

  const searchLower = search.trim().toLowerCase();
  const filteredInstallments = (installments as InstallmentRow[]).filter((inst) => {
    if (!searchLower) return true;
    const hay = [
      inst.client_name,
      String(inst.total_amount),
      String(inst.installment_amount),
      String(inst.total_installments),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(searchLower);
  });

  const visibleRows: Array<{ client_id?: string | number }> = isParcelamentos
    ? (filteredInstallments as Array<{ client_id?: string | number }>)
    : (filtered as Array<{ client_id?: string | number }>);

  const clientIdsOnPage = Array.from(
    new Set(visibleRows.map((l) => String(l.client_id || "")).filter(Boolean))
  );

  const clientScoreQueries = useQueries({
    queries: clientIdsOnPage.map((clientId) => ({
      queryKey: ["client-score", clientId],
      queryFn: () => fetchClientScore(clientId),
      staleTime: 60_000,
    })),
  });

  const clientScoreById = clientIdsOnPage.reduce((acc, clientId, idx) => {
    acc[clientId] = clientScoreQueries[idx]?.data;
    return acc;
  }, {} as Record<string, Awaited<ReturnType<typeof fetchClientScore>> | undefined>);

  const getScoreColor = (score?: number) => {
    if (typeof score !== "number") return "text-muted-foreground";
    if (score >= 80) return "text-emerald-600";
    if (score >= 60) return "text-primary";
    if (score >= 40) return "text-amber-600";
    return "text-red-600";
  };

  const getScoreBg = (score?: number) => {
    if (typeof score !== "number") return "bg-muted text-muted-foreground";
    if (score >= 80) return "bg-emerald-500/10 text-emerald-600";
    if (score >= 60) return "bg-primary/10 text-primary";
    if (score >= 40) return "bg-amber-500/10 text-amber-600";
    return "bg-red-500/10 text-red-600";
  };

  const ScoreGauge = ({ score }: { score?: number }) => {
    const s = typeof score === "number" ? Math.max(0, Math.min(100, score)) : null;
    const angle = s === null ? -90 : -90 + (s / 100) * 180;

    return (
      <svg viewBox="0 0 100 60" className="w-10 h-7">
        <defs>
          <linearGradient id="scoreGaugeGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="55%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>

        {/* trilho */}
        <path
          d="M 10 50 A 40 40 0 0 1 90 50"
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="8"
          strokeLinecap="round"
        />

        {/* arco colorido */}
        <path
          d="M 10 50 A 40 40 0 0 1 90 50"
          fill="none"
          stroke="url(#scoreGaugeGradient)"
          strokeWidth="8"
          strokeLinecap="round"
          opacity={s === null ? 0.35 : 1}
        />

        {/* ponteiro */}
        <g transform={`rotate(${angle} 50 50)`} opacity={s === null ? 0.35 : 1}>
          <line x1="50" y1="50" x2="50" y2="18" stroke="hsl(var(--foreground))" strokeWidth="2.5" />
          <circle cx="50" cy="50" r="3.5" fill="hsl(var(--foreground))" />
        </g>

        {/* número */}
        <text
          x="50"
          y="40"
          textAnchor="middle"
          fontSize="16"
          fontWeight="800"
          fill="hsl(var(--foreground))"
        >
          {s === null ? "—" : String(s)}
        </text>
      </svg>
    );
  };

  const computeDueDate = (loanDate: string, termDays: 20 | 30) => {
    const d = new Date(loanDate + "T12:00:00");
    d.setDate(d.getDate() + termDays);
    return toInputDate(d.toISOString());
  };

  const openNewLoan = () => {
    const today = toInputDate(new Date().toISOString());
    setNewLoanClientSearch("");
    setNewLoanForm({
      client_id: "",
      amount: "",
      interest_rate: "",
      term_days: "30",
      loan_date: today,
      due_date: computeDueDate(today, 30),
    });
    setNewLoanOpen(true);
  };

  const handleNewLoanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLoanForm.client_id || !newLoanForm.amount || !newLoanForm.interest_rate || !newLoanForm.loan_date || !newLoanForm.due_date) {
      toast.error("Preencha todos os campos");
      return;
    }
    const amt = parseFloat(String(newLoanForm.amount).replace(",", "."));
    if (isNaN(amt) || amt <= 0) {
      toast.error("Valor inválido");
      return;
    }
    const rate = parseFloat(String(newLoanForm.interest_rate).replace(",", "."));
    if (isNaN(rate) || rate < 0) {
      toast.error("Juros inválidos");
      return;
    }
    if (newLoanForm.due_date < newLoanForm.loan_date) {
      toast.error("Data de vencimento deve ser posterior à data do empréstimo");
      return;
    }
    const score = clientHistory?.score?.score;
    if (typeof score === "number" && score < 50) {
      if (!confirm(`Cliente com score baixo (${score}/100 - Risco). Deseja continuar com o empréstimo mesmo assim?`)) {
        return;
      }
    }
    setIsSubmitting(true);
    try {
      await createLoan({
        client_id: newLoanForm.client_id,
        amount: amt,
        interest_rate: rate,
        loan_date: newLoanForm.loan_date,
        due_date: newLoanForm.due_date,
      });
      toast.success("Empréstimo cadastrado");
      setNewLoanOpen(false);
      invalidateLoanRelated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cadastrar empréstimo");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEdit = (loan: LoanRow) => {
    setSelectedLoan(loan);
    setEditForm({
      amount: String(loan.amount ?? ""),
      interest_rate: String(loan.interest_rate ?? ""),
      loan_date: toInputDate(String(loan.loan_date)),
      due_date: toInputDate(String(loan.due_date)),
      status: (loan.status as string) || "active",
    });
    setEditOpen(true);
  };

  const openPayments = (loan: LoanRow) => {
    setSelectedLoan(loan);
    const dueStr = toInputDate(String(loan.due_date));
    setPaymentForm({
      payment_date: toInputDate(new Date().toISOString()),
      amount: "",
      payment_type: "pix",
      notes: "",
      fine_amount: "",
      include_fine: false,
      change_due_date: false,
      new_due_date: dueStr,
    });
    setOverrideDueDate("");
    setRegisterPaymentOpen(true);
  };

  const openWhatsapp = (loan: LoanRow) => {
    setSelectedLoan(loan);
    setWhatsappOpen(true);
  };

  const openQuitar = (loan: LoanRow) => {
    setSelectedLoan(loan);
    setQuitarDate(toInputDate(new Date().toISOString()));
    setQuitarOpen(true);
  };

  const openMulta = (loan: LoanRow) => {
    setSelectedLoan(loan);
    setMultaForm({ amount: "", reason: "", notes: "" });
    setMultaOpen(true);
  };

  const openContacts = async (loan: LoanRow) => {
    setSelectedLoan(loan);
    const cid = String(loan.client_id);
    try {
      const [g, e] = await Promise.all([fetchGuarantors(cid), fetchEmergencyContacts(cid)]);
      setGuarantors((g as Array<{ id: string; name: string; phone: string }>) || []);
      setEmergencyContacts((e as Array<{ id: string; name: string; phone: string }>) || []);
      setContactsOpen(true);
    } catch {
      toast.error("Erro ao carregar contatos");
    }
  };

  const openViewDetails = (loan: LoanRow) => {
    setSelectedLoan(loan);
    setViewDetailsOpen(true);
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!selectedLoan?.id) return;
    if (!confirm("Excluir este pagamento? Esta ação não pode ser desfeita.")) return;
    setIsSubmitting(true);
    try {
      await deletePayment(paymentId);
      toast.success("Pagamento excluído");
      invalidateLoanRelated(String(selectedLoan.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir pagamento");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditSubmit = async () => {
    if (!selectedLoan?.id) return;
    setIsSubmitting(true);
    try {
      await updateLoan(String(selectedLoan.id), {
        amount: parseFloat(editForm.amount),
        interest_rate: parseFloat(editForm.interest_rate),
        loan_date: editForm.loan_date || undefined,
        due_date: editForm.due_date || undefined,
        status: editForm.status,
      });
      toast.success("Empréstimo atualizado");
      setEditOpen(false);
      invalidateLoanRelated(String(selectedLoan.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
    } finally {
      setIsSubmitting(false);
    }
  };

  const invalidateLoanRelated = (loanId?: string) => {
    queryClient.invalidateQueries({ queryKey: ["loans"] });
    queryClient.invalidateQueries({ queryKey: ["payments"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
    if (loanId) {
      queryClient.invalidateQueries({ queryKey: ["loan-remaining", loanId] });
      queryClient.invalidateQueries({ queryKey: ["loan-full", loanId] });
      queryClient.invalidateQueries({ queryKey: ["loan-payments", loanId] });
    }
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "client-history" });
  };

  const handleQuitarSubmit = async () => {
    if (!selectedLoan?.id || !quitarDate) {
      toast.error("Informe a data da quitação");
      return;
    }
    setIsSubmitting(true);
    try {
      await markLoanAsPaid(String(selectedLoan.id), quitarDate);
      toast.success("Empréstimo quitado");
      setQuitarOpen(false);
      invalidateLoanRelated(String(selectedLoan.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao quitar");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openConfirmDueDate = () => {
    setRenewalDays(30);
    setConfirmDueDateOpen(true);
  };

  const openRenewal20 = () => {
    setRenewalDays(20);
    setRenewalOptionsOpen(true);
  };

  const confirmDueDateAndOpenRenewal = () => {
    setConfirmDueDateOpen(false);
    setRenewalOptionsOpen(true);
  };

  const handleRenewalPayment = async (option: "capital_interest_renewal" | "interest_renewal" | "capital_renewal") => {
    if (!selectedLoan?.id) return;
    const amt = parseFloat(String(paymentForm.amount).replace(",", "."));
    if (isNaN(amt) || amt <= 0) {
      toast.error("Informe o valor do pagamento");
      return;
    }
    const labels: Record<string, string> = {
      capital_interest_renewal: "Capital + Juros",
      interest_renewal: "Somente Juros",
      capital_renewal: "Somente Capital",
    };
    const newDue = overrideDueDate
      || calculateNextDueDate(String(selectedLoan.due_date), renewalDays);
    const confirmMsg = `Confirmar renovação por +${renewalDays} dias?\n\nTipo: ${labels[option]}\nValor: R$ ${amt.toFixed(2)}\nNova data: ${formatDate(newDue)}`;
    if (!confirm(confirmMsg)) return;

    setIsSubmitting(true);
    try {
      const fineAmt = paymentForm.fine_amount ? parseFloat(String(paymentForm.fine_amount).replace(",", ".")) : 0;
      await createRenewalPayment({
        loan_id: String(selectedLoan.id),
        amount: amt,
        payment_date: paymentForm.payment_date,
        payment_type: option,
        notes: `${labels[option]} - Renovação +${renewalDays} dias. ${paymentForm.notes || ""}`.trim(),
        fine_amount: fineAmt > 0 ? fineAmt : undefined,
        new_due_date: newDue,
      });
      const fineAmtVal = fineAmt > 0 ? fineAmt : 0;
      const valorTotal = amt + fineAmtVal;
      toast.success(`Renovação registrada. Nova data: ${formatDate(newDue)}`);
      setRegisterPaymentOpen(false);
      setRenewalOptionsOpen(false);
      setPaymentForm({
        payment_date: toInputDate(new Date().toISOString()),
        amount: "",
        payment_type: "pix",
        notes: "",
        fine_amount: "",
        include_fine: false,
        change_due_date: false,
        new_due_date: "",
      });
      invalidateLoanRelated(String(selectedLoan.id));
      setComprovanteData({
        clientName: String(selectedLoan.client_name),
        clientPhone: String(selectedLoan.client_phone || "").trim(),
        valorPago: valorTotal,
        proximoVencimento: newDue,
      });
      setComprovanteOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar renovação");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMultaSubmit = async () => {
    if (!selectedLoan?.client_id) return;
    const amt = parseFloat(multaForm.amount);
    if (!multaForm.reason.trim() || isNaN(amt) || amt <= 0) {
      toast.error("Preencha valor e motivo");
      return;
    }
    setIsSubmitting(true);
    try {
      await createFine({
        client_id: String(selectedLoan.client_id),
        amount: amt,
        reason: multaForm.reason.trim(),
        notes: multaForm.notes.trim() || undefined,
      });
      toast.success("Multa aplicada");
      setMultaOpen(false);
      queryClient.invalidateQueries({ queryKey: ["fines"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aplicar multa");
    } finally {
      setIsSubmitting(false);
    }
  };

  const addTagMutation = useMutation({
    mutationFn: async ({ clientId, text, color }: { clientId: string; text: string; color?: string }) =>
      createClientTag({
        client_id: clientId,
        text,
        created_by: user?.id,
        created_by_name: user?.full_name,
        color,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["client-tags", variables.clientId] });
      setNewTagText("");
    },
    onError: () => {
      toast.error("Erro ao salvar etiqueta");
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => deleteClientTag(id),
    onSuccess: () => {
      if (selectedLoan?.client_id) {
        queryClient.invalidateQueries({ queryKey: ["client-tags", selectedLoan.client_id] });
      }
    },
    onError: () => {
      toast.error("Erro ao excluir etiqueta");
    },
  });

  const handleWhatsAppWithPix = async (pix: { bank: string; key: string; holder: string }) => {
    if (!selectedLoan) return;
    const phone = String(selectedLoan.client_phone || "").trim();
    if (!phone) {
      toast.error("Cliente sem telefone cadastrado");
      return;
    }
    const amt = Number(selectedLoan.amount ?? 0);
    const rate = Number(selectedLoan.interest_rate ?? 0);
    const capital = loanRemaining?.capital ?? amt;
    const interest = loanRemaining?.interestAmount ?? amt * (rate / 100);
    const loanForMsg = {
      client_name: String(selectedLoan.client_name),
      client_phone: phone,
      amount: loanRemaining?.remainingAmount ?? amt + amt * (rate / 100),
      capital,
      interest,
      fine: 0,
      due_date: String(selectedLoan.due_date),
      minimumPayment: loanRemaining?.minimumPayment ?? interest,
    };
    const pixInfo = { tipo: pix.bank, titular: pix.holder, chave: pix.key };
    const msg = buildCobrancaMessage(loanForMsg, pixInfo, 50);
    const res = await sendWhatsAppMessage(phone, msg);
    if (res.via === "api") toast.success("Mensagem enviada");
    setWhatsappOpen(false);
  };

  const openTagDialog = (clientId: string, clientName: string) => {
    if (!clientId) return;
    setTagDialogClientId(clientId);
    setTagDialogClientName(clientName);
    setNewTagText("");
    setTagDialogColor("blue");
    setTagDialogOpen(true);
  };

  const tagColorClasses = (color?: string | null) => {
    switch (color) {
      case "green":
        return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
      case "amber":
        return "bg-amber-500/10 text-amber-700 border-amber-500/30";
      case "red":
        return "bg-red-500/10 text-red-700 border-red-500/30";
      case "purple":
        return "bg-violet-500/10 text-violet-700 border-violet-500/30";
      case "blue":
      default:
        return "bg-sky-500/10 text-sky-700 border-sky-500/30";
    }
  };

  const handleContactWhatsApp = async (phone: string, name: string) => {
    if (!selectedLoan) return;
    const cliente = String(selectedLoan.client_name);
    const msg = `Olá ${name}, este é um contato sobre o empréstimo do cliente ${cliente}.`;
    if (!phone?.trim()) {
      toast.error("Contato sem telefone");
      return;
    }
    const res = await sendWhatsAppMessage(phone, msg);
    if (res.via === "api") toast.success("Mensagem enviada");
  };

  const handleContract = async (loan: LoanRow) => {
    try {
      const full = loanFull || (await fetchLoanById(String(loan.id)));
      const doc = new jsPDF();
      const m = getPdfMargin();
      let y = addPdfHeader(doc, "Contrato de Mútuo", undefined);
      y += 8;
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("CONTRATO DE MÚTUO", 105, y, { align: "center" });
      y += 12;
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      const clientName = (full as { client_name?: string }).client_name || String(loan.client_name);
      const clientCpf = (full as { client_cpf?: string }).client_cpf || "";
      const addr = (full as { client_address?: string }).client_address || "Endereco nao informado";
      doc.text(`MUTUARIO: ${clientName}, CPF ${clientCpf}, residente em ${addr}.`, m, y, { maxWidth: 170 });
      y += 15;
      const amt = parseFloat(String(loan.amount || 0));
      doc.text(`Objeto: valor de R$ ${amt.toFixed(2)} com vencimento em ${formatDate(String(loan.due_date))}.`, m, y, { maxWidth: 170 });
      y += 10;
      doc.text(`Foro: ${PDF_BRAND.foro}.`, m, y);
      addPdfFooter(doc, 1);
      doc.save(`contrato-emprestimo-${loan.id}.pdf`);
      toast.success("Contrato gerado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar contrato");
    }
  };

  const handlePDF = async (loan: LoanRow) => {
    try {
      const full = loanFull || (await fetchLoanById(String(loan.id)));
      const doc = new jsPDF();
      const m = getPdfMargin();
      let y = addPdfHeader(doc, "Comprovante de Empréstimo", undefined);
      y += 8;
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text(`Cliente: ${(full as { client_name?: string }).client_name || loan.client_name}`, m, y);
      y += 7;
      doc.text(`CPF: ${(full as { client_cpf?: string }).client_cpf || "-"}`, m, y);
      y += 7;
      doc.text(`Valor: R$ ${Number(loan.amount).toFixed(2)}`, m, y);
      y += 7;
      doc.text(`Juros: ${loan.interest_rate}%`, m, y);
      y += 7;
      const amt = Number(loan.amount);
      const rate = Number(loan.interest_rate);
      doc.text(`Total: R$ ${(amt + amt * (rate / 100)).toFixed(2)}`, m, y);
      y += 7;
      doc.text(`Vencimento: ${formatDate(String(loan.due_date))}`, m, y);
      addPdfFooter(doc, 1);
      doc.save(`emprestimo-${loan.id}.pdf`);
      toast.success("PDF gerado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar PDF");
    }
  };

  const handleDelete = async (loan: LoanRow) => {
    if (!confirm(`Excluir emprestimo de ${loan.client_name}? Esta acao nao pode ser desfeita.`))
      return;
    try {
      const { error } = await supabase.from("loans").delete().eq("id", loan.id);
      if (error) throw error;
      toast.success("Emprestimo excluido");
      invalidateLoanRelated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Tente novamente");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Emprestimos</h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
        <div className="glass-card p-8 animate-pulse h-64 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Emprestimos</h1>
          <p className="text-sm text-destructive">Erro ao carregar. Verifique a conexao.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Emprestimos</h1>
          <p className="text-sm text-muted-foreground">Controle de emprestimos ativos e historico</p>
        </div>
        <Button onClick={openNewLoan} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
          <Plus className="h-4 w-4" />
          Novo Empréstimo
        </Button>
      </div>

      <div className="glass-card">
        <div className="p-4 border-b border-border/30 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar emprestimo..."
              className="pl-8 h-8 text-xs nexus-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-auto h-8 text-xs nexus-input max-w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="parcelamentos">Parcelamentos</SelectItem>
              <SelectItem value="paid">Quitados</SelectItem>
              <SelectItem value="overdue">Vencidos</SelectItem>
              <SelectItem value="cancelled">Cancelados</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          {isParcelamentos ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Cliente</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Valor Total</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Progresso</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4 hidden md:table-cell">Valor Parcela</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4 hidden md:table-cell">Próximo Vencimento</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {installmentsLoading ? (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Carregando parcelamentos...</td></tr>
                ) : installmentsError ? (
                  <tr><td colSpan={6} className="p-8 text-center text-destructive">Erro ao carregar parcelamentos</td></tr>
                ) : filteredInstallments.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nenhum parcelamento ativo encontrado</td></tr>
                ) : (
                  <TooltipProvider delayDuration={300}>
                    {filteredInstallments.map((inst: InstallmentRow, i: number) => {
                      const unpaid = (inst.installment_payments || []).filter((p) => p.status === "pending");
                      const paidCount = (inst.installment_payments || []).filter((p) => p.status === "paid").length;
                      const nextDue = unpaid[0]?.due_date ? formatDate(unpaid[0].due_date) : "Todas pagas";
                      const progress = `${paidCount}/${inst.total_installments}`;

                      return (
                        <motion.tr
                          key={inst.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.03 }}
                          className="border-b border-border/20 hover:bg-surface-hover transition-colors"
                        >
                          <td className="p-4 text-sm font-medium text-foreground">
                            <div className="relative inline-flex items-center pr-20">
                              <span className="truncate max-w-[240px]">{inst.client_name}</span>
                              {(() => {
                                const cid = String(inst.client_id || "");
                                const score = clientScoreById[cid]?.score;
                                const label = clientScoreById[cid]?.label;
                                const isLoadingScore = clientScoreQueries[clientIdsOnPage.indexOf(cid)]?.isLoading;

                                return (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                        {isLoadingScore ? (
                                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border border-border/40 ${getScoreBg(score)}`}>
                                            …
                                          </span>
                                        ) : (
                                          <>
                                            <ScoreGauge score={typeof score === "number" ? score : undefined} />
                                            <button
                                              type="button"
                                              className="p-0.5 rounded-full hover:bg-muted/60"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openTagDialog(
                                                  cid,
                                                  inst.client_name
                                                );
                                              }}
                                              aria-label="Adicionar etiqueta"
                                            >
                                              <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                            </button>
                                          </>
                                        )}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      <span className={`font-semibold ${getScoreColor(score)}`}>
                                        {typeof score === "number" ? `${score}/100` : "Sem score"}
                                      </span>
                                      {label ? <span className="ml-2 text-muted-foreground">{label}</span> : null}
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })()}
                            </div>
                          </td>
                          <td className="p-4 text-sm text-foreground">{formatCurrency(inst.total_amount)}</td>
                          <td className="p-4 text-sm text-muted-foreground">{progress}</td>
                          <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">{formatCurrency(inst.installment_amount)}</td>
                          <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">{nextDue}</td>
                          <td className="p-4">
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
                              {inst.status === "completed" ? "Concluído" : "Ativo"}
                            </span>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </TooltipProvider>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Cliente</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Valor</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Juros</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Valor restante</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4 hidden md:table-cell">Data</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4 hidden md:table-cell">Vencimento</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Status</th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      Nenhum emprestimo encontrado
                    </td>
                  </tr>
                ) : (
                  <TooltipProvider delayDuration={300}>
                    {filtered.map((loan: LoanRow, i: number) => {
                      const displayStatus = getLoanStatusFromDueDate(
                        String(loan.due_date),
                        loan.status as string | null
                      );
                      const st = statusMap[displayStatus] || statusMap.active;
                      const isPaid = loan.status === "paid";

                      return (
                        <motion.tr
                          key={String(loan.id)}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.03 }}
                          className="border-b border-border/20 hover:bg-surface-hover transition-colors"
                        >
                          <td className="p-4 text-sm font-medium text-foreground">
                            <div className="relative inline-flex items-center pr-20">
                              <span className="truncate max-w-[240px]">{String(loan.client_name)}</span>
                              {(() => {
                                const cid = String((loan as { client_id?: string | number }).client_id || "");
                                const score = clientScoreById[cid]?.score;
                                const label = clientScoreById[cid]?.label;
                                const isLoadingScore = clientScoreQueries[clientIdsOnPage.indexOf(cid)]?.isLoading;

                                return (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                        {isLoadingScore ? (
                                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border border-border/40 ${getScoreBg(score)}`}>
                                            …
                                          </span>
                                        ) : (
                                          <>
                                            <ScoreGauge score={typeof score === "number" ? score : undefined} />
                                            <button
                                              type="button"
                                              className="p-0.5 rounded-full hover:bg-muted/60"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openTagDialog(
                                                  cid,
                                                  String(loan.client_name || "")
                                                );
                                              }}
                                              aria-label="Adicionar etiqueta"
                                            >
                                              <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                            </button>
                                          </>
                                        )}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      <span className={`font-semibold ${getScoreColor(score)}`}>
                                        {typeof score === "number" ? `${score}/100` : "Sem score"}
                                      </span>
                                      {label ? <span className="ml-2 text-muted-foreground">{label}</span> : null}
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })()}
                            </div>
                          </td>
                          <td className="p-4 text-sm text-foreground">{formatCurrency(Number(loan.amount))}</td>
                          <td className="p-4 text-sm text-muted-foreground">{loan.interest_rate}%</td>
                          <td className="p-4 text-sm font-medium text-foreground">
                            {loan.status === "paid" || loan.status === "cancelled"
                              ? "—"
                              : formatCurrency(Number(loan.remaining_amount ?? 0))}
                          </td>
                          <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">
                            {formatDate(String(loan.loan_date))}
                          </td>
                          <td
                            className={`p-4 text-sm hidden md:table-cell ${
                              isTerm20Days(String(loan.loan_date), String(loan.due_date))
                                ? "text-violet-500 font-medium"
                                : "text-muted-foreground"
                            }`}
                          >
                            {formatDate(String(loan.due_date))}
                          </td>
                          <td className="p-4">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${st.className}`}>
                              {st.label}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-0.5 flex-wrap">
                              <LoanActionButton icon={Eye} label="Ver detalhes" onClick={() => openViewDetails(loan)} variant="view" />
                              {isPaid ? (
                                <LoanActionButton icon={Trash2} label="Excluir" onClick={() => handleDelete(loan)} variant="delete" />
                              ) : (
                                <>
                                  <LoanActionButton icon={Pencil} label="Editar" onClick={() => openEdit(loan)} variant="edit" />
                                  <LoanActionButton icon={Wallet} label="Pagamentos" onClick={() => openPayments(loan)} variant="payment" />
                                  <LoanActionButton icon={MessageCircle} label="COBRANÇA" onClick={() => openWhatsapp(loan)} variant="whatsapp" />
                                  <LoanActionButton icon={CheckCircle} label="Quitar" onClick={() => openQuitar(loan)} variant="complete" />
                                  <LoanActionButton icon={FileText} label="Contrato" onClick={() => handleContract(loan)} variant="document" />
                                  <LoanActionButton icon={FileDown} label="PDF" onClick={() => handlePDF(loan)} variant="pdf" />
                                  <LoanActionButton icon={Users} label="Contatos" onClick={() => openContacts(loan)} variant="contacts" />
                                  <LoanActionButton icon={AlertTriangle} label="Multa" onClick={() => openMulta(loan)} variant="warning" />
                                  <LoanActionButton icon={Trash2} label="Excluir" onClick={() => handleDelete(loan)} variant="delete" />
                                </>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </TooltipProvider>
                )}
              </tbody>
            </table>
          )}
        </div>
        {!isParcelamentos && !search.trim() && (
          <Pagination
            page={page}
            total={totalLoans}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => setPage(p)}
          />
        )}
      </div>

      {/* Modal Novo Empréstimo */}
      <Dialog open={newLoanOpen} onOpenChange={setNewLoanOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo empréstimo</DialogTitle>
            <DialogDescription>Cadastre um novo empréstimo para um cliente</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleNewLoanSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label>Cliente *</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar cliente por nome..."
                  className="pl-8 mb-2"
                  value={newLoanClientSearch}
                  onChange={(e) => setNewLoanClientSearch(e.target.value)}
                />
              </div>
              <Select
                value={newLoanForm.client_id}
                onValueChange={(v) => setNewLoanForm((f) => ({ ...f, client_id: v }))}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {(clientsForSelect as Array<{ id: string; name: string }>)
                    .filter((c) =>
                      !newLoanClientSearch.trim() ||
                      String(c.name).toLowerCase().includes(newLoanClientSearch.toLowerCase())
                    )
                    .map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {newLoanForm.client_id && (
              <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
                <h4 className="text-sm font-semibold text-foreground">Score e histórico do cliente</h4>
                {clientHistoryLoading ? (
                  <p className="text-xs text-muted-foreground">Carregando...</p>
                ) : clientHistory?.score ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div
                        className={`text-2xl font-bold ${
                          clientHistory.score.score >= 80
                            ? "text-emerald-600"
                            : clientHistory.score.score >= 60
                              ? "text-primary"
                              : clientHistory.score.score >= 40
                                ? "text-amber-600"
                                : "text-red-600"
                        }`}
                      >
                        {clientHistory.score.score}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{clientHistory.score.label}</p>
                        <p className="text-[10px] text-muted-foreground">Score 1–100</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>Empréstimos: {clientHistory.totalLoans}</span>
                      <span>Quitados: {clientHistory.score.details.paidLoans}</span>
                      <span>Vencimentos atrasados: {clientHistory.score.details.overdueCount}</span>
                      <span>Total pago: {formatCurrency(clientHistory.totalPaid)}</span>
                    </div>
                    {clientHistory.score.score < 50 && (
                      <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">
                        Atenção: score baixo. Avalie com cautela.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Cliente sem histórico de empréstimos</p>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label>Valor (R$) *</Label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={newLoanForm.amount}
                onChange={(e) =>
                  setNewLoanForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d,.-]/g, "") }))
                }
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Juros (%) *</Label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={newLoanForm.interest_rate}
                onChange={(e) =>
                  setNewLoanForm((f) => ({ ...f, interest_rate: e.target.value.replace(/[^\d,.-]/g, "") }))
                }
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Prazo *</Label>
              <Select
                value={newLoanForm.term_days}
                onValueChange={(v: "20" | "30") => {
                  setNewLoanForm((f) => ({
                    ...f,
                    term_days: v,
                    due_date: computeDueDate(f.loan_date, parseInt(v) as 20 | 30),
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 dias</SelectItem>
                  <SelectItem value="20">20 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Data do empréstimo *</Label>
                <Input
                  type="date"
                  value={newLoanForm.loan_date}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewLoanForm((f) => ({
                      ...f,
                      loan_date: v,
                      due_date: computeDueDate(v, parseInt(f.term_days) as 20 | 30),
                    }));
                  }}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label>Vencimento *</Label>
                <Input
                  type="date"
                  value={newLoanForm.due_date}
                  onChange={(e) => setNewLoanForm((f) => ({ ...f, due_date: e.target.value }))}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewLoanOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Cadastrando..." : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Editar */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar emprestimo</DialogTitle>
            <DialogDescription>Altere os dados do emprestimo de {selectedLoan && String(selectedLoan.client_name)}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={editForm.amount}
                onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0,00"
              />
            </div>
            <div className="grid gap-2">
              <Label>Juros (%)</Label>
              <Input
                type="number"
                step="0.1"
                value={editForm.interest_rate}
                onChange={(e) => setEditForm((f) => ({ ...f, interest_rate: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Data emprestimo</Label>
                <Input
                  type="date"
                  value={editForm.loan_date}
                  onChange={(e) => setEditForm((f) => ({ ...f, loan_date: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Vencimento</Label>
                <Input
                  type="date"
                  value={editForm.due_date}
                  onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="partial_paid">Pago parcial</SelectItem>
                  <SelectItem value="overdue">Vencido</SelectItem>
                  <SelectItem value="paid">Quitado</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleEditSubmit} disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Ver Detalhes do Empréstimo */}
      <Dialog open={viewDetailsOpen} onOpenChange={setViewDetailsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do empréstimo</DialogTitle>
            <DialogDescription>Informações completas do cliente, empréstimo e pagamentos</DialogDescription>
          </DialogHeader>
          {selectedLoan && (
            <div className="space-y-6 py-4">
              {/* Dados do cliente */}
              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="font-semibold text-foreground mb-3">Dados do cliente</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Nome:</span> <span className="font-medium">{loanFull?.client_name ?? selectedLoan.client_name}</span></div>
                  <div><span className="text-muted-foreground">CPF:</span> {loanFull?.client_cpf ?? selectedLoan.client_cpf ?? "—"}</div>
                  <div><span className="text-muted-foreground">Telefone:</span> {loanFull?.client_phone ?? selectedLoan.client_phone ?? "—"}</div>
                  <div><span className="text-muted-foreground">E-mail:</span> {loanFull?.client_email ?? selectedLoan.client_email ?? "—"}</div>
                  <div className="md:col-span-2"><span className="text-muted-foreground">Endereço:</span> {loanFull?.client_address ?? "—"}</div>
                </div>
              </div>
              {/* Valores e datas */}
              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="font-semibold text-foreground mb-3">Empréstimo</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Valor original:</span> <span className="font-semibold">{formatCurrency(Number(selectedLoan.amount ?? 0))}</span></div>
                  <div><span className="text-muted-foreground">Juros:</span> {selectedLoan.interest_rate}%</div>
                  <div><span className="text-muted-foreground">Data do empréstimo:</span> {formatDate(String(selectedLoan.loan_date))}</div>
                  <div><span className="text-muted-foreground">Vencimento:</span> {formatDate(String(selectedLoan.due_date))}</div>
                  {(() => {
                    const totalPago = loanPayments.reduce(
                      (s: number, p: { amount: number; fine_amount?: number }) =>
                        s + (p.amount || 0) + (p.fine_amount || 0),
                      0
                    );
                    return (
                      <>
                        <div><span className="text-muted-foreground">Valor total pago:</span> <span className="font-semibold text-green-600">{formatCurrency(totalPago)}</span></div>
                        <div><span className="text-muted-foreground">Valor restante:</span> <span className="font-semibold">{selectedLoan.status === "paid" ? formatCurrency(0) : loanRemaining ? formatCurrency(loanRemaining.remainingAmount) : "—"}</span></div>
                      </>
                    );
                  })()}
                </div>
              </div>
              {/* Etiquetas do cliente */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-foreground">Etiquetas do cliente</h4>
                  <span className="text-[11px] text-muted-foreground">
                    {clientTagsLoading ? "Carregando..." : `${(clientTags as ClientTagRow[]).length} etiqueta(s)`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {(clientTags as ClientTagRow[]).map((tag) => (
                    <span
                      key={tag.id}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${tagColorClasses(tag.color)}`}
                    >
                      <span className="max-w-[220px] truncate">{tag.text}</span>
                      {tag.created_by_name && (
                        <span className="text-[9px] text-primary/70 ml-1">
                          · {tag.created_by_name}
                        </span>
                      )}
                      <button
                        type="button"
                        className="ml-0.5 text-xs text-muted-foreground hover:text-destructive"
                        aria-label="Remover etiqueta"
                        onClick={() => deleteTagMutation.mutate({ id: tag.id })}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {!clientTagsLoading && (clientTags as ClientTagRow[]).length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Nenhuma etiqueta cadastrada para este cliente.
                    </p>
                  )}
                </div>
              </div>
              {/* Pagamentos */}
              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="font-semibold text-foreground mb-3">Pagamentos ({loanPayments.length})</h4>
                {loanPayments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum pagamento registrado</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2">Data</th>
                          <th className="text-left py-2">Valor</th>
                          <th className="text-left py-2">Multa</th>
                          <th className="text-left py-2">Tipo</th>
                          <th className="text-right py-2 w-12">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loanPayments.map((p: { id: string; payment_date: string; amount: number; fine_amount: number; payment_type: string }) => (
                          <tr key={p.id} className="border-b border-border/30">
                            <td className="py-2">{formatDate(p.payment_date)}</td>
                            <td>{formatCurrency(p.amount)}</td>
                            <td>{p.fine_amount ? formatCurrency(p.fine_amount) : "—"}</td>
                            <td className="text-muted-foreground">{p.payment_type || "—"}</td>
                            <td className="py-2 text-right">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePayment(p.id)}
                                    disabled={isSubmitting}
                                    className="p-1.5 rounded-md transition-colors text-destructive hover:text-destructive/80 hover:bg-destructive/10 disabled:opacity-50"
                                    title="Excluir pagamento"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Excluir pagamento</TooltipContent>
                              </Tooltip>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Registrar Pagamento */}
      <Dialog open={registerPaymentOpen} onOpenChange={setRegisterPaymentOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar pagamento / Renovação</DialogTitle>
            <DialogDescription>
              {selectedLoan && (
                <span className="font-medium text-foreground">{String(selectedLoan.client_name)}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
            {/* Coluna 1 - Detalhes do empréstimo */}
            <div className="space-y-3 text-sm">
              <h4 className="font-semibold text-foreground border-b pb-1">Detalhes do empréstimo</h4>
              {loanRemaining ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Capital restante</span>
                    <span>{formatCurrency(loanRemaining.capital)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Juros (%)</span>
                    <span>{loanRemaining.interestRate.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valor dos juros</span>
                    <span>{formatCurrency(loanRemaining.interestAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total com juros</span>
                    <span>{formatCurrency(loanRemaining.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Valor restante</span>
                    <span>{formatCurrency(loanRemaining.remainingAmount)}</span>
                  </div>
                  <div className="flex justify-between text-primary">
                    <span>Pagamento mínimo</span>
                    <span>{formatCurrency(loanRemaining.minimumPayment)}</span>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground py-2">Carregando...</p>
              )}
            </div>
            {/* Coluna 2 - Pagamentos já realizados */}
            <div className="space-y-3 text-sm">
              <h4 className="font-semibold text-foreground border-b pb-1">Pagamentos realizados</h4>
              {loanRemaining ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Capital pago</span>
                    <span>{formatCurrency(loanRemaining.capitalPaid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Juros pagos</span>
                    <span>{formatCurrency(loanRemaining.interestPaid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Multas pagas</span>
                    <span>{formatCurrency(loanRemaining.finesPaid)}</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Total pago</span>
                    <span>{formatCurrency(loanRemaining.totalPaid)}</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); openConfirmDueDate(); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Data do pagamento *</Label>
                <Input
                  type="date"
                  value={paymentForm.payment_date}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label>Valor (R$) *</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={paymentForm.amount}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d,.-]/g, "") }))
                  }
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Tipo</Label>
                <Select
                  value={paymentForm.payment_type}
                  onValueChange={(v) => setPaymentForm((f) => ({ ...f, payment_type: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dinheiro">Dinheiro</SelectItem>
                    <SelectItem value="pix">Pix</SelectItem>
                    <SelectItem value="cartao">Cartão</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Multa (opcional)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={paymentForm.fine_amount}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, fine_amount: e.target.value.replace(/[^\d,.-]/g, "") }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Observações</Label>
              <Textarea
                placeholder="Observações..."
                rows={2}
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <DialogFooter className="gap-2 flex-wrap">
              <Button type="button" variant="outline" onClick={() => setRegisterPaymentOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={openRenewal20}
                disabled={!paymentForm.amount || parseFloat(String(paymentForm.amount).replace(",", ".")) <= 0}
              >
                RENOVAR 20+
              </Button>
              <Button
                type="submit"
                disabled={!paymentForm.amount || parseFloat(String(paymentForm.amount).replace(",", ".")) <= 0}
              >
                Registrar pagamento (30+)
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Confirmar Nova Data de Vencimento (30 dias) */}
      <Dialog open={confirmDueDateOpen} onOpenChange={setConfirmDueDateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar nova data de vencimento</DialogTitle>
            <DialogDescription>
              Cliente: {selectedLoan && String(selectedLoan.client_name)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-sm">
              <p>
                Vencimento atual: <strong>{selectedLoan && formatDate(String(selectedLoan.due_date))}</strong>
              </p>
              <p className="mt-2">
                Nova data sugerida:{" "}
                <strong>
                  {selectedLoan &&
                    formatDate(
                      calculateNextDueDate(String(selectedLoan.due_date), 30)
                    )}
                </strong>
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Alterar vencimento (opcional)</Label>
              <Input
                type="date"
                value={
                  overrideDueDate ||
                  (selectedLoan
                    ? calculateNextDueDate(String(selectedLoan.due_date), 30)
                    : "")
                }
                onChange={(e) => setOverrideDueDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDueDateOpen(false)}>
              Voltar
            </Button>
            <Button onClick={confirmDueDateAndOpenRenewal}>
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Opções de Renovação */}
      <Dialog open={renewalOptionsOpen} onOpenChange={setRenewalOptionsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Opções de renovação (+{renewalDays} dias)</DialogTitle>
            <DialogDescription>
              Nova data:{" "}
              {selectedLoan &&
                formatDate(
                  overrideDueDate ||
                    calculateNextDueDate(String(selectedLoan.due_date), renewalDays)
                )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-3"
              onClick={() => handleRenewalPayment("capital_interest_renewal")}
              disabled={isSubmitting}
            >
              <span className="text-left">
                <strong>Capital + Juros</strong>
                <br />
                <span className="text-muted-foreground text-xs">
                  RENOVAÇÃO +{renewalDays} DIAS - Capital + Juros
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-3"
              onClick={() => handleRenewalPayment("interest_renewal")}
              disabled={isSubmitting}
            >
              <span className="text-left">
                <strong>Somente Juros</strong>
                <br />
                <span className="text-muted-foreground text-xs">
                  RENOVAÇÃO +{renewalDays} DIAS - Somente Juros
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-3"
              onClick={() => handleRenewalPayment("capital_renewal")}
              disabled={isSubmitting}
            >
              <span className="text-left">
                <strong>Somente Capital</strong>
                <br />
                <span className="text-muted-foreground text-xs">
                  RENOVAÇÃO +{renewalDays} DIAS - Somente Capital
                </span>
              </span>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewalOptionsOpen(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal COBRANÇA WhatsApp */}
      <Dialog open={whatsappOpen} onOpenChange={setWhatsappOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar COBRANÇA via WhatsApp</DialogTitle>
            <DialogDescription>
              Selecione uma chave PIX para incluir na mensagem de cobrança para {selectedLoan && String(selectedLoan.client_name)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {pixKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma chave PIX cadastrada.</p>
            ) : (
              (pixKeys as Array<{ id: string; bank: string; key: string; holder: string }>).map((pix) => (
                <button
                  key={pix.id}
                  type="button"
                  className="w-full p-4 border rounded-lg text-left hover:bg-muted/50 transition-colors flex items-center justify-between gap-2"
                  onClick={() => handleWhatsAppWithPix(pix)}
                >
                  <div>
                    <div className="font-medium">{pix.bank}</div>
                    <div className="text-xs text-muted-foreground">{pix.holder} - {pix.key}</div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-[#25D366] shrink-0" />
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Comprovante de pagamento */}
      <Dialog open={comprovanteOpen} onOpenChange={setComprovanteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar comprovante via WhatsApp</DialogTitle>
            <DialogDescription>
              {comprovanteData && (
                <>
                  Pagamento de {formatCurrency(comprovanteData.valorPago)} registrado.
                  Próximo vencimento: {formatDate(comprovanteData.proximoVencimento)}.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {comprovanteData && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-border/50 bg-muted/30 p-4 text-sm">
                <p className="font-medium text-foreground mb-2">Mensagem que será enviada:</p>
                <p className="text-muted-foreground whitespace-pre-wrap text-xs">
                  {buildComprovanteMessage(
                    comprovanteData.clientName,
                    comprovanteData.valorPago,
                    comprovanteData.proximoVencimento
                  )}
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setComprovanteOpen(false)}>
                  Fechar
                </Button>
                <Button
                  className="gap-2 bg-[#25D366] hover:bg-[#20BD5A]"
                  disabled={!comprovanteData.clientPhone}
                  onClick={async () => {
                    if (!comprovanteData?.clientPhone) {
                      toast.error("Cliente sem telefone cadastrado");
                      return;
                    }
                    const msg = buildComprovanteMessage(
                      comprovanteData.clientName,
                      comprovanteData.valorPago,
                      comprovanteData.proximoVencimento
                    );
                    const res = await sendWhatsAppMessage(comprovanteData.clientPhone, msg);
                    if (res.via === "api") toast.success("Mensagem enviada");
                    setComprovanteOpen(false);
                  }}
                >
                  <MessageCircle className="h-4 w-4" />
                  Enviar via WhatsApp
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Quitar */}
      <Dialog open={quitarOpen} onOpenChange={setQuitarOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quitar emprestimo</DialogTitle>
            <DialogDescription>
              Confirme a data da quitacao para {selectedLoan && String(selectedLoan.client_name)}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Data da quitacao</Label>
              <Input
                type="date"
                value={quitarDate}
                onChange={(e) => setQuitarDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuitarOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleQuitarSubmit} disabled={isSubmitting}>
              {isSubmitting ? "Processando..." : "Quitar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Multa */}
      <Dialog open={multaOpen} onOpenChange={setMultaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Aplicar multa</DialogTitle>
            <DialogDescription>
              Registrar multa para {selectedLoan && String(selectedLoan.client_name)}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={multaForm.amount}
                onChange={(e) => setMultaForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0,00"
              />
            </div>
            <div className="grid gap-2">
              <Label>Motivo *</Label>
              <Input
                value={multaForm.reason}
                onChange={(e) => setMultaForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Ex: atraso no pagamento"
              />
            </div>
            <div className="grid gap-2">
              <Label>Observacoes</Label>
              <Textarea
                value={multaForm.notes}
                onChange={(e) => setMultaForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Opcional"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMultaOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleMultaSubmit} disabled={isSubmitting}>
              {isSubmitting ? "Aplicando..." : "Aplicar multa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Contatos */}
      <Dialog open={contactsOpen} onOpenChange={setContactsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Contatos (avalista / emergencia)</DialogTitle>
            <DialogDescription>
              Cliente: {selectedLoan && String(selectedLoan.client_name)}. Clique para enviar WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-72 overflow-y-auto">
            {guarantors.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-2">Avalistas</h4>
                <div className="space-y-2">
                  {guarantors.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className="w-full p-3 border rounded-lg text-left hover:bg-muted/50 flex items-center justify-between"
                      onClick={() => handleContactWhatsApp(g.phone, g.name)}
                    >
                      <span>{g.name} - {g.phone}</span>
                      <ExternalLink className="h-4 w-4 text-[#25D366]" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {emergencyContacts.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-amber-600 dark:text-amber-400 mb-2">Contatos de emergencia</h4>
                <div className="space-y-2">
                  {emergencyContacts.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className="w-full p-3 border rounded-lg text-left hover:bg-muted/50 flex items-center justify-between"
                      onClick={() => handleContactWhatsApp(e.phone, e.name)}
                    >
                      <span>{e.name} - {e.phone}</span>
                      <ExternalLink className="h-4 w-4 text-[#25D366]" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {guarantors.length === 0 && emergencyContacts.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nenhum avalista ou contato de emergencia cadastrado.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Etiquetas rápidas */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar etiqueta</DialogTitle>
            <DialogDescription>
              Cliente: {tagDialogClientName || "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-3">
            <div className="grid gap-2">
              <Label>Texto da etiqueta</Label>
              <Textarea
                rows={2}
                placeholder="Ex: Cliente pontual, atrasou últimas parcelas..."
                value={newTagText}
                onChange={(e) => setNewTagText(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Cor</Label>
              <Select value={tagDialogColor} onValueChange={(v) => setTagDialogColor(v)}>
                <SelectTrigger className="h-8 text-xs w-[180px]">
                  <SelectValue placeholder="Cor da etiqueta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blue">Azul</SelectItem>
                  <SelectItem value="green">Verde</SelectItem>
                  <SelectItem value="amber">Laranja</SelectItem>
                  <SelectItem value="red">Vermelho</SelectItem>
                  <SelectItem value="purple">Roxo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!newTagText.trim() || !tagDialogClientId || addTagMutation.isPending}
              onClick={() => {
                if (!tagDialogClientId || !newTagText.trim()) return;
                addTagMutation.mutate(
                  { clientId: tagDialogClientId, text: newTagText.trim(), color: tagDialogColor },
                  {
                    onSuccess: () => {
                      setTagDialogOpen(false);
                    },
                  }
                );
              }}
            >
              Salvar etiqueta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
