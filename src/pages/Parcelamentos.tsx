import {
  Plus,
  Search,
  Eye,
  MessageCircle,
  XCircle,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchInstallments,
  fetchInstallmentById,
  createInstallment,
  recordInstallmentPayment,
  cancelInstallment,
  type InstallmentRow,
} from "@/api/installments";
import { fetchClientsForSelect } from "@/api/clients";
import { fetchClientLoansForParcelamentoLink } from "@/api/loans";
import { fetchPixKeys } from "@/api/pix-keys";
import { sendWhatsAppMessage } from "@/api/evolution";
import { useState, useMemo } from "react";
import { toast } from "sonner";

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(s: string) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

function toInputDate(s: string) {
  return String(s).split("T")[0];
}

export default function Parcelamentos() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [newOpen, setNewOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [newClientSearch, setNewClientSearch] = useState("");
  const [form, setForm] = useState({
    client_id: "",
    total_amount: "",
    total_installments: "",
    interest_rate: "0",
    first_due_date: toInputDate(new Date().toISOString()),
    notes: "",
    link_loan: false,
    loan_id: "",
  });
  const [paymentForm, setPaymentForm] = useState({
    paid_amount: "",
    paid_date: toInputDate(new Date().toISOString()),
    payment_method: "pix",
    notes: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const { data: installments = [], isLoading, error } = useQuery({
    queryKey: ["installments"],
    queryFn: fetchInstallments,
  });

  const { data: clientsForSelect = [] } = useQuery({
    queryKey: ["clients-for-select"],
    queryFn: fetchClientsForSelect,
    enabled: newOpen,
  });

  const { data: loansForLink = [], isLoading: loadingLoansForLink } = useQuery({
    queryKey: ["client-loans-parcelamento", form.client_id],
    queryFn: () => fetchClientLoansForParcelamentoLink(form.client_id),
    enabled: newOpen && !!form.client_id && form.link_loan,
  });

  const { data: installmentFull, isLoading: loadingDetails } = useQuery({
    queryKey: ["installment-details", selectedId],
    queryFn: () => fetchInstallmentById(selectedId!),
    enabled: !!selectedId && detailsOpen,
  });

  const { data: pixKeys = [] } = useQuery({
    queryKey: ["pix-keys"],
    queryFn: fetchPixKeys,
  });

  const filtered = useMemo(() => {
    let list = installments;
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(
        (i) =>
          String(i.client_name).toLowerCase().includes(term) ||
          String(i.total_amount).includes(term) ||
          String(i.total_installments).includes(term)
      );
    }
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "client_name") {
        cmp = String(a.client_name).localeCompare(String(b.client_name));
      } else if (sortBy === "total_amount") {
        cmp = a.total_amount - b.total_amount;
      } else if (sortBy === "created_at") {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else if (sortBy === "next_due") {
        const aNext = (a.installment_payments || []).find((p) => p.status === "pending");
        const bNext = (b.installment_payments || []).find((p) => p.status === "pending");
        const aT = aNext ? new Date(aNext.due_date).getTime() : 0;
        const bT = bNext ? new Date(bNext.due_date).getTime() : 0;
        cmp = aT - bT;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return list;
  }, [installments, search, sortBy, sortOrder]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(String(form.total_amount).replace(",", "."));
    const n = parseInt(String(form.total_installments), 10);
    const rate = parseFloat(String(form.interest_rate).replace(",", ".")) || 0;
    if (!form.client_id || isNaN(amt) || amt <= 0 || isNaN(n) || n < 2 || !form.first_due_date) {
      toast.error("Preencha cliente, valor total, número de parcelas e primeira data de vencimento");
      return;
    }
    if (form.link_loan) {
      if (!form.loan_id) {
        toast.error("Selecione o empréstimo a vincular ou desmarque a opção");
        return;
      }
    }
    let installmentAmount = amt / n;
    if (rate > 0) {
      const monthlyRate = rate / 100;
      const factor = Math.pow(1 + monthlyRate, n);
      installmentAmount = (amt * (monthlyRate * factor)) / (factor - 1);
    }
    setIsSubmitting(true);
    try {
      await createInstallment({
        client_id: form.client_id,
        total_amount: amt,
        total_installments: n,
        installment_amount: Math.round(installmentAmount * 100) / 100,
        first_due_date: form.first_due_date,
        interest_rate: rate,
        notes: form.notes.trim() || undefined,
        loan_id: form.link_loan && form.loan_id ? form.loan_id : null,
      });
      toast.success("Parcelamento criado");
      setNewOpen(false);
      setForm({
        client_id: "",
        total_amount: "",
        total_installments: "",
        interest_rate: "0",
        first_due_date: toInputDate(new Date().toISOString()),
        notes: "",
        link_loan: false,
        loan_id: "",
      });
      queryClient.invalidateQueries({ queryKey: ["installments"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar parcelamento");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDetails = (id: string) => {
    setSelectedId(id);
    setDetailsOpen(true);
  };

  const openPayment = (paymentId: string, amount: number) => {
    setSelectedPaymentId(paymentId);
    setPaymentForm({
      paid_amount: String(amount.toFixed(2)),
      paid_date: toInputDate(new Date().toISOString()),
      payment_method: "pix",
      notes: "",
    });
    setPaymentOpen(true);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPaymentId || !paymentForm.paid_amount || !paymentForm.paid_date) {
      toast.error("Preencha valor e data");
      return;
    }
    const amt = parseFloat(String(paymentForm.paid_amount).replace(",", "."));
    if (isNaN(amt) || amt <= 0) {
      toast.error("Valor inválido");
      return;
    }
    if (!["pix", "dinheiro"].includes(paymentForm.payment_method)) {
      toast.error("Método de pagamento: PIX ou Dinheiro");
      return;
    }
    setIsSubmitting(true);
    try {
      await recordInstallmentPayment(selectedPaymentId, {
        paid_amount: amt,
        paid_date: paymentForm.paid_date,
        payment_method: paymentForm.payment_method,
        notes: paymentForm.notes.trim() || undefined,
      });
      toast.success("Pagamento registrado");
      setPaymentOpen(false);
      setSelectedPaymentId(null);
      queryClient.invalidateQueries({ queryKey: ["installments"] });
      if (selectedId) {
        queryClient.invalidateQueries({ queryKey: ["installment-details", selectedId] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar pagamento");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm("Tem certeza que deseja cancelar este parcelamento?")) return;
    try {
      await cancelInstallment(id);
      toast.success("Parcelamento cancelado");
      setDetailsOpen(false);
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ["installments"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cancelar");
    }
  };

  const handleWhatsApp = async (inst: InstallmentRow) => {
    const unpaid = (inst.installment_payments || []).filter((p) => p.status === "pending");
    const next = unpaid[0];
    const amt = inst.installment_amount;
    const pix = pixKeys.length > 0 ? (pixKeys as Array<{ bank: string; key: string; holder: string }>)[0] : null;
    let msg = `Olá ${inst.client_name}, lembrete de parcelamento.\n\nValor da parcela: ${formatCurrency(amt)}`;
    if (next) msg += `\nPróximo vencimento: ${formatDate(next.due_date)}`;
    if (pix) msg += `\n\nChave PIX (${pix.bank} - ${pix.holder}):\n${pix.key}`;
    const phone = (inst.client_phone || "").trim();
    if (!phone) {
      toast.error("Cliente sem telefone cadastrado");
      return;
    }
    const res = await sendWhatsAppMessage(phone, msg);
    if (res.via === "api") toast.success("Mensagem enviada");
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Parcelamentos</h1>
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
          <h1 className="text-xl font-bold">Parcelamentos</h1>
          <p className="text-sm text-destructive">
            Erro ao carregar. Verifique se as tabelas installments e installment_payments existem.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Parcelamento</h1>
          <p className="text-sm text-muted-foreground">Gerencie parcelamentos ativos e crie novos acordos</p>
        </div>
        <Button onClick={() => { setNewClientSearch(""); setNewOpen(true); }} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
          <Plus className="h-4 w-4" />
          Criar Parcelamento
        </Button>
      </div>

      <div className="glass-card">
        <div className="p-4 border-b border-border/30 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente, valor..."
              className="pl-8 h-8 text-xs nexus-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-auto h-8 text-xs nexus-input max-w-[140px]">
              <SelectValue placeholder="Ordenar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">Data criação</SelectItem>
              <SelectItem value="client_name">Cliente</SelectItem>
              <SelectItem value="total_amount">Valor total</SelectItem>
              <SelectItem value="next_due">Próximo vencimento</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as "asc" | "desc")}>
            <SelectTrigger className="w-auto h-8 text-xs nexus-input max-w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Crescente</SelectItem>
              <SelectItem value="desc">Decrescente</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase p-4">Cliente</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase p-4">Valor Total</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase p-4">Progresso</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase p-4 hidden md:table-cell">Valor Parcela</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase p-4 hidden md:table-cell">Próximo Vencimento</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase p-4">Status</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase p-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Nenhum parcelamento ativo encontrado
                  </td>
                </tr>
              ) : (
                filtered.map((inst: InstallmentRow, i: number) => {
                  const unpaid = (inst.installment_payments || []).filter((p) => p.status === "pending");
                  const paidCount = (inst.installment_payments || []).filter((p) => p.status === "paid").length;
                  const nextDue = unpaid[0] ? formatDate(unpaid[0].due_date) : "Todas pagas";
                  const progress = `${paidCount}/${inst.total_installments}`;
                  return (
                    <motion.tr
                      key={inst.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="border-b border-border/20 hover:bg-surface-hover"
                    >
                      <td className="p-4 text-sm font-medium">{inst.client_name}</td>
                      <td className="p-4 text-sm">{formatCurrency(inst.total_amount)}</td>
                      <td className="p-4 text-sm">{progress}</td>
                      <td className="p-4 text-sm hidden md:table-cell">{formatCurrency(inst.installment_amount)}</td>
                      <td className="p-4 text-sm hidden md:table-cell">{nextDue}</td>
                      <td className="p-4">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
                          {inst.status === "completed" ? "Concluído" : "Ativo"}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1 flex-wrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => openDetails(inst.id)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Detalhes
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => handleWhatsApp(inst)}
                          >
                            <MessageCircle className="h-3.5 w-3.5 mr-1" />
                            WhatsApp
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => handleCancel(inst.id)}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Cancelar
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Novo Parcelamento */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Criar Parcelamento</DialogTitle>
            <DialogDescription>Cadastre um novo parcelamento para um cliente</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar cliente por nome..."
                  className="pl-8"
                  value={newClientSearch}
                  onChange={(e) => setNewClientSearch(e.target.value)}
                />
              </div>
              <Select
                value={form.client_id}
                onValueChange={(v) => setForm((f) => ({ ...f, client_id: v, loan_id: "" }))}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clientsForSelect
                    .filter((c: { id: string; name: string }) =>
                      !newClientSearch.trim() ||
                      c.name.toLowerCase().includes(newClientSearch.toLowerCase())
                    )
                    .map((c: { id: string; name: string }) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border border-border/50 p-3 space-y-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="parcelamento-link-loan"
                  checked={form.link_loan}
                  onCheckedChange={(c) =>
                    setForm((f) => ({
                      ...f,
                      link_loan: c === true,
                      loan_id: c === true ? f.loan_id : "",
                    }))
                  }
                />
                <div className="space-y-1">
                  <label htmlFor="parcelamento-link-loan" className="text-sm font-medium leading-none cursor-pointer">
                    Vincular a um empréstimo deste cliente
                  </label>
                  <p className="text-xs text-muted-foreground">
                    O contrato passa a constar como Parcelamento na aba Empréstimos (pagamentos pelo plano de parcelas).
                  </p>
                </div>
              </div>
              {form.link_loan && form.client_id ? (
                loadingLoansForLink ? (
                  <p className="text-xs text-muted-foreground">Carregando empréstimos...</p>
                ) : loansForLink.length === 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    Nenhum empréstimo em andamento disponível para vincular (ou já existe parcelamento ativo ligado ao contrato).
                  </p>
                ) : (
                  <div className="space-y-2">
                    <Label>Empréstimo *</Label>
                    <Select
                      value={form.loan_id || undefined}
                      onValueChange={(v) => setForm((f) => ({ ...f, loan_id: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o empréstimo" />
                      </SelectTrigger>
                      <SelectContent>
                        {(loansForLink as Array<{ id: string; amount: number; due_date: string }>).map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {formatCurrency(Number(l.amount))} · venc. {formatDate(String(l.due_date))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Valor Total (R$) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  value={form.total_amount}
                  onChange={(e) => setForm((f) => ({ ...f, total_amount: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label>Nº Parcelas *</Label>
                <Input
                  type="number"
                  min="2"
                  max="60"
                  placeholder="Ex: 12"
                  value={form.total_installments}
                  onChange={(e) => setForm((f) => ({ ...f, total_installments: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Taxa de Juros (% ao mês)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0"
                  value={form.interest_rate}
                  onChange={(e) => setForm((f) => ({ ...f, interest_rate: e.target.value }))}
                />
              </div>
              <div>
                <Label>1º Vencimento *</Label>
                <Input
                  type="date"
                  value={form.first_due_date}
                  onChange={(e) => setForm((f) => ({ ...f, first_due_date: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea
                rows={2}
                placeholder="Opcional"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Criando..." : "Criar Parcelamento"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhes */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do Parcelamento</DialogTitle>
          </DialogHeader>
          {loadingDetails || !installmentFull ? (
            <div className="py-8 animate-pulse text-center text-muted-foreground">Carregando...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-lg bg-muted/30 border">
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-semibold">{(installmentFull.clients as { name?: string })?.name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Valor Total</p>
                  <p className="font-semibold">{formatCurrency(parseFloat(String(installmentFull.total_amount || 0)))}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Progresso</p>
                  <p className="font-semibold">
                    {(installmentFull.installment_payments || []).filter((p: { status: string }) => p.status === "paid").length}/
                    {installmentFull.total_installments} parcelas
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Pago</p>
                  <p className="font-semibold">
                    {formatCurrency(
                      (installmentFull.installment_payments || [])
                        .filter((p: { status: string }) => p.status === "paid")
                        .reduce((s: number, p: { paid_amount?: number }) => s + parseFloat(String(p.paid_amount || 0)), 0)
                    )}
                  </p>
                </div>
              </div>
              {installmentFull.notes && (
                <p className="text-sm text-muted-foreground">
                  <strong>Obs:</strong> {installmentFull.notes}
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Parcela</th>
                      <th className="text-left py-2">Valor</th>
                      <th className="text-left py-2">Vencimento</th>
                      <th className="text-left py-2">Status</th>
                      <th className="text-left py-2">Data Pagamento</th>
                      <th className="text-left py-2">Valor Pago</th>
                      <th className="text-left py-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((installmentFull.installment_payments || []) as Array<Record<string, unknown>>)
                      .sort((a, b) => Number(a.installment_number) - Number(b.installment_number))
                      .map((p) => {
                        const status = String(p.status || "pending");
                        const isPending = status === "pending" || status === "overdue";
                        return (
                          <tr key={String(p.id)} className="border-b border-border/30">
                            <td className="py-2">{p.installment_number}ª</td>
                            <td>{formatCurrency(parseFloat(String(p.amount || 0)))}</td>
                            <td>{formatDate(String(p.due_date || ""))}</td>
                            <td>
                              <span
                                className={`inline-flex px-2 py-0.5 rounded text-[10px] ${
                                  status === "paid" ? "bg-green-500/20 text-green-600" : "bg-yellow-500/20 text-yellow-600"
                                }`}
                              >
                                {status === "paid" ? "Pago" : status === "overdue" ? "Vencida" : "Pendente"}
                              </span>
                            </td>
                            <td>{p.paid_date ? formatDate(String(p.paid_date)) : "—"}</td>
                            <td>{p.paid_amount != null ? formatCurrency(parseFloat(String(p.paid_amount))) : "—"}</td>
                            <td>
                              {isPending && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => openPayment(String(p.id), parseFloat(String(p.amount || 0)))}
                                >
                                  <Wallet className="h-3.5 w-3.5 mr-1" />
                                  Registrar
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Registrar Pagamento */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Pagamento da Parcela</DialogTitle>
          </DialogHeader>
          <form onSubmit={handlePaymentSubmit} className="space-y-4">
            <div>
              <Label>Valor Pago (R$) *</Label>
              <Input
                type="number"
                step="0.01"
                value={paymentForm.paid_amount}
                onChange={(e) => setPaymentForm((f) => ({ ...f, paid_amount: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Data do Pagamento *</Label>
              <Input
                type="date"
                value={paymentForm.paid_date}
                onChange={(e) => setPaymentForm((f) => ({ ...f, paid_date: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Método de Pagamento *</Label>
              <Select
                value={paymentForm.payment_method}
                onValueChange={(v) => setPaymentForm((f) => ({ ...f, payment_method: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea
                rows={2}
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Salvando..." : "Registrar Pagamento"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
