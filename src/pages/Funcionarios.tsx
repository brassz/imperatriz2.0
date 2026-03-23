import { useMemo, useState } from "react";
import { Users, Plus, Search, Wallet, Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmployeeRow, fetchEmployees, createEmployee, updateEmployee, deleteEmployee } from "@/api/employees";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Funcionarios() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    cpf: "",
    birth_date: "",
    address: "",
    cep: "",
    payment_day: "5",
    salary: "",
  });

  const { data: employees = [], isLoading, error } = useQuery({
    queryKey: ["employees"],
    queryFn: fetchEmployees,
  });

  const upsertMutation = useMutation({
    mutationFn: async () => {
      const day = parseInt(form.payment_day, 10);
      const salary = parseFloat(form.salary.replace(",", "."));
      if (!form.full_name.trim() || !form.cpf.trim() || !form.payment_day || isNaN(day) || day < 1 || day > 31 || isNaN(salary) || salary <= 0) {
        throw new Error("Preencha nome, CPF, dia de pagamento (1–31) e salário válido.");
      }
      if (editingId) {
        await updateEmployee(editingId, {
          full_name: form.full_name.trim(),
          cpf: form.cpf,
          birth_date: form.birth_date || null,
          address: form.address || null,
          cep: form.cep || null,
          payment_day: day,
          salary,
        });
        return null;
      }
      return createEmployee({
        full_name: form.full_name.trim(),
        cpf: form.cpf,
        birth_date: form.birth_date || null,
        address: form.address || null,
        cep: form.cep || null,
        payment_day: day,
        salary,
      });
    },
    onSuccess: () => {
      toast({
        title: editingId ? "Funcionário atualizado" : "Funcionário cadastrado",
        description: editingId ? "Dados do funcionário atualizados." : "O funcionário foi registrado com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setOpen(false);
      setEditingId(null);
      setForm({
        full_name: "",
        cpf: "",
        birth_date: "",
        address: "",
        cep: "",
        payment_day: "5",
        salary: "",
      });
    },
    onError: (err) => {
      toast({
        title: "Erro ao salvar funcionário",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteEmployee(id);
    },
    onSuccess: () => {
      toast({ title: "Funcionário excluído", description: "Registro removido com sucesso." });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: () => {
      toast({ title: "Erro ao excluir funcionário", description: "Tente novamente.", variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return employees;
    const s = search.toLowerCase();
    return (employees as EmployeeRow[]).filter((e) =>
      [e.full_name, e.cpf, e.address || "", e.cep || ""].join(" ").toLowerCase().includes(s)
    );
  }, [employees, search]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Funcionários</h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
        <div className="glass-card p-8 animate-pulse rounded-xl h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Funcionários</h1>
          <p className="text-sm text-destructive">Erro ao carregar. Verifique se a tabela employees existe.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Funcionários</h1>
          <p className="text-sm text-muted-foreground">Cadastre funcionários e acompanhe dias de pagamento de salário</p>
        </div>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
          onClick={() => {
            setEditingId(null);
            setForm({
              full_name: "",
              cpf: "",
              birth_date: "",
              address: "",
              cep: "",
              payment_day: "5",
              salary: "",
            });
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Novo Funcionário
        </Button>
      </div>

      <div className="glass-card">
        <div className="p-4 border-b border-border/30 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar funcionário..."
              className="pl-8 h-8 text-xs nexus-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="text-xs text-muted-foreground">{filtered.length} funcionário(s)</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Nome</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">CPF</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4 hidden md:table-cell">Endereço</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Dia Pagamento</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Salário</th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    Nenhum funcionário cadastrado
                  </td>
                </tr>
              ) : (
                filtered.map((e: EmployeeRow, i: number) => (
                  <motion.tr
                    key={e.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    className="border-b border-border/20 hover:bg-surface-hover transition-colors"
                  >
                    <td className="p-4 text-sm font-medium text-foreground flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                        {e.full_name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                      <span className="truncate max-w-[220px]">{e.full_name}</span>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">{e.cpf}</td>
                    <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">
                      {e.address || "—"}
                    </td>
                    <td className="p-4 text-sm text-foreground flex items-center gap-1">
                      <Wallet className="h-3.5 w-3.5 text-primary" />
                      <span>{e.payment_day}</span>
                    </td>
                    <td className="p-4 text-sm font-medium text-foreground">
                      {formatCurrency(e.salary)}
                    </td>
                    <td className="p-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setEditingId(e.id);
                            setForm({
                              full_name: e.full_name,
                              cpf: e.cpf,
                              birth_date: e.birth_date ?? "",
                              address: e.address ?? "",
                              cep: e.cep ?? "",
                              payment_day: String(e.payment_day),
                              salary: String(e.salary).replace(".", ","),
                            });
                            setOpen(true);
                          }}
                          aria-label="Editar funcionário"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (!confirm(`Excluir funcionário ${e.full_name}? Esta ação não pode ser desfeita.`)) return;
                            deleteMutation.mutate(e.id);
                          }}
                          aria-label="Excluir funcionário"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar funcionário" : "Novo funcionário"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Atualize os dados do funcionário." : "Cadastre um novo funcionário para controle de salários"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-2">
              <Label>Nome completo *</Label>
              <Input
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>CPF *</Label>
              <Input
                value={form.cpf}
                onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))}
                placeholder="Somente números"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Data de nascimento</Label>
                <Input
                  type="date"
                  value={form.birth_date}
                  onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>CEP</Label>
                <Input
                  value={form.cep}
                  onChange={(e) => setForm((f) => ({ ...f, cep: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Endereço</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Dia de pagamento *</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={form.payment_day}
                  onChange={(e) => setForm((f) => ({ ...f, payment_day: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Salário (R$) *</Label>
                <Input
                  value={form.salary}
                  onChange={(e) => setForm((f) => ({ ...f, salary: e.target.value }))}
                  placeholder="0,00"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => upsertMutation.mutate()} disabled={upsertMutation.isPending}>
              {upsertMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

