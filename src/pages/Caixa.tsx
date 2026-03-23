import { Wallet, Plus, ArrowUpRight, ArrowDownRight } from "lucide-react";
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
import { motion } from "framer-motion";
import { MetricCard } from "@/components/MetricCard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCashTransactions, fetchCashBalance, createCashTransaction } from "@/api/cash";
import { useState } from "react";
import { Pagination } from "@/components/Pagination";
import { PAGE_SIZE } from "@/lib/constants";
import { toast } from "sonner";

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Caixa() {
  const [page, setPage] = useState(1);
  const [newMovementOpen, setNewMovementOpen] = useState(false);
  const [movementForm, setMovementForm] = useState({
    type: "in" as "in" | "out",
    amount: "",
    description: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading: loadingTx, error: errorTx } = useQuery({
    queryKey: ["cash-transactions", page],
    queryFn: () => fetchCashTransactions(page),
  });
  const transactions = data?.data ?? [];
  const totalTransactions = data?.total ?? 0;

  const { data: balanceData, isLoading: loadingBal } = useQuery({
    queryKey: ["cash-balance"],
    queryFn: fetchCashBalance,
  });

  const isLoading = loadingTx || loadingBal;
  const error = errorTx;

  const formatDate = (d: string) => {
    if (!d) return "-";
    const s = String(d).split("T")[0];
    const [y, m, day] = s.split("-");
    return `${day}/${m}/${y}`;
  };

  const b = balanceData || { balance: 0, income: 0, outcome: 0 };

  const handleNewMovementSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movementForm.amount || !movementForm.description.trim()) {
      toast.error("Preencha valor e motivo");
      return;
    }
    const amt = parseFloat(String(movementForm.amount).replace(",", "."));
    if (isNaN(amt) || amt <= 0) {
      toast.error("Valor inválido");
      return;
    }
    if (movementForm.type === "out" && amt > b.balance) {
      toast.error("Saldo insuficiente");
      return;
    }
    setIsSubmitting(true);
    try {
      await createCashTransaction({
        transaction_type: movementForm.type === "in" ? "deposit" : "withdrawal",
        amount: amt,
        description: movementForm.description.trim(),
      });
      toast.success(movementForm.type === "in" ? "Entrada registrada" : "Saída registrada");
      setNewMovementOpen(false);
      setMovementForm({ type: "in", amount: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["cash-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["cash-balance"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar movimentação");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Caixa</h1>
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
          <h1 className="text-xl font-bold">Caixa</h1>
          <p className="text-sm text-destructive">Erro ao carregar. Verifique se as tabelas cash_transactions e cash_settings existem.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Caixa</h1>
          <p className="text-sm text-muted-foreground">Controle de fluxo de caixa</p>
        </div>
        <Button onClick={() => setNewMovementOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
          <Plus className="h-4 w-4" />
          Nova Movimentação
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard title="Saldo Atual" value={formatCurrency(b.balance)} changeType="neutral" icon={Wallet} index={0} />
        <MetricCard title="Entradas (mês)" value={formatCurrency(b.income)} changeType="positive" icon={ArrowUpRight} index={1} />
        <MetricCard title="Saídas (mês)" value={formatCurrency(b.outcome)} changeType="negative" icon={ArrowDownRight} index={2} />
      </div>

      <div className="glass-card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Data</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Tipo</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Valor</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    Nenhuma movimentação
                  </td>
                </tr>
              ) : (
                transactions.map((t: Record<string, unknown>, i: number) => (
                  <motion.tr
                    key={String(t.id)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-border/20 hover:bg-surface-hover transition-colors"
                  >
                    <td className="p-4 text-sm text-muted-foreground">{formatDate(String(t.date))}</td>
                    <td className="p-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          t.type === "in" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {t.type === "in" ? "Entrada" : "Saída"}
                      </span>
                    </td>
                    <td className={`p-4 text-sm font-medium ${t.type === "in" ? "text-success" : "text-destructive"}`}>
                      {t.type === "in" ? "+" : "−"} {formatCurrency(Number(t.amount))}
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">{String(t.reason)}</td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={totalTransactions} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>

      <Dialog open={newMovementOpen} onOpenChange={setNewMovementOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova movimentação</DialogTitle>
            <DialogDescription>Registre uma entrada ou saída de caixa</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleNewMovementSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label>Tipo *</Label>
              <Select
                value={movementForm.type}
                onValueChange={(v: "in" | "out") => setMovementForm((f) => ({ ...f, type: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">Entrada</SelectItem>
                  <SelectItem value="out">Saída</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Valor (R$) *</Label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={movementForm.amount}
                onChange={(e) => setMovementForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d,.-]/g, "") }))}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Motivo / Descrição *</Label>
              <Textarea
                value={movementForm.description}
                onChange={(e) => setMovementForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Ex: Pagamento recebido, Retirada..."
                rows={3}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewMovementOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Salvando..." : "Registrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
