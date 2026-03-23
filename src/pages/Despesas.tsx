import { Receipt, Plus } from "lucide-react";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchExpenses, createExpense } from "@/api/expenses";
import { fetchExpenseCategories } from "@/api/categories";
import { useState } from "react";
import { Pagination } from "@/components/Pagination";
import { PAGE_SIZE } from "@/lib/constants";
import { toast } from "sonner";

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toInputDate(s: string) {
  return String(s).split("T")[0];
}

export default function Despesas() {
  const [page, setPage] = useState(1);
  const [newExpenseOpen, setNewExpenseOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    title: "",
    amount: "",
    expense_date: toInputDate(new Date().toISOString()),
    description: "",
    category_id: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["expenses", page],
    queryFn: () => fetchExpenses(page),
  });
  const expenses = data?.data ?? [];
  const totalExpenses = data?.total ?? 0;

  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: fetchExpenseCategories,
    enabled: newExpenseOpen,
  });

  const handleNewExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseForm.title.trim() || !expenseForm.amount || !expenseForm.expense_date || !expenseForm.category_id) {
      toast.error("Preencha título, valor, data e categoria");
      return;
    }
    const amt = parseFloat(String(expenseForm.amount).replace(",", "."));
    if (isNaN(amt) || amt <= 0) {
      toast.error("Valor inválido");
      return;
    }
    setIsSubmitting(true);
    try {
      await createExpense({
        title: expenseForm.title.trim(),
        amount: amt,
        expense_date: expenseForm.expense_date,
        description: expenseForm.description.trim() || undefined,
        category_id: expenseForm.category_id,
      });
      toast.success("Despesa registrada");
      setNewExpenseOpen(false);
      setExpenseForm({ title: "", amount: "", expense_date: toInputDate(new Date().toISOString()), description: "", category_id: "" });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar despesa");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (d: string) => {
    if (!d) return "-";
    const s = String(d).split("T")[0];
    const [y, m, day] = s.split("-");
    return `${day}/${m}/${y}`;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Despesas</h1>
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
          <h1 className="text-xl font-bold">Despesas</h1>
          <p className="text-sm text-destructive">Erro ao carregar. Verifique se as tabelas expenses e expense_categories existem.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Despesas</h1>
          <p className="text-sm text-muted-foreground">Controle de despesas e categorias</p>
        </div>
        <Button onClick={() => setNewExpenseOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
          <Plus className="h-4 w-4" />
          Nova Despesa
        </Button>
      </div>

      <div className="glass-card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Categoria</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Valor</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Descrição</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Data</th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody>
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    Nenhuma despesa registrada
                  </td>
                </tr>
              ) : (
                expenses.map((e: Record<string, unknown>, i: number) => (
                  <motion.tr
                    key={String(e.id)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-border/20 hover:bg-surface-hover transition-colors"
                  >
                    <td className="p-4">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
                        {String(e.category)}
                      </span>
                    </td>
                    <td className="p-4 text-sm font-medium text-foreground">{formatCurrency(Number(e.amount))}</td>
                    <td className="p-4 text-sm text-muted-foreground">{String(e.description)}</td>
                    <td className="p-4 text-sm text-muted-foreground">{formatDate(String(e.date))}</td>
                    <td className="p-4">
                      <button className="text-muted-foreground hover:text-destructive transition-colors">⋮</button>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={totalExpenses} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>

      <Dialog open={newExpenseOpen} onOpenChange={setNewExpenseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova despesa</DialogTitle>
            <DialogDescription>Registre uma nova despesa</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleNewExpenseSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label>Título *</Label>
              <Input
                value={expenseForm.title}
                onChange={(e) => setExpenseForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Ex: Aluguel, Luz..."
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Categoria *</Label>
              <Select
                value={expenseForm.category_id}
                onValueChange={(v) => setExpenseForm((f) => ({ ...f, category_id: v }))}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a categoria" />
                </SelectTrigger>
                <SelectContent>
                  {(categories as Array<{ id: string; name: string }>).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categories.length === 0 && (
                <p className="text-xs text-muted-foreground">Cadastre categorias em Configurações</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Valor (R$) *</Label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={expenseForm.amount}
                onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d,.-]/g, "") }))}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Data *</Label>
              <Input
                type="date"
                value={expenseForm.expense_date}
                onChange={(e) => setExpenseForm((f) => ({ ...f, expense_date: e.target.value }))}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Descrição</Label>
              <Textarea
                value={expenseForm.description}
                onChange={(e) => setExpenseForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Opcional"
                rows={2}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewExpenseOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting || categories.length === 0}>
                {isSubmitting ? "Salvando..." : "Registrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
