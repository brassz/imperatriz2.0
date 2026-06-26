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
  Archive,
  StickyNote,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
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
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchLoans,
  createLoan,
  updateLoan,
  markLoanAsPaid,
  fetchLoanById,
  finalizeLoan,
  fetchLoanClientContacts,
  type LoanClientContact,
  type LoanSortOption,
} from "@/api/loans";
import { fetchInstallments, type InstallmentRow } from "@/api/installments";
import { createPayment, createRenewalPayment, fetchPaymentsByLoanId, deletePayment } from "@/api/payments";
import { fetchLoanFineWaivers, insertLoanFineWaivers } from "@/api/loan-fine-waivers";
import { listOverdueFineCalendarDates, DAILY_OVERDUE_FINE_BRL } from "@/lib/loan-overdue-fine";
import { calendarDateInBrazil } from "@/lib/brazil-date";
import {
  searchLoanNotesAndObservations,
  type LoanNotesSearchScope,
  type PaymentNoteHit,
  type PaidLoanNoteHit,
} from "@/api/loan-notes-search";
import { calculateLoanRemaining, calculateNextDueDate, type LoanRemainingResult } from "@/api/loan-calc";
import { fetchPixKeys } from "@/api/pix-keys";
import { fetchRenegotiatedClientIds } from "@/api/renegotiations";
import { sendWhatsAppComprovante, sendWhatsAppMessage } from "@/api/evolution";
import { buildCobrancaMessage, buildComprovanteMessage, buildLoanCreationNotificationMessage } from "@/lib/whatsapp-messages";
import { createFine, fetchFinesForClient, deleteFine } from "@/api/fines";
import { fetchClientsForSelect, fetchClientHistory, fetchClientScore } from "@/api/clients";
import { fetchClientTags, createClientTag, deleteClientTag, type ClientTagRow } from "@/api/client-tags";
import { fetchGuarantors, fetchEmergencyContacts } from "@/api/contacts";
import { fetchCapitalRaises, type CapitalRaise } from "@/api/captacao";
import { supabase } from "@/lib/supabase";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import { addPdfHeader, addPdfFooter, getPdfMargin, PDF_BRAND } from "@/lib/pdf-utils";
import { comprovantePdfToBase64, generateComprovantePagamentoPdf } from "@/lib/comprovante-pdf";
import { generateContratoMutuoPdf } from "@/lib/contrato-mutuo-pdf";
import { Pagination } from "@/components/Pagination";
import { PAGE_SIZE } from "@/lib/constants";
import { useAuth } from "@/contexts/AuthContext";
import { paymentTypeLabel } from "@/lib/payment-type-label";
import { useCompany } from "@/contexts/CompanyContext";
import { PaymentFineWaiveDialog } from "@/components/loans/PaymentFineWaiveDialog";
import { LoanWeeklyInstallmentsTable } from "@/components/loans/LoanWeeklyInstallmentsTable";
import {
  fetchLoanWeeklyInstallments,
  markLoanWeeklyInstallmentPaid,
  type LoanWeeklyInstallment,
} from "@/api/loan-weekly-installments";
import {
  buildUnaiWeeklyInstallments,
  computeUnaiDueDate,
  isWeeklyLoanProduct,
  resolveUnaiWeeklyForCobranca,
  IMPERATRIZ_LOAN_PRODUCT_OPTIONS,
  supportsWeeklyLoanProducts,
  unaiLoanProductLabel,
  type UnaiLoanProduct,
} from "@/lib/unai-cred";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

function isTerm20Days(loanDate: string, dueDate: string): boolean {
  if (!loanDate || !dueDate) return false;
  const d1 = new Date(String(loanDate).split("T")[0]);
  const d2 = new Date(String(dueDate).split("T")[0]);
  const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  return diff >= 18 && diff <= 22;
}

function safeFilePart(s: string): string {
  return String(s || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function todayInSaoPauloYmd(): string {
  // Evita bug de fuso (UTC/local) que marca vencimento de hoje como vencido.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getLoanStatusFromDueDate(dueDate: string, dbStatus: string | null): string {
  if (dbStatus === "paid") return "paid";
  if (dbStatus === "cancelled") return "cancelled";
  if (dbStatus === "finalized") return "finalized";

  const dueYmd = String(dueDate || "").split("T")[0];
  if (!dueYmd) return "active";
  const todayYmd = todayInSaoPauloYmd();

  if (dueYmd < todayYmd) return "overdue";
  if (dueYmd === todayYmd) return "due_today";
  return "active";
}

const statusMap: Record<string, { label: string; className: string }> = {
  active: { label: "Ativo", className: "bg-primary/10 text-primary" },
  due_today: { label: "Vence Hoje", className: "bg-warning/10 text-warning" },
  overdue: { label: "Vencido", className: "bg-destructive/10 text-destructive" },
  partial_paid: { label: "Pago parcial", className: "bg-warning/10 text-warning" },
  paid: { label: "Quitado", className: "bg-success/10 text-success" },
  cancelled: { label: "Cancelado", className: "bg-muted text-muted-foreground" },
  finalized: { label: "Finalizado", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
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
function formatDateTimePt(raw: string) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function toInputDate(d: string) {
  if (!d) return "";
  return String(d).split("T")[0];
}

function parseMoneyInput(raw: string): number {
  const s = String(raw || "").trim();
  if (!s) return NaN;
  const cleaned = s.replace(/[^\d.,-]/g, "");
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const decSep = lastDot > lastComma ? "." : lastComma > lastDot ? "," : null;
  let normalized = cleaned;

  if (decSep) {
    const thousandsSep = decSep === "." ? "," : ".";
    normalized = normalized.replaceAll(thousandsSep, "");
    normalized = normalized.replace(decSep, ".");
  } else {
    normalized = normalized.replaceAll(".", "").replaceAll(",", "");
  }

  const parts = normalized.split(".");
  if (parts.length > 2) {
    const dec = parts.pop() as string;
    normalized = `${parts.join("")}.${dec}`;
  }
  return parseFloat(normalized);
}

function formatCurrencyBrl(n: number): string {
  return "R$ " + (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildParcelamentoOptions(total: number): Array<{ n: number; parcela: number }> {
  const base = Math.max(0, Number(total) || 0);
  const out: Array<{ n: number; parcela: number }> = [];
  for (let n = 1; n <= 12; n++) {
    out.push({ n, parcela: base / n });
  }
  return out;
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
  const [searchParams] = useSearchParams();
  const searchFromUrl = searchParams.get("search") || searchParams.get("phone") || "";
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState(searchFromUrl);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [loanSort, setLoanSort] = useState<LoanSortOption>("default");
  const [editOpen, setEditOpen] = useState(false);
  const [registerPaymentOpen, setRegisterPaymentOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [quitarOpen, setQuitarOpen] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [multaOpen, setMultaOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [viewDetailsOpen, setViewDetailsOpen] = useState(false);
  const [paymentDetailOpen, setPaymentDetailOpen] = useState(false);
  const [paymentDetailRow, setPaymentDetailRow] = useState<{
    id: string;
    payment_date: string;
    created_at: string;
    amount: number;
    fine_amount: number;
    payment_type: string;
    notes: string;
  } | null>(null);
  const [comprovanteOpen, setComprovanteOpen] = useState(false);
  const [comprovanteData, setComprovanteData] = useState<{
    clientId: string;
    clientName: string;
    clientPhone: string;
    valorPago: number;
    proximoVencimento: string;
    loanId: string;
    paymentDate: string;
    paymentDescription: string;
    quitado?: boolean;
  } | null>(null);
  const [comprovanteSending, setComprovanteSending] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<LoanRow | null>(null);
  const [editForm, setEditForm] = useState({ amount: "", interest_rate: "", loan_date: "", due_date: "", status: "active" });
  const [quitarDate, setQuitarDate] = useState(toInputDate(new Date().toISOString()));
  const [clientFines, setClientFines] = useState<Array<{ id: string; amount: number; reason: string; notes: string | null; created_at: string }>>([]);
  const [overdueFines, setOverdueFines] = useState<Array<{ date: string; waived: boolean }>>([]);
  const [loadingFines, setLoadingFines] = useState(false);
  const [multaValor, setMultaValor] = useState("");
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
    loan_product: "mensal" as UnaiLoanProduct,
    loan_date: toInputDate(new Date().toISOString()),
    due_date: "",
    capital_raise_id: "",
    capital_raise_capital: "",
    capital_raise_interest: "",
  });
  const [confirmDueDateOpen, setConfirmDueDateOpen] = useState(false);
  const [renewalOptionsOpen, setRenewalOptionsOpen] = useState(false);
  const [renewalDays, setRenewalDays] = useState<30 | 20>(30);
  const [overrideDueDate, setOverrideDueDate] = useState("");
  const [fineWaiveOpen, setFineWaiveOpen] = useState(false);
  const [pendingRenewalOption, setPendingRenewalOption] = useState<
    "capital_interest_renewal" | "interest_renewal" | "capital_renewal" | "quitacao_total" | null
  >(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { companyId, companyName } = useCompany();
  const isUnaiCred = supportsWeeklyLoanProducts(companyId);
  const [newTagText, setNewTagText] = useState("");
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagDialogClientId, setTagDialogClientId] = useState<string | null>(null);
  const [tagDialogClientName, setTagDialogClientName] = useState<string>("");
  const [tagDialogColor, setTagDialogColor] = useState<string>("blue");
  const [notesSearchOpen, setNotesSearchOpen] = useState(false);
  const [notesSearchScope, setNotesSearchScope] = useState<LoanNotesSearchScope>("all");
  const [notesSearchTerm, setNotesSearchTerm] = useState("");
  const [notesSearchLoading, setNotesSearchLoading] = useState(false);
  const [notesSearchPayments, setNotesSearchPayments] = useState<PaymentNoteHit[]>([]);
  const [notesSearchPaidLoans, setNotesSearchPaidLoans] = useState<PaidLoanNoteHit[]>([]);
  const [notesSearchHasRun, setNotesSearchHasRun] = useState(false);
  const [contactsExportOpen, setContactsExportOpen] = useState(false);
  const [contactsExportLoading, setContactsExportLoading] = useState(false);
  const [loanClientContacts, setLoanClientContacts] = useState<LoanClientContact[]>([]);
  const [markingWeeklyId, setMarkingWeeklyId] = useState<string | null>(null);

  useEffect(() => {
    setSearch(searchFromUrl);
    setPage(1);
  }, [searchFromUrl]);

  const isParcelamentos = statusFilter === "parcelamentos";

  const { data, isLoading, error } = useQuery({
    queryKey: ["loans", statusFilter, page, search, periodFrom, periodTo, loanSort],
    queryFn: () => fetchLoans(statusFilter, page, search, { periodFrom, periodTo, sort: loanSort }),
    enabled: !isParcelamentos,
    /** Evita desmontar a página a cada tecla na busca (queryKey muda e isLoading ficava true). */
    placeholderData: keepPreviousData,
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

  const { data: renegotiatedClientIdList = [] } = useQuery({
    queryKey: ["renegotiated-client-ids"],
    queryFn: fetchRenegotiatedClientIds,
    staleTime: 60_000,
  });

  const renegotiatedClientIds = useMemo(
    () => new Set(renegotiatedClientIdList),
    [renegotiatedClientIdList],
  );

  const isRenegotiatedClient = (clientId: string) => renegotiatedClientIds.has(clientId);

  const { data: loanFull } = useQuery({
    queryKey: ["loan-full", selectedLoan?.id],
    queryFn: () => fetchLoanById(String(selectedLoan?.id)),
    enabled: !!selectedLoan?.id && (editOpen || quitarOpen || finalizeOpen || viewDetailsOpen),
  });

  const { data: clientsForSelect = [] } = useQuery({
    queryKey: ["clients-for-select"],
    queryFn: fetchClientsForSelect,
    enabled: newLoanOpen,
  });

  const { data: capitalRaises = [] } = useQuery({
    queryKey: ["capital-raises"],
    queryFn: fetchCapitalRaises,
    enabled: newLoanOpen,
    staleTime: 30_000,
  });

  const activeCapitalRaises = (capitalRaises as CapitalRaise[]).filter((r) => r.ativo);

  const { data: clientHistory, isLoading: clientHistoryLoading } = useQuery({
    queryKey: ["client-history", newLoanForm.client_id],
    queryFn: () => fetchClientHistory(newLoanForm.client_id),
    enabled: newLoanOpen && !!newLoanForm.client_id,
  });
  const { data: loanRemaining } = useQuery<LoanRemainingResult>({
    queryKey: ["loan-remaining", selectedLoan?.id],
    queryFn: () => calculateLoanRemaining(String(selectedLoan?.id)),
    enabled: !!selectedLoan?.id && (registerPaymentOpen || viewDetailsOpen || whatsappOpen || fineWaiveOpen),
  });
  const { data: loanPayments = [] } = useQuery({
    queryKey: ["loan-payments", selectedLoan?.id],
    queryFn: () => fetchPaymentsByLoanId(String(selectedLoan?.id)),
    enabled: !!selectedLoan?.id && viewDetailsOpen,
  });
  const { data: weeklyInstallments = [], refetch: refetchWeeklyInstallments } = useQuery({
    queryKey: ["loan-weekly-installments", selectedLoan?.id],
    queryFn: () => fetchLoanWeeklyInstallments(String(selectedLoan?.id)),
    enabled: !!selectedLoan?.id && isUnaiCred && (registerPaymentOpen || viewDetailsOpen || whatsappOpen || fineWaiveOpen),
  });
  const { data: detailsGuarantors = [] } = useQuery({
    queryKey: ["loan-client-guarantors", selectedLoan?.client_id],
    queryFn: () => fetchGuarantors(String(selectedLoan?.client_id)),
    enabled: !!selectedLoan?.client_id && viewDetailsOpen,
  });
  const { data: detailsEmergency = [] } = useQuery({
    queryKey: ["loan-client-emergency", selectedLoan?.client_id],
    queryFn: () => fetchEmergencyContacts(String(selectedLoan?.client_id)),
    enabled: !!selectedLoan?.client_id && viewDetailsOpen,
  });
  const { data: clientTags = [], isLoading: clientTagsLoading } = useQuery({
    queryKey: ["client-tags", selectedLoan?.client_id],
    queryFn: () => fetchClientTags(String(selectedLoan?.client_id)),
    enabled: !!selectedLoan?.client_id && viewDetailsOpen,
  });

  const { data: tagDialogTags = [], isLoading: tagDialogTagsLoading } = useQuery({
    queryKey: ["client-tags", tagDialogClientId],
    queryFn: () => fetchClientTags(String(tagDialogClientId)),
    enabled: tagDialogOpen && !!tagDialogClientId,
  });

  const { data: comprovanteScore, isLoading: comprovanteScoreLoading } = useQuery({
    queryKey: ["client-score", comprovanteData?.clientId],
    queryFn: () => fetchClientScore(String(comprovanteData!.clientId)),
    enabled: comprovanteOpen && !!comprovanteData?.clientId,
  });

  const { data: comprovanteRemaining, isLoading: comprovanteRemainingLoading } = useQuery<LoanRemainingResult>({
    queryKey: ["loan-remaining", "comprovante", comprovanteData?.loanId],
    queryFn: () => calculateLoanRemaining(String(comprovanteData!.loanId)),
    enabled: comprovanteOpen && !!comprovanteData?.loanId && !Boolean(comprovanteData?.quitado),
    staleTime: 0,
  });

  const [guarantors, setGuarantors] = useState<Array<{ id: string; name: string; phone: string; relationship?: string }>>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<
    Array<{ id: string; name: string; phone: string; relationship?: string }>
  >([]);

  // Quando `search` está preenchido, a busca é feita no backend (por CPF ou nome do cliente).
  const todayYmd = toInputDate(new Date().toISOString());
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

  /** Bolinha + número (sem SVG) — mais leve na listagem. */
  const getScoreDotBg = (score: number) => {
    if (score >= 80) return "bg-emerald-500";
    if (score >= 60) return "bg-primary";
    if (score >= 40) return "bg-amber-500";
    return "bg-red-500";
  };

  const ScoreDot = ({ score }: { score?: number }) => {
    if (typeof score !== "number") {
      return (
        <span className="inline-flex items-center gap-1 min-w-[2.25rem] tabular-nums">
          <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/35" aria-hidden />
          <span className="text-[10px] font-semibold text-muted-foreground">—</span>
        </span>
      );
    }
    const s = Math.max(0, Math.min(100, score));
    return (
      <span className={`inline-flex items-center gap-1 min-w-[2.25rem] tabular-nums ${getScoreColor(s)}`}>
        <span className={`h-2 w-2 rounded-full shrink-0 ${getScoreDotBg(s)}`} aria-hidden />
        <span className="text-[10px] font-semibold">{s}</span>
      </span>
    );
  };

  const computeDueDate = (loanDate: string, termDays: 20 | 30) => {
    const base = String(loanDate || "").trim();
    if (!base) return "";
    const d = new Date(base + "T12:00:00");
    if (Number.isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + termDays);
    return toInputDate(d.toISOString());
  };

  const newLoanWeeklyPreview = useMemo(() => {
    if (!isUnaiCred || !isWeeklyLoanProduct(newLoanForm.loan_product)) return [] as LoanWeeklyInstallment[];
    const amt = parseMoneyInput(newLoanForm.amount);
    const rate = parseMoneyInput(newLoanForm.interest_rate);
    if (!newLoanForm.loan_date || Number.isNaN(amt) || amt <= 0 || Number.isNaN(rate)) return [];
    return buildUnaiWeeklyInstallments(
      newLoanForm.loan_product,
      amt,
      rate,
      newLoanForm.loan_date,
    ).map((row) => ({
      id: `preview-${row.week_number}`,
      loan_id: "preview",
      week_number: row.week_number,
      due_date: row.due_date,
      amount: row.amount,
      status: "pending" as const,
      paid_at: null,
      payment_id: null,
    }));
  }, [isUnaiCred, newLoanForm.loan_product, newLoanForm.amount, newLoanForm.interest_rate, newLoanForm.loan_date]);

  const openNewLoan = () => {
    const today = toInputDate(new Date().toISOString());
    const defaultProduct: UnaiLoanProduct = "mensal";
    setNewLoanClientSearch("");
    setNewLoanForm({
      client_id: "",
      amount: "",
      // Padrão solicitado para contrato: 1% ao mês (editável).
      interest_rate: "1",
      term_days: "30",
      loan_product: defaultProduct,
      loan_date: today,
      due_date: isUnaiCred ? computeUnaiDueDate(defaultProduct, today) : computeDueDate(today, 30),
      capital_raise_id: "",
      capital_raise_capital: "",
      capital_raise_interest: "",
    });
    setNewLoanOpen(true);
  };

  const handleNewLoanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLoanForm.client_id || !newLoanForm.amount || !newLoanForm.interest_rate || !newLoanForm.loan_date || !newLoanForm.due_date) {
      toast.error("Preencha todos os campos");
      return;
    }
    const amt = parseMoneyInput(newLoanForm.amount);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Valor inválido");
      return;
    }
    const rate = parseMoneyInput(newLoanForm.interest_rate);
    if (isNaN(rate) || rate < 0) {
      toast.error("Juros inválidos");
      return;
    }
    const raiseId = String(newLoanForm.capital_raise_id || "").trim();
    const raiseCap = raiseId ? parseMoneyInput(newLoanForm.capital_raise_capital || "0") : 0;
    const raiseInt = raiseId ? parseMoneyInput(newLoanForm.capital_raise_interest || "0") : 0;
    if (raiseId) {
      if (!(raiseCap >= 0) || !(raiseInt >= 0)) {
        toast.error("Valores de captação inválidos");
        return;
      }
      if (raiseCap > amt + 1e-9) {
        toast.error("Capital (captação) não pode ser maior que o valor do empréstimo");
        return;
      }
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
      const inserted = await createLoan({
        client_id: newLoanForm.client_id,
        amount: amt,
        interest_rate: rate,
        loan_date: newLoanForm.loan_date,
        due_date: newLoanForm.due_date,
        loan_product: isUnaiCred ? newLoanForm.loan_product : undefined,
        capital_raise_id: raiseId ? raiseId : null,
        capital_raise_capital: raiseId ? raiseCap : undefined,
        capital_raise_interest: raiseId ? raiseInt : undefined,
      });
      toast.success("Empréstimo cadastrado");

      try {
        const full = await fetchLoanById(String(inserted?.id));
        const guarantorsList = await fetchGuarantors(String(newLoanForm.client_id));
        const avalista = guarantorsList?.[0] as { name?: unknown; cpf?: unknown; rg?: unknown; address?: unknown } | undefined;

        const doc = generateContratoMutuoPdf({
          mutuario: {
            name: String((full as { client_name?: unknown }).client_name || "—"),
            cpf: String((full as { client_cpf?: unknown }).client_cpf || ""),
            rg: String((full as { client_rg?: unknown }).client_rg || ""),
            address: String((full as { client_address?: unknown }).client_address || ""),
          },
          avalista: avalista?.name
            ? {
                name: String(avalista.name),
                cpf: String(avalista.cpf || ""),
                rg: String(avalista.rg || ""),
                address: String(avalista.address || ""),
              }
            : null,
          valorEmprestado: amt,
          vencimento: String(newLoanForm.due_date),
          multaPercent: 10,
          cidadeUf: "Franca",
          dataAssinatura: String(newLoanForm.loan_date),
        });

        const displayClientName = safeFilePart(String((full as { client_name?: unknown }).client_name || "cliente")) || "cliente";
        const loanDateYmd = String(newLoanForm.loan_date || "").split("T")[0];
        const fileName = `Contrato_${displayClientName}_${safeFilePart(loanDateYmd) || "data"}.pdf`;

        doc.save(fileName);

        const minimumPayment = amt * (rate / 100);
        const notifyMsg = buildLoanCreationNotificationMessage({
          clientName: displayClientName,
          capital: amt,
          loanDate: String(newLoanForm.loan_date),
          dueDate: String(newLoanForm.due_date),
          minimumPayment,
        });

        const phone = String((full as { client_phone?: unknown }).client_phone || "").trim();
        if (phone) {
          await sendWhatsAppMessage(phone, notifyMsg);
        } else {
          toast.message("Cliente sem telefone: não foi possível enviar a notificação por WhatsApp.");
        }
      } catch {
        // se falhar o contrato / WhatsApp, não bloquear o cadastro
      }

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

  const openFinalize = (loan: LoanRow) => {
    setSelectedLoan(loan);
    setFinalizeOpen(true);
  };

  const openMulta = async (loan: LoanRow) => {
    setSelectedLoan(loan);
    setClientFines([]);
    setOverdueFines([]);
    setMultaOpen(true);
    setLoadingFines(true);

    const clientId = loan.client_id ? String(loan.client_id) : "";
    const loanId = loan.id ? String(loan.id) : "";

    // Busca multas manuais
    if (clientId) {
      try {
        const fines = await fetchFinesForClient(clientId);
        setClientFines(fines);
      } catch {
        // silencioso - não impede mostrar multas automáticas
      }
    }

    // Calcula multas automáticas de atraso (R$50/dia)
    const dueDate = String(loan.due_date || "").split("T")[0];
    const today = calendarDateInBrazil();
    const status = String(loan.status || "").toLowerCase();
    const settled = status === "paid" || status === "cancelled" || status === "finalized";

    if (dueDate && dueDate < today && !settled) {
      const overdueDates = listOverdueFineCalendarDates(dueDate, today);
      if (overdueDates.length > 0) {
        let waivedDates: string[] = [];
        if (loanId) {
          try {
            waivedDates = await fetchLoanFineWaivers(loanId);
          } catch {
            // continua sem waivers
          }
        }
        const waivedSet = new Set(waivedDates);
        setOverdueFines(overdueDates.map((d) => ({ date: d, waived: waivedSet.has(d) })));
      }
    }

    setLoadingFines(false);
  };

  const openContacts = async (loan: LoanRow) => {
    setSelectedLoan(loan);
    const cid = String(loan.client_id);
    try {
      const [g, e] = await Promise.all([fetchGuarantors(cid), fetchEmergencyContacts(cid)]);
      setGuarantors((g as Array<{ id: string; name: string; phone: string; relationship?: string }>) || []);
      setEmergencyContacts((e as Array<{ id: string; name: string; phone: string; relationship?: string }>) || []);
      setContactsOpen(true);
    } catch {
      toast.error("Erro ao carregar contatos");
    }
  };

  const openViewDetails = (loan: LoanRow) => {
    setSelectedLoan(loan);
    setPaymentDetailOpen(false);
    setPaymentDetailRow(null);
    setViewDetailsOpen(true);
  };

  const openPaymentDetail = (p: {
    id?: unknown;
    payment_date?: unknown;
    created_at?: unknown;
    amount?: unknown;
    fine_amount?: unknown;
    payment_type?: unknown;
    notes?: unknown;
  }) => {
    setPaymentDetailRow({
      id: String(p.id ?? ""),
      payment_date: String(p.payment_date || "").split("T")[0],
      created_at: String(p.created_at || ""),
      amount: parseFloat(String(p.amount || 0)),
      fine_amount: parseFloat(String(p.fine_amount || 0)),
      payment_type: String(p.payment_type || ""),
      notes: String(p.notes || ""),
    });
    setPaymentDetailOpen(true);
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!selectedLoan?.id) return;
    if (!confirm("Excluir este pagamento? Esta ação não pode ser desfeita.")) return;
    setIsSubmitting(true);
    try {
      await deletePayment(paymentId);
      toast.success("Pagamento excluído");
      if (paymentDetailRow?.id === paymentId) {
        setPaymentDetailOpen(false);
        setPaymentDetailRow(null);
      }
      invalidateLoanRelated(String(selectedLoan.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir pagamento");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditSubmit = async () => {
    if (!selectedLoan?.id) return;
    if (editForm.loan_date && Number.isNaN(new Date(`${editForm.loan_date}T12:00:00`).getTime())) {
      toast.error("Data do empréstimo inválida");
      return;
    }
    if (editForm.due_date && Number.isNaN(new Date(`${editForm.due_date}T12:00:00`).getTime())) {
      toast.error("Data de vencimento inválida");
      return;
    }
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

  const invalidateLoanRelated = async (loanId?: string) => {
    const tasks: Promise<unknown>[] = [
      queryClient.invalidateQueries({ queryKey: ["loans"] }),
      queryClient.invalidateQueries({ queryKey: ["payments"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "client-history" }),
    ];
    if (loanId) {
      tasks.push(
        queryClient.invalidateQueries({ queryKey: ["loan-remaining", loanId] }),
        queryClient.invalidateQueries({ queryKey: ["loan-full", loanId] }),
        queryClient.invalidateQueries({ queryKey: ["loan-payments", loanId] }),
        queryClient.invalidateQueries({ queryKey: ["loan-fine-waivers", loanId] }),
      );
    }
    await Promise.all(tasks);
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

  const handleFinalizeSubmit = async () => {
    if (!selectedLoan?.id) return;
    const loanIdStr = String(selectedLoan.id);
    setIsSubmitting(true);
    try {
      await finalizeLoan(loanIdStr);
      setFinalizeOpen(false);
      queryClient.setQueriesData(
        {
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            q.queryKey[0] === "loans" &&
            q.queryKey[1] !== "finalized",
        },
        (old) => {
          if (!old || typeof old !== "object" || !("data" in old)) return old;
          const o = old as { data: Array<{ id: unknown }>; total: number };
          const data = o.data ?? [];
          const next = data.filter((l) => String(l.id) !== loanIdStr);
          if (next.length === data.length) return o;
          return { ...o, data: next, total: Math.max(0, (o.total ?? data.length) - 1) };
        },
      );
      await invalidateLoanRelated(loanIdStr);
      toast.success("Empréstimo finalizado. Ele sai da operação; os pagamentos continuam no histórico do cliente.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao finalizar");
    } finally {
      setIsSubmitting(false);
    }
  };

  const runNotesSearch = async () => {
    const t = notesSearchTerm.trim();
    if (!t) {
      toast.error("Digite um termo para buscar nas observações");
      return;
    }
    setNotesSearchLoading(true);
    try {
      const res = await searchLoanNotesAndObservations(t, notesSearchScope);
      setNotesSearchPayments(res.payments);
      setNotesSearchPaidLoans(res.paidLoans);
      setNotesSearchHasRun(true);
      const n = res.payments.length + res.paidLoans.length;
      if (n === 0) {
        toast.message("Nenhum resultado", { description: "Tente outro termo ou outro tipo de registro." });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao buscar observações");
    } finally {
      setNotesSearchLoading(false);
    }
  };

  const openLoanFromNotesSearch = async (loanId: string) => {
    try {
      const full = await fetchLoanById(loanId);
      setNotesSearchOpen(false);
      setSelectedLoan({
        id: full.id,
        client_id: full.client_id,
        client_name: full.client_name,
        client_phone: full.client_phone,
        client_cpf: full.client_cpf,
        client_email: full.client_email,
        amount: full.amount,
        interest_rate: full.interest_rate,
        loan_date: full.loan_date,
        due_date: full.due_date,
        status: full.status,
        created_at: full.created_at,
      } as LoanRow);
      setViewDetailsOpen(true);
    } catch {
      toast.error("Empréstimo não encontrado ou sem permissão para visualizar.");
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

  type RenewalPaymentOption =
    | "capital_interest_renewal"
    | "interest_renewal"
    | "capital_renewal"
    | "quitacao_total";

  const handleRenewalPayment = (option: RenewalPaymentOption) => {
    if (!selectedLoan?.id) return;
    const amt = parseFloat(String(paymentForm.amount).replace(",", "."));
    if (isNaN(amt) || amt <= 0) {
      toast.error("Informe o valor do pagamento");
      return;
    }
    setPendingRenewalOption(option);
    setFineWaiveOpen(true);
  };

  const proceedRenewalAfterFineModal = async (option: RenewalPaymentOption, waiveDates: string[]) => {
    if (!selectedLoan?.id) return;
    const amt = parseFloat(String(paymentForm.amount).replace(",", "."));
    if (isNaN(amt) || amt <= 0) {
      toast.error("Informe o valor do pagamento");
      return;
    }
    const labels: Record<string, string> = {
      capital_interest_renewal: "Capital + Aluguel",
      interest_renewal: "Somente Aluguel",
      capital_renewal: "Somente Capital",
      quitacao_total: "Quitação total",
    };
    const isQuitacao = option === "quitacao_total";
    const newDue = isQuitacao
      ? String(selectedLoan.due_date || "")
      : (overrideDueDate || calculateNextDueDate(String(selectedLoan.due_date), renewalDays));
    const confirmMsg = isQuitacao
      ? `Confirmar QUITAÇÃO TOTAL?\n\nTipo: ${labels[option]}\nValor: R$ ${amt.toFixed(2)}\nData do pagamento: ${formatDate(paymentForm.payment_date)}`
      : `Confirmar renovação por +${renewalDays} dias?\n\nTipo: ${labels[option]}\nValor: R$ ${amt.toFixed(2)}\nNova data: ${formatDate(newDue)}`;
    if (!confirm(confirmMsg)) return;

    setIsSubmitting(true);
    try {
      if (waiveDates.length > 0) {
        await insertLoanFineWaivers(String(selectedLoan.id), waiveDates);
      }
      const fineAmt = paymentForm.fine_amount ? parseFloat(String(paymentForm.fine_amount).replace(",", ".")) : 0;
      if (isQuitacao) {
        await createPayment({
          loan_id: String(selectedLoan.id),
          amount: amt,
          payment_date: paymentForm.payment_date,
          payment_type: "quitacao_total",
          notes: `Quitação total. ${paymentForm.notes || ""}`.trim(),
          fine_amount: fineAmt > 0 ? fineAmt : undefined,
        });
        await markLoanAsPaid(String(selectedLoan.id), paymentForm.payment_date);
      } else {
        await createRenewalPayment({
          loan_id: String(selectedLoan.id),
          amount: amt,
          payment_date: paymentForm.payment_date,
          payment_type: option,
          notes: `${labels[option]} - Renovação +${renewalDays} dias. ${paymentForm.notes || ""}`.trim(),
          fine_amount: fineAmt > 0 ? fineAmt : undefined,
          new_due_date: newDue,
        });
      }
      const fineAmtVal = fineAmt > 0 ? fineAmt : 0;
      const valorTotal = amt + fineAmtVal;
      toast.success(
        isQuitacao
          ? "Quitação registrada. Empréstimo quitado."
          : `Renovação registrada. Nova data: ${formatDate(newDue)}`,
      );
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
      if (selectedLoan.client_id) {
        void queryClient.invalidateQueries({ queryKey: ["client-score", String(selectedLoan.client_id)] });
      }
      setComprovanteData({
        clientId: String(selectedLoan.client_id || ""),
        clientName: String(selectedLoan.client_name),
        clientPhone: String(selectedLoan.client_phone || "").trim(),
        valorPago: valorTotal,
        proximoVencimento: newDue,
        loanId: String(selectedLoan.id),
        paymentDate: paymentForm.payment_date,
        paymentDescription: isQuitacao ? "Quitação total" : `${labels[option]} — Renovação +${renewalDays} dias`,
        quitado: isQuitacao,
      });
      setComprovanteOpen(true);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : (option === "quitacao_total" ? "Erro ao quitar empréstimo" : "Erro ao registrar renovação"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteFine = async (fineId: string) => {
    if (!selectedLoan?.client_id) return;
    setIsSubmitting(true);
    try {
      await deleteFine(fineId);
      toast.success("Multa removida");
      setClientFines((prev) => prev.filter((f) => f.id !== fineId));
      queryClient.invalidateQueries({ queryKey: ["fines"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover multa");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWaiveOverdueFine = async (dateYmd: string) => {
    if (!selectedLoan?.id) return;
    setIsSubmitting(true);
    try {
      await insertLoanFineWaivers(String(selectedLoan.id), [dateYmd]);
      setOverdueFines((prev) => prev.map((f) => f.date === dateYmd ? { ...f, waived: true } : f));
      toast.success(`Multa de ${dateYmd} anulada`);
      queryClient.invalidateQueries({ queryKey: ["fines"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao anular multa");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddMultaValor = async () => {
    if (!selectedLoan?.client_id) return;
    const amt = parseFloat(multaValor);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Digite um valor válido");
      return;
    }
    setIsSubmitting(true);
    try {
      await createFine({
        client_id: String(selectedLoan.client_id),
        amount: amt,
        reason: "Multa manual",
      });
      toast.success(`R$ ${amt.toFixed(2)} adicionado`);
      setMultaValor("");
      const fines = await fetchFinesForClient(String(selectedLoan.client_id));
      setClientFines(fines);
      queryClient.invalidateQueries({ queryKey: ["fines"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao adicionar multa");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveMultaValor = async () => {
    if (!selectedLoan?.id) return;
    const amt = parseFloat(multaValor);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Digite um valor válido");
      return;
    }
    setIsSubmitting(true);
    try {
      const daysToWaive = Math.ceil(amt / DAILY_OVERDUE_FINE_BRL);
      const activeDays = overdueFines.filter((f) => !f.waived).map((f) => f.date);
      const toWaive = activeDays.slice(0, daysToWaive);
      if (toWaive.length === 0) {
        toast.error("Não há multas de atraso ativas para remover");
        setIsSubmitting(false);
        return;
      }
      await insertLoanFineWaivers(String(selectedLoan.id), toWaive);
      setOverdueFines((prev) =>
        prev.map((f) => toWaive.includes(f.date) ? { ...f, waived: true } : f)
      );
      const removedValue = toWaive.length * DAILY_OVERDUE_FINE_BRL;
      toast.success(`R$ ${removedValue.toFixed(2)} removido (${toWaive.length} dia${toWaive.length > 1 ? "s" : ""})`);
      setMultaValor("");
      queryClient.invalidateQueries({ queryKey: ["fines"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover multa");
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
    const pixInfo = { tipo: pix.bank, titular: pix.holder, chave: pix.key };
    const overdueFine = loanRemaining?.overdueDailyFineOwed ?? 0;

    if (isUnaiCred && isWeeklyLoanProduct(selectedLoanProduct) && weeklyInstallments.length > 0) {
      const today = calendarDateInBrazil();
      const weeklyCtx = resolveUnaiWeeklyForCobranca(
        weeklyInstallments.map((w) => ({
          week_number: w.week_number,
          due_date: w.due_date,
          amount: w.amount,
          status: w.status,
        })),
        today,
        new Set<string>(),
      );
      if (!weeklyCtx) {
        toast.error("Nenhuma parcela semanal pendente para cobrança");
        return;
      }
      if (overdueFine > 0) weeklyCtx.fine = overdueFine;
      const loanForMsg = {
        client_name: String(selectedLoan.client_name),
        client_phone: phone,
        amount: weeklyCtx.weeks_amount_due + weeklyCtx.fine,
        capital: weeklyCtx.weeks_amount_due,
        interest: 0,
        fine: weeklyCtx.fine,
        due_date: weeklyCtx.primary_due_date,
        minimumPayment: weeklyCtx.weeks_amount_due,
        unai_weekly: weeklyCtx,
      };
      const msg = buildCobrancaMessage(loanForMsg, pixInfo, 50);
      const res = await sendWhatsAppMessage(phone, msg);
      if (res.via === "api") toast.success("Mensagem enviada");
      setWhatsappOpen(false);
      return;
    }

    const amt = Number(selectedLoan.amount ?? 0);
    const rate = Number(selectedLoan.interest_rate ?? 0);
    const capital = loanRemaining?.capital ?? amt;
    const interest = loanRemaining?.interestAmount ?? amt * (rate / 100);
    const baseRemaining = loanRemaining?.remainingAmount ?? amt + amt * (rate / 100);
    const loanForMsg = {
      client_name: String(selectedLoan.client_name),
      client_phone: phone,
      amount: baseRemaining + overdueFine,
      capital,
      interest,
      fine: overdueFine,
      due_date: String(selectedLoan.due_date),
      minimumPayment: loanRemaining?.minimumPayment ?? interest,
    };
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
      const guarantorsList = loan.client_id ? await fetchGuarantors(String(loan.client_id)) : [];
      const avalista = guarantorsList?.[0] as { name?: unknown; cpf?: unknown; rg?: unknown; address?: unknown } | undefined;

      const doc = generateContratoMutuoPdf({
        mutuario: {
          name: String((full as { client_name?: unknown }).client_name || loan.client_name || "—"),
          cpf: String((full as { client_cpf?: unknown }).client_cpf || ""),
          rg: String((full as { client_rg?: unknown }).client_rg || ""),
          address: String((full as { client_address?: unknown }).client_address || ""),
        },
        avalista: avalista?.name
          ? {
              name: String(avalista.name),
              cpf: String(avalista.cpf || ""),
              rg: String(avalista.rg || ""),
              address: String(avalista.address || ""),
            }
          : null,
        valorEmprestado: parseFloat(String(loan.amount || 0)),
        vencimento: String(loan.due_date || ""),
        multaPercent: 10,
        cidadeUf: "Franca",
        dataAssinatura: String(loan.loan_date || ""),
      });

      const displayClientName = safeFilePart(String((full as { client_name?: unknown }).client_name || loan.client_name || "cliente")) || "cliente";
      const loanDateYmd = String(loan.loan_date || "").split("T")[0];
      const fileName = `Contrato_${displayClientName}_${safeFilePart(loanDateYmd) || String(loan.id)}.pdf`;
      doc.save(fileName);
      toast.success("Contrato gerado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar contrato");
    }
  };

  const handlePDF = async (loan: LoanRow) => {
    try {
      const full = loanFull && String((loanFull as any)?.id) === String(loan.id) ? loanFull : await fetchLoanById(String(loan.id));
      const clientId = String((full as { client_id?: unknown }).client_id || loan.client_id || "").trim();
      const [guarantors, emergency, remaining] = await Promise.all([
        clientId ? fetchGuarantors(clientId) : Promise.resolve([]),
        clientId ? fetchEmergencyContacts(clientId) : Promise.resolve([]),
        calculateLoanRemaining(String(loan.id)),
      ]);

      const multaEmAberto = Number(remaining.overdueDailyFineOwed || 0);
      const multaPaga = Number(remaining.finesPaid || 0);
      const multaTotal = multaEmAberto + multaPaga;
      const capitalRestante = Number(remaining.capital || 0);
      const jurosRestante = Number(remaining.interestAmount || 0);
      const totalPago = Number(remaining.totalPaid || 0);
      const dividaAtual = Number(remaining.remainingAmount || 0) + multaEmAberto;

      const capitalAvista = capitalRestante;
      const parcelamentoBase = dividaAtual * 1.35;
      const parcelasTabela = buildParcelamentoOptions(parcelamentoBase);

      const doc = new jsPDF();
      const m = getPdfMargin();
      const clientName = String((full as { client_name?: unknown }).client_name || loan.client_name || "—");
      const cpf = String((full as { client_cpf?: unknown }).client_cpf || "-");
      const phone = String((full as { client_phone?: unknown }).client_phone || "").trim();
      const address = String((full as { client_address?: unknown }).client_address || "").trim();

      let pageNum = 1;
      // Cabeçalho simples (sem marca/gerado em/página)
      let y = 20;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("PDF de Cobrança", m, y);
      y += 10;

      const ensureSpace = (minY = 20) => {
        if (y <= 265) return;
        doc.addPage();
        pageNum++;
        y = minY;
      };

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Dados do cliente", m, y);
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text(`Nome: ${clientName}`, m, y, { maxWidth: 182 });
      y += 6.5;
      doc.text(`CPF: ${cpf}`, m, y);
      y += 6.5;
      doc.text(`Telefone: ${phone || "—"}`, m, y);
      y += 6.5;
      doc.text("Endereço:", m, y);
      y += 6;
      doc.setFontSize(10);
      doc.text(address || "—", m, y, { maxWidth: 182 });
      y += address ? 10 : 8;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Totais", m, y);
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text(`Multa total: ${formatCurrencyBrl(multaTotal)} (em aberto: ${formatCurrencyBrl(multaEmAberto)})`, m, y, { maxWidth: 182 });
      y += 6.5;
      doc.text(`Capital restante: ${formatCurrencyBrl(capitalRestante)}`, m, y);
      y += 6.5;
      doc.text(`Aluguel restante: ${formatCurrencyBrl(jurosRestante)}`, m, y);
      y += 6.5;
      doc.text(`Total já pago: ${formatCurrencyBrl(totalPago)}`, m, y);
      y += 8;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Opções de pagamento", m, y);
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);

      const drawCheck = (x: number, y0: number, checked: boolean) => {
        doc.rect(x, y0 - 3.5, 4, 4);
        if (checked) {
          doc.setFont("helvetica", "bold");
          doc.text("X", x + 1, y0 - 0.2);
          doc.setFont("helvetica", "normal");
        }
      };

      // à vista (capital)
      drawCheck(m, y, false);
      doc.text(`Capital à vista: ${formatCurrencyBrl(capitalAvista)}`, m + 7, y, { maxWidth: 182 });
      y += 7;

      // parcelamento +35%
      drawCheck(m, y, false);
      doc.text(`Parcelamento da dívida total (+35%): base ${formatCurrencyBrl(parcelamentoBase)} (até 12x)`, m + 7, y, { maxWidth: 182 });
      y += 7.5;

      // tabela parcelas
      ensureSpace();
      doc.setFont("helvetica", "bold");
      doc.text("Tabela de parcelas", m, y);
      y += 6;
      doc.setFont("helvetica", "normal");

      const colX = { mark: m, n: m + 8, val: m + 30 };
      doc.setFont("helvetica", "bold");
      doc.text("✓", colX.mark, y);
      doc.text("Parcelas", colX.n, y);
      doc.text("Valor da parcela", colX.val, y);
      doc.setFont("helvetica", "normal");
      y += 5.5;
      doc.setDrawColor(226, 232, 240);
      doc.line(m, y, 196, y);
      y += 4.5;

      for (const row of parcelasTabela) {
        ensureSpace();
        drawCheck(colX.mark, y, false);
        doc.text(`${row.n}x`, colX.n, y);
        doc.text(formatCurrencyBrl(row.parcela), colX.val, y);
        y += 5.8;
      }

      y += 4;

      // contatos
      ensureSpace();
      const allContactsCount = (guarantors?.length || 0) + (emergency?.length || 0);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(`Contatos para cobrança (${allContactsCount})`, m, y);
      y += 7;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);

      const rows: Array<{ type: "Avalista" | "Emergência"; name: string; phone: string; relationship?: string; cpf?: string }> = [];
      for (const g of guarantors as Array<{ name?: unknown; phone?: unknown; relationship?: unknown; cpf?: unknown }>) {
        rows.push({
          type: "Avalista",
          name: String(g.name || "—"),
          phone: String(g.phone || ""),
          relationship: String(g.relationship || ""),
          cpf: String(g.cpf || ""),
        });
      }
      for (const e of emergency as Array<{ name?: unknown; phone?: unknown; relationship?: unknown }>) {
        rows.push({
          type: "Emergência",
          name: String(e.name || "—"),
          phone: String(e.phone || ""),
          relationship: String(e.relationship || ""),
        });
      }

      if (rows.length === 0) {
        doc.setTextColor(100, 116, 139);
        doc.text("Nenhum avalista/contato de emergência cadastrado para este cliente.", m, y, { maxWidth: 182 });
        doc.setTextColor(30, 41, 59);
        y += 10;
      } else {
        for (const r of rows) {
          ensureSpace();
          doc.setFont("helvetica", "bold");
          doc.text(`${r.type}: ${r.name}`, m, y, { maxWidth: 182 });
          y += 5.5;
          doc.setFont("helvetica", "normal");
          const rel = r.relationship ? ` (${r.relationship})` : "";
          const phoneLine = `Telefone: ${String(r.phone || "—").trim() || "—"}${rel}`;
          doc.text(phoneLine, m, y, { maxWidth: 182 });
          y += 5.5;
          if (r.type === "Avalista" && r.cpf) {
            doc.text(`CPF: ${r.cpf}`, m, y, { maxWidth: 182 });
            y += 5.5;
          }
          doc.setDrawColor(226, 232, 240);
          doc.line(m, y, 196, y);
          y += 6;
        }
      }

      // assinatura no final
      ensureSpace();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Assinatura do cliente", m, y);
      y += 8;
      doc.setDrawColor(148, 163, 184);
      doc.line(m, y + 18, 196, y + 18);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text("Assinatura", m, y + 23);
      doc.setTextColor(30, 41, 59);
      y += 28;

      doc.save(`cobranca-${loan.id}.pdf`);
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

  const contactsExportText = useMemo(
    () =>
      loanClientContacts
        .map((c) => `${c.client_name}\t${c.client_phone || "—"}`)
        .join("\n"),
    [loanClientContacts],
  );

  const openContactsExport = async () => {
    setContactsExportOpen(true);
    setContactsExportLoading(true);
    setLoanClientContacts([]);
    try {
      const rows = await fetchLoanClientContacts();
      setLoanClientContacts(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar contatos");
      setContactsExportOpen(false);
    } finally {
      setContactsExportLoading(false);
    }
  };

  const copyLoanClientContacts = async () => {
    if (!loanClientContacts.length) return;
    const header = "Nome\tTelefone";
    try {
      await navigator.clipboard.writeText(`${header}\n${contactsExportText}`);
      toast.success(`${loanClientContacts.length} contato(s) copiado(s)`);
    } catch {
      toast.error("Não foi possível copiar para a área de transferência");
    }
  };

  const downloadLoanClientContacts = () => {
    if (!loanClientContacts.length) return;
    const header = "Nome\tTelefone\n";
    const blob = new Blob([header + contactsExportText + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contatos-emprestimos-${calendarDateInBrazil()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Arquivo baixado");
  };

  const handleMarkWeekPaid = async (row: LoanWeeklyInstallment) => {
    setMarkingWeeklyId(row.id);
    try {
      await markLoanWeeklyInstallmentPaid(row.id);
      await refetchWeeklyInstallments();
      toast.success(`${row.week_number}ª semana marcada como paga`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao marcar parcela");
    } finally {
      setMarkingWeeklyId(null);
    }
  };

  const selectedLoanProduct = String(
    (loanFull as { loan_product?: unknown } | null | undefined)?.loan_product ??
      (selectedLoan as { loan_product?: unknown } | null | undefined)?.loan_product ??
      "mensal",
  );

  /** Só tela cheia de loading na carga inicial; com busca, keepPreviousData mantém dados e o input não some. */
  if (!isParcelamentos && isLoading && data === undefined) {
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
              <SelectItem value="finalized">Finalizados</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            className="h-8 text-xs gap-1.5 shrink-0"
            onClick={() => setNotesSearchOpen(true)}
          >
            <StickyNote className="h-3.5 w-3.5" />
            Notas e observações
          </Button>
          {!isParcelamentos && (
            <Button
              type="button"
              variant="outline"
              className="h-8 text-xs gap-1.5 shrink-0"
              onClick={() => void openContactsExport()}
            >
              <Users className="h-3.5 w-3.5" />
              Contatos dos clientes
            </Button>
          )}
          {!isParcelamentos && (
            <Select
              value={loanSort}
              onValueChange={(v) => {
                setLoanSort(v as LoanSortOption);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-auto h-8 text-xs nexus-input min-w-[200px] max-w-[260px]">
                <SelectValue placeholder="Ordenar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Ordem padrão (prioridade)</SelectItem>
                <SelectItem value="due_date_asc">Vencimento · crescente</SelectItem>
                <SelectItem value="due_date_desc">Vencimento · decrescente</SelectItem>
                <SelectItem value="loan_date_asc">Contrato · crescente</SelectItem>
                <SelectItem value="loan_date_desc">Contrato · decrescente</SelectItem>
                <SelectItem value="created_at_asc">Cadastro · mais antigo</SelectItem>
                <SelectItem value="created_at_desc">Cadastro · mais recente</SelectItem>
              </SelectContent>
            </Select>
          )}
          {!isParcelamentos && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-muted-foreground">Período</Label>
                <Input
                  type="date"
                  className="h-8 text-xs nexus-input w-[140px]"
                  value={periodFrom}
                  onChange={(e) => {
                    setPeriodFrom(e.target.value);
                    setPage(1);
                  }}
                />
                <span className="text-xs text-muted-foreground">até</span>
                <Input
                  type="date"
                  className="h-8 text-xs nexus-input w-[140px]"
                  value={periodTo}
                  onChange={(e) => {
                    setPeriodTo(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              {(periodFrom || periodTo) && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => {
                    setPeriodFrom("");
                    setPeriodTo("");
                    setPage(1);
                  }}
                >
                  Limpar
                </Button>
              )}
            </div>
          )}
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
                              <span
                                className={`truncate max-w-[240px] ${
                                  isRenegotiatedClient(String(inst.client_id))
                                    ? "text-orange-600 dark:text-orange-400"
                                    : ""
                                }`}
                              >
                                {inst.client_name}
                              </span>
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
                                            <ScoreDot score={typeof score === "number" ? score : undefined} />
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
                      const isFinalized = loan.status === "finalized";

                      return (
                        <motion.tr
                          key={String(loan.id)}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.03 }}
                          className="border-b border-border/20 hover:bg-surface-hover transition-colors"
                        >
                          <td className="p-4 text-sm font-medium text-foreground">
                            <div className="flex flex-col gap-1 min-w-0">
                              <div className="relative inline-flex items-center pr-20 min-w-0">
                                <span
                                  className={`truncate max-w-[240px] ${
                                    isRenegotiatedClient(
                                      String((loan as { client_id?: string | number }).client_id || ""),
                                    )
                                      ? "text-orange-600 dark:text-orange-400"
                                      : ""
                                  }`}
                                >
                                  {String(loan.client_name)}
                                </span>
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
                                              <ScoreDot score={typeof score === "number" ? score : undefined} />
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
                              <div className="flex flex-row flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-semibold leading-tight">
                                <span className="text-red-600 dark:text-red-500 whitespace-nowrap">
                                  Multas = {formatCurrency(Number((loan as { total_fines_amount?: unknown }).total_fines_amount ?? 0))}
                                </span>
                                <span className="text-green-600 dark:text-green-500 whitespace-nowrap">
                                  Valor pago = {formatCurrency(Number((loan as { total_paid_amount?: unknown }).total_paid_amount ?? 0))}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-sm text-foreground">{formatCurrency(Number(loan.amount))}</td>
                          <td className="p-4 text-sm text-muted-foreground">{String(loan.interest_rate ?? "")}%</td>
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
                              ) : isFinalized ? (
                                <>
                                  <LoanActionButton icon={FileText} label="Contrato" onClick={() => handleContract(loan)} variant="document" />
                                  <LoanActionButton icon={FileDown} label="PDF" onClick={() => handlePDF(loan)} variant="pdf" />
                                  <LoanActionButton icon={Users} label="Contatos" onClick={() => openContacts(loan)} variant="contacts" />
                                </>
                              ) : (
                                <>
                                  <LoanActionButton icon={Pencil} label="Editar" onClick={() => openEdit(loan)} variant="edit" />
                                  <LoanActionButton icon={Wallet} label="Pagamentos" onClick={() => openPayments(loan)} variant="payment" />
                                  <LoanActionButton icon={MessageCircle} label="COBRANÇA" onClick={() => openWhatsapp(loan)} variant="whatsapp" />
                                  <LoanActionButton icon={CheckCircle} label="Quitar" onClick={() => openQuitar(loan)} variant="complete" />
                                  <LoanActionButton icon={Archive} label="Finalizar" onClick={() => openFinalize(loan)} variant="view" />
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

            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-3">
              <p className="text-xs font-semibold text-foreground">Vínculo com levantamento (opcional)</p>
              <div className="grid gap-2">
                <Label className="text-xs">Levantamento</Label>
                <Select
                  value={newLoanForm.capital_raise_id}
                  onValueChange={(v) =>
                    setNewLoanForm((f) => ({
                      ...f,
                      capital_raise_id: v === "__none__" ? "" : v,
                      capital_raise_capital: v ? f.capital_raise_capital : "",
                      capital_raise_interest: v ? f.capital_raise_interest : "",
                    }))
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Sem vínculo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem vínculo</SelectItem>
                    {activeCapitalRaises.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  O empréstimo continua normal. Esse vínculo só serve para acompanhar quitação do levantamento.
                </p>
              </div>

              {String(newLoanForm.capital_raise_id || "").trim() ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label className="text-xs">Capital (captação)</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={newLoanForm.capital_raise_capital}
                      onChange={(e) =>
                        setNewLoanForm((f) => ({
                          ...f,
                          capital_raise_capital: e.target.value.replace(/[^\d,.-]/g, ""),
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-xs">Juros (captação)</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={newLoanForm.capital_raise_interest}
                      onChange={(e) =>
                        setNewLoanForm((f) => ({
                          ...f,
                          capital_raise_interest: e.target.value.replace(/[^\d,.-]/g, ""),
                        }))
                      }
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label>{isUnaiCred ? "Tipo de empréstimo *" : "Prazo *"}</Label>
              {isUnaiCred ? (
                <Select
                  value={newLoanForm.loan_product}
                  onValueChange={(v: UnaiLoanProduct) => {
                    setNewLoanForm((f) => ({
                      ...f,
                      loan_product: v,
                      term_days: v === "20_dias" ? "20" : "30",
                      due_date: computeUnaiDueDate(v, f.loan_date),
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMPERATRIZ_LOAN_PRODUCT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
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
              )}
              {isUnaiCred ? (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {IMPERATRIZ_LOAN_PRODUCT_OPTIONS.find((o) => o.id === newLoanForm.loan_product)?.description}
                </p>
              ) : null}
            </div>
            {isUnaiCred && newLoanWeeklyPreview.length > 0 ? (
              <div className="rounded-lg border bg-muted/20 p-3">
                <LoanWeeklyInstallmentsTable rows={newLoanWeeklyPreview} />
              </div>
            ) : null}
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
                      due_date: isUnaiCred
                        ? computeUnaiDueDate(f.loan_product, v)
                        : computeDueDate(v, parseInt(f.term_days) as 20 | 30),
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
                  <SelectItem value="finalized">Finalizado</SelectItem>
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

      {/* Modal Finalizar empréstimo */}
      <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Finalizar empréstimo</DialogTitle>
            <DialogDescription>
              O contrato deixa de aparecer em Todos, Ativos e Vencidos. Os pagamentos já registrados permanecem no histórico do cliente (menu Histórico).
              {selectedLoan ? ` Cliente: ${String(selectedLoan.client_name)}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setFinalizeOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleFinalizeSubmit} disabled={isSubmitting}>
              {isSubmitting ? "Processando..." : "Confirmar finalização"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={notesSearchOpen}
        onOpenChange={(open) => {
          setNotesSearchOpen(open);
          if (!open) {
            setNotesSearchPayments([]);
            setNotesSearchPaidLoans([]);
            setNotesSearchHasRun(false);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[92vh] flex flex-col gap-4 overflow-hidden sm:max-w-lg">
          <DialogHeader className="shrink-0 space-y-1.5 text-left">
            <DialogTitle>Buscar notas e observações</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 shrink-0">
            <div className="space-y-1.5">
              <Label className="text-xs">Onde buscar</Label>
              <Select
                value={notesSearchScope}
                onValueChange={(v) => setNotesSearchScope(v as LoanNotesSearchScope)}
              >
                <SelectTrigger className="h-9 text-xs nexus-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Pagamentos e quitações</SelectItem>
                  <SelectItem value="payments">Somente pagamentos</SelectItem>
                  <SelectItem value="paid_loans">Somente quitações (histórico quitado)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Termo</Label>
              <div className="flex gap-2">
                <Input
                  className="h-9 text-xs nexus-input flex-1"
                  placeholder="Ex.: PIX, renovação, multa..."
                  value={notesSearchTerm}
                  onChange={(e) => setNotesSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runNotesSearch();
                  }}
                />
                <Button
                  type="button"
                  className="h-9 text-xs shrink-0"
                  disabled={notesSearchLoading}
                  onClick={() => void runNotesSearch()}
                >
                  {notesSearchLoading ? "…" : "Buscar"}
                </Button>
              </div>
            </div>
          </div>
          <ScrollArea className="h-[min(520px,calc(92vh-260px))] min-h-[200px] w-full shrink-0 rounded-md border border-border/40 pr-3">
            <div className="space-y-4 p-3 pr-1">
              {(notesSearchScope === "all" || notesSearchScope === "payments") &&
                notesSearchPayments.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Pagamentos ({notesSearchPayments.length})
                    </p>
                    <ul className="space-y-2">
                      {notesSearchPayments.map((row) => (
                        <li
                          key={row.id}
                          className="rounded-lg border border-border/40 bg-muted/20 p-3 text-sm"
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <Badge variant="secondary" className="text-[10px]">
                              Pagamento
                            </Badge>
                            <span className="font-medium text-foreground">
                              {row.client_name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(row.payment_date)} · {formatCurrency(row.amount)}
                            </span>
                          </div>
                          <p className="text-foreground/90 whitespace-pre-wrap break-words">{row.notes}</p>
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 text-xs mt-2"
                            onClick={() => void openLoanFromNotesSearch(row.loan_id)}
                          >
                            Abrir empréstimo
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              {(notesSearchScope === "all" || notesSearchScope === "paid_loans") &&
                notesSearchPaidLoans.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Quitações ({notesSearchPaidLoans.length})
                    </p>
                    <ul className="space-y-2">
                      {notesSearchPaidLoans.map((row) => (
                        <li
                          key={row.id}
                          className="rounded-lg border border-border/40 bg-muted/20 p-3 text-sm"
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-[10px]">
                              Quitação
                            </Badge>
                            <span className="font-medium text-foreground">
                              {row.client_name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(row.paid_date)} · {formatCurrency(row.original_amount)}
                            </span>
                          </div>
                          <p className="text-foreground/90 whitespace-pre-wrap break-words">{row.notes}</p>
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 text-xs mt-2"
                            onClick={() => void openLoanFromNotesSearch(row.loan_id)}
                          >
                            Abrir empréstimo
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              {notesSearchHasRun &&
                !notesSearchLoading &&
                notesSearchPayments.length === 0 &&
                notesSearchPaidLoans.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Nenhuma observação encontrada para este termo.
                  </p>
                )}
            </div>
          </ScrollArea>
          <DialogFooter className="shrink-0 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setNotesSearchOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Ver Detalhes do Empréstimo */}
      <Dialog
        open={viewDetailsOpen}
        onOpenChange={(open) => {
          setViewDetailsOpen(open);
          if (!open) {
            setPaymentDetailOpen(false);
            setPaymentDetailRow(null);
          }
        }}
      >
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
                  <div>
                    <span className="text-muted-foreground">Nome:</span>{" "}
                    <span className="font-medium">
                      {String((loanFull as { client_name?: unknown } | null | undefined)?.client_name ?? selectedLoan.client_name ?? "—")}
                    </span>
                  </div>
                  <div><span className="text-muted-foreground">CPF:</span> {String((loanFull as { client_cpf?: unknown } | null | undefined)?.client_cpf ?? selectedLoan.client_cpf ?? "—")}</div>
                  <div><span className="text-muted-foreground">Telefone:</span> {String((loanFull as { client_phone?: unknown } | null | undefined)?.client_phone ?? selectedLoan.client_phone ?? "—")}</div>
                  <div><span className="text-muted-foreground">E-mail:</span> {String((loanFull as { client_email?: unknown } | null | undefined)?.client_email ?? selectedLoan.client_email ?? "—")}</div>
                  <div className="md:col-span-2"><span className="text-muted-foreground">Endereço:</span> {String((loanFull as { client_address?: unknown } | null | undefined)?.client_address ?? "—")}</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                    <p className="text-xs font-semibold text-foreground mb-2">Avalistas</p>
                    {(detailsGuarantors as any[]).length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum avalista cadastrado.</p>
                    ) : (
                      <div className="space-y-2">
                        {(detailsGuarantors as any[]).map((g: any) => (
                          <div key={String(g.id)} className="text-xs">
                            <p className="font-medium text-foreground">{String(g.name || "—")}</p>
                            <p className="text-muted-foreground">Tel: {String(g.phone || "—")}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                    <p className="text-xs font-semibold text-foreground mb-2">Contatos de emergência</p>
                    {(detailsEmergency as any[]).length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum contato de emergência cadastrado.</p>
                    ) : (
                      <div className="space-y-2">
                        {(detailsEmergency as any[]).map((c: any) => (
                          <div key={String(c.id)} className="text-xs">
                            <p className="font-medium text-foreground">{String(c.name || "—")}</p>
                            <p className="text-muted-foreground">
                              Tel: {String(c.phone || "—")} {c.relationship ? `· ${String(c.relationship)}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* Valores e datas */}
              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="font-semibold text-foreground mb-3">Empréstimo</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Valor original:</span> <span className="font-semibold">{formatCurrency(Number(selectedLoan.amount ?? 0))}</span></div>
                  <div><span className="text-muted-foreground">Juros:</span> {String(selectedLoan.interest_rate ?? "")}%</div>
                  {isUnaiCred ? (
                    <div>
                      <span className="text-muted-foreground">Tipo:</span>{" "}
                      <span className="font-medium">{unaiLoanProductLabel(selectedLoanProduct)}</span>
                    </div>
                  ) : null}
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
                        <div>
                          <span className="text-muted-foreground">Valor restante:</span>{" "}
                          <span className="font-semibold">
                            {selectedLoan.status === "paid"
                              ? formatCurrency(0)
                              : selectedLoan.status === "installments"
                                ? "— (cobrança no parcelamento)"
                                : loanRemaining
                                  ? formatCurrency(loanRemaining.remainingAmount)
                                  : typeof selectedLoan.remaining_amount === "number"
                                    ? formatCurrency(selectedLoan.remaining_amount)
                                    : "—"}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
              {isUnaiCred &&
              (isWeeklyLoanProduct(selectedLoanProduct) || weeklyInstallments.length > 0) ? (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <LoanWeeklyInstallmentsTable
                    rows={weeklyInstallments}
                    onMarkPaid={(row) => void handleMarkWeekPaid(row)}
                    markingId={markingWeeklyId}
                  />
                </div>
              ) : null}
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
                          · {String(tag.created_by_name)}
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
                        {loanPayments.map((p: { id?: unknown; payment_date?: unknown; created_at?: unknown; amount?: unknown; fine_amount?: unknown; payment_type?: unknown; notes?: unknown }) => (
                          <tr
                            key={String(p.id ?? "")}
                            role="button"
                            tabIndex={0}
                            className="border-b border-border/30 cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => openPaymentDetail(p)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openPaymentDetail(p);
                              }
                            }}
                          >
                            <td className="py-2">{formatDate(String(p.payment_date || p.created_at || ""))}</td>
                            <td>{formatCurrency(parseFloat(String(p.amount || 0)))}</td>
                            <td>{p.fine_amount ? formatCurrency(parseFloat(String(p.fine_amount))) : "—"}</td>
                            <td className="text-muted-foreground">{paymentTypeLabel(String(p.payment_type || ""))}</td>
                            <td className="py-2 text-right">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleDeletePayment(String(p.id || ""));
                                    }}
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

      <Dialog
        open={paymentDetailOpen}
        onOpenChange={(open) => {
          setPaymentDetailOpen(open);
          if (!open) setPaymentDetailRow(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Detalhes do pagamento</DialogTitle>
            <DialogDescription>
              {selectedLoan ? String(selectedLoan.client_name) : "—"}
            </DialogDescription>
          </DialogHeader>
          {paymentDetailRow ? (
            <div className="space-y-4 py-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Data do pagamento</p>
                <p className="font-medium text-foreground mt-0.5">{formatDate(paymentDetailRow.payment_date)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Registrado em (data e hora)</p>
                <p className="font-medium text-foreground mt-0.5">
                  {paymentDetailRow.created_at ? formatDateTimePt(paymentDetailRow.created_at) : "—"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Valor</p>
                  <p className="font-medium text-foreground mt-0.5">{formatCurrency(paymentDetailRow.amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Multa</p>
                  <p className="font-medium text-foreground mt-0.5">
                    {paymentDetailRow.fine_amount ? formatCurrency(paymentDetailRow.fine_amount) : "—"}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tipo</p>
                <p className="font-medium text-foreground mt-0.5">{paymentTypeLabel(paymentDetailRow.payment_type)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Observação</p>
                <p className="mt-1.5 rounded-md border border-border/60 bg-background px-3 py-2 text-foreground whitespace-pre-wrap break-words min-h-[3rem]">
                  {paymentDetailRow.notes.trim() ? paymentDetailRow.notes : "—"}
                </p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPaymentDetailOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
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
                  {loanRemaining.overdueDailyFineOwed > 0 ? (
                    <div className="flex justify-between text-destructive">
                      <span>Multa diária (atraso)</span>
                      <span>{formatCurrency(loanRemaining.overdueDailyFineOwed)}</span>
                    </div>
                  ) : null}
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
                <Label>Multa no pagamento (opcional)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={paymentForm.fine_amount}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, fine_amount: e.target.value.replace(/[^\d,.-]/g, "") }))
                  }
                />
                {loanRemaining && loanRemaining.overdueDailyFineOwed > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Multa diária de atraso calculada: {formatCurrency(loanRemaining.overdueDailyFineOwed)}. Você pode
                    anular dias ao continuar o registro. O valor acima é o que entra neste pagamento (comprovante /
                    histórico), além das anulações.
                  </p>
                ) : null}
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

      <PaymentFineWaiveDialog
        open={fineWaiveOpen}
        onOpenChange={(o) => {
          if (!o) setPendingRenewalOption(null);
          setFineWaiveOpen(o);
        }}
        loanId={selectedLoan?.id ? String(selectedLoan.id) : null}
        dueDateYmd={selectedLoan?.due_date ? String(selectedLoan.due_date).split("T")[0] : ""}
        submitting={isSubmitting}
        onContinue={async (waiveDates) => {
          const opt = pendingRenewalOption;
          if (!opt) return;
          setFineWaiveOpen(false);
          setPendingRenewalOption(null);
          await proceedRenewalAfterFineModal(opt, waiveDates);
        }}
      />

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
              className="w-full justify-start h-auto py-3 border-amber-500/30 hover:bg-amber-500/10"
              onClick={() => handleRenewalPayment("quitacao_total")}
              disabled={isSubmitting}
            >
              <span className="text-left">
                <strong>Quitação total</strong>
                <br />
                <span className="text-muted-foreground text-xs">
                  QUITAR o empréstimo agora (marca como quitado + comprovante)
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-3"
              onClick={() => handleRenewalPayment("capital_interest_renewal")}
              disabled={isSubmitting}
            >
              <span className="text-left">
                <strong>Capital + Aluguel</strong>
                <br />
                <span className="text-muted-foreground text-xs">
                  RENOVAÇÃO +{renewalDays} DIAS - Capital + Aluguel
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
                <strong>Somente Aluguel</strong>
                <br />
                <span className="text-muted-foreground text-xs">
                  RENOVAÇÃO +{renewalDays} DIAS - Somente Aluguel
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
                  {comprovanteData.quitado
                    ? " Empréstimo quitado."
                    : <> Próximo vencimento: {formatDate(comprovanteData.proximoVencimento)}.</>}
                  O PDF oficial com marca d&apos;água será baixado e enviado como anexo no WhatsApp (se a
                  instância estiver conectada).
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {comprovanteData && (
            <div className="space-y-4 py-2">
              {comprovanteData.clientId && comprovanteScoreLoading && (
                <p className="text-xs text-muted-foreground">Atualizando score do cliente…</p>
              )}
              {comprovanteRemainingLoading && !comprovanteData.quitado && (
                <p className="text-xs text-muted-foreground">Calculando saldo do empréstimo…</p>
              )}
              <div className="rounded-lg border border-border/50 bg-muted/30 p-4 text-sm">
                <p className="font-medium text-foreground mb-2">Colinha (legenda do PDF + mensagem):</p>
                <p className="text-muted-foreground whitespace-pre-wrap text-xs">
                  {buildComprovanteMessage(
                    comprovanteData.clientName,
                    comprovanteData.valorPago,
                    comprovanteData.proximoVencimento,
                    comprovanteScore
                      ? { score: comprovanteScore.score, label: comprovanteScore.label }
                      : null,
                    {
                      quitado: Boolean(comprovanteData.quitado),
                      remaining:
                        !comprovanteData.quitado && comprovanteRemaining
                          ? {
                              totalRestante: comprovanteRemaining.remainingAmount || 0,
                              capitalRestante: comprovanteRemaining.capital || 0,
                              jurosRestante: comprovanteRemaining.interestAmount || 0,
                              pagamentoMinimo: comprovanteRemaining.minimumPayment || 0,
                            }
                          : null,
                    },
                  )}
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setComprovanteOpen(false)}>
                  Fechar
                </Button>
                <Button
                  className="gap-2 bg-[#25D366] hover:bg-[#20BD5A]"
                  disabled={!comprovanteData.clientPhone || comprovanteSending}
                  onClick={async () => {
                    if (!comprovanteData?.clientPhone) {
                      toast.error("Cliente sem telefone cadastrado");
                      return;
                    }
                    setComprovanteSending(true);
                    try {
                      let scoreForSend = comprovanteScore;
                      if (comprovanteData.clientId) {
                        scoreForSend = await queryClient.fetchQuery({
                          queryKey: ["client-score", comprovanteData.clientId],
                          queryFn: () => fetchClientScore(comprovanteData.clientId),
                        });
                      }
                      const scoreInfo =
                        scoreForSend != null
                          ? { score: scoreForSend.score, label: scoreForSend.label }
                          : null;
                      const companyTitle = String(companyName || "").trim() || undefined;
                      // Para incluir saldo no texto do comprovante (sem enviar segunda mensagem).
                      let remainingInfo:
                        | { totalRestante: number; capitalRestante: number; jurosRestante: number; pagamentoMinimo: number }
                        | null = null;
                      if (!comprovanteData.quitado) {
                        try {
                          const remaining = await calculateLoanRemaining(comprovanteData.loanId);
                          remainingInfo = {
                            totalRestante: remaining.remainingAmount || 0,
                            capitalRestante: remaining.capital || 0,
                            jurosRestante: remaining.interestAmount || 0,
                            pagamentoMinimo: remaining.minimumPayment || 0,
                          };
                        } catch {
                          remainingInfo = null;
                        }
                      }
                      const colinha = buildComprovanteMessage(
                        comprovanteData.clientName,
                        comprovanteData.valorPago,
                        comprovanteData.proximoVencimento,
                        scoreInfo,
                        { quitado: Boolean(comprovanteData.quitado), remaining: remainingInfo },
                      );
                      const doc = generateComprovantePagamentoPdf({
                        clientName: comprovanteData.clientName,
                        valorPago: comprovanteData.valorPago,
                        proximoVencimento: comprovanteData.proximoVencimento,
                        paymentDate: comprovanteData.paymentDate,
                        paymentDescription: comprovanteData.paymentDescription,
                        loanId: comprovanteData.loanId,
                        score: scoreInfo?.score,
                        scoreLabel: scoreInfo?.label,
                        companyTitle,
                        quitado: Boolean(comprovanteData.quitado),
                      });
                      const fileName = `comprovante-${comprovanteData.loanId.slice(0, 8)}-${comprovanteData.paymentDate}.pdf`;
                      doc.save(fileName);
                      const b64 = comprovantePdfToBase64(doc);
                      // Mantém a legenda do PDF enxuta; a colinha de saldo vai como msg separada quando via API.
                      const res = await sendWhatsAppComprovante(comprovanteData.clientPhone, colinha, b64, fileName);
                      if (res.via === "api") toast.success("PDF e mensagem enviados pelo WhatsApp");
                      else toast.success("PDF baixado. Abra o WhatsApp e anexe o arquivo se necessário.");
                      setComprovanteOpen(false);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Erro ao gerar ou enviar comprovante");
                    } finally {
                      setComprovanteSending(false);
                    }
                  }}
                >
                  <MessageCircle className="h-4 w-4" />
                  {comprovanteSending ? "Enviando..." : "Baixar PDF e enviar WhatsApp"}
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Multas</DialogTitle>
            <DialogDescription>
              Multas de {selectedLoan && String(selectedLoan.client_name)}
            </DialogDescription>
          </DialogHeader>

          {loadingFines ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <div className="space-y-4">
              {/* Multas automáticas (R$50/dia de atraso) */}
              {overdueFines.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Multas de atraso (R$ {DAILY_OVERDUE_FINE_BRL}/dia)</Label>
                    <Badge variant="secondary" className="text-xs">
                      Total: R$ {(overdueFines.filter((f) => !f.waived).length * DAILY_OVERDUE_FINE_BRL).toFixed(2)}
                    </Badge>
                  </div>
                  <ScrollArea className="max-h-[180px]">
                    <div className="space-y-1">
                      {overdueFines.map((fine) => (
                        <div
                          key={fine.date}
                          className={`flex items-center justify-between rounded-md border px-3 py-1.5 ${fine.waived ? "opacity-50 bg-muted" : ""}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              R$ {DAILY_OVERDUE_FINE_BRL.toFixed(2)}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {new Date(fine.date + "T12:00:00").toLocaleDateString("pt-BR")}
                            </Badge>
                            {fine.waived && (
                              <Badge variant="secondary" className="text-xs text-muted-foreground">
                                Anulada
                              </Badge>
                            )}
                          </div>
                          {!fine.waived && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => handleWaiveOverdueFine(fine.date)}
                              disabled={isSubmitting}
                              title="Anular multa deste dia"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Multas manuais */}
              {clientFines.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Multas manuais</Label>
                  <ScrollArea className="max-h-[150px]">
                    <div className="space-y-1">
                      {clientFines.map((fine) => (
                        <div
                          key={fine.id}
                          className="flex items-center justify-between rounded-md border px-3 py-1.5"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">
                                R$ {fine.amount.toFixed(2)}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {new Date(fine.created_at).toLocaleDateString("pt-BR")}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {fine.reason}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteFine(fine.id)}
                            disabled={isSubmitting}
                            title="Excluir multa"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Input para adicionar ou remover valor */}
              <div className="border-t pt-4 space-y-2">
                <Label className="text-sm font-medium">Adicionar / Remover valor</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={multaValor}
                    onChange={(e) => setMultaValor(e.target.value)}
                    placeholder="Valor (R$)"
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={handleAddMultaValor}
                    disabled={isSubmitting || !multaValor}
                  >
                    Adicionar
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleRemoveMultaValor}
                    disabled={isSubmitting || !multaValor}
                  >
                    Remover
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Adicionar cria uma multa manual. Remover anula dias de atraso equivalentes ao valor.
                </p>
              </div>

            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMultaOpen(false)}>
              Fechar
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
                      <span>
                        {g.name} - {g.phone}
                        {g.relationship ? ` · ${g.relationship}` : ""}
                      </span>
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
                      <span>
                        {e.name} - {e.phone}
                        {e.relationship ? ` · ${e.relationship}` : ""}
                      </span>
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
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm">Etiquetas existentes</Label>
                <span className="text-[11px] text-muted-foreground">
                  {tagDialogTagsLoading ? "Carregando..." : `${(tagDialogTags as ClientTagRow[]).length} etiqueta(s)`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-2">
                {!tagDialogTagsLoading && (tagDialogTags as ClientTagRow[]).length === 0 ? (
                  <span className="text-[11px] text-muted-foreground px-1">Nenhuma etiqueta cadastrada.</span>
                ) : (
                  (tagDialogTags as ClientTagRow[]).map((tag) => (
                    <span
                      key={tag.id}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${tagColorClasses(tag.color)}`}
                      title={tag.created_by_name ? `${tag.text} · ${tag.created_by_name}` : tag.text}
                    >
                      <span className="max-w-[240px] truncate">{tag.text}</span>
                      <button
                        type="button"
                        className="ml-0.5 text-xs text-muted-foreground hover:text-destructive"
                        aria-label="Remover etiqueta"
                        onClick={() => deleteTagMutation.mutate({ id: tag.id })}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>
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

      <Dialog open={contactsExportOpen} onOpenChange={setContactsExportOpen}>
        <DialogContent className="w-[min(96vw,36rem)] sm:max-w-none max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Contatos dos clientes com empréstimo</DialogTitle>
            <DialogDescription>
              Nome e celular de todos os clientes com empréstimo ativo, vencido ou parcialmente pago.
            </DialogDescription>
          </DialogHeader>
          {contactsExportLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Carregando contatos...</p>
          ) : loanClientContacts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nenhum cliente com empréstimo ativo.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{loanClientContacts.length} cliente(s) único(s)</p>
              <ScrollArea className="h-[min(360px,50vh)] rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/90 backdrop-blur">
                    <tr className="border-b">
                      <th className="text-left p-2 font-semibold">Nome</th>
                      <th className="text-left p-2 font-semibold">Celular</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loanClientContacts.map((c) => (
                      <tr key={c.client_id} className="border-b border-border/40">
                        <td className="p-2 font-medium">{c.client_name}</td>
                        <td className="p-2 tabular-nums">{c.client_phone || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          )}
          <DialogFooter className="flex flex-wrap gap-2 sm:space-x-0">
            <Button variant="outline" onClick={() => setContactsExportOpen(false)}>
              Fechar
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={!loanClientContacts.length || contactsExportLoading}
              onClick={() => void copyLoanClientContacts()}
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar lista
            </Button>
            <Button
              className="gap-1.5"
              disabled={!loanClientContacts.length || contactsExportLoading}
              onClick={downloadLoanClientContacts}
            >
              <FileDown className="h-3.5 w-3.5" />
              Baixar TXT
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
