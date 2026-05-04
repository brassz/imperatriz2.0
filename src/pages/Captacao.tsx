import { Plus, RefreshCw, TrendingUp, Pencil, Trash2, Eye } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  computeCapitalRaiseTotalQuitacao,
  computeCapitalRaiseParcelaValue,
  createCapitalRaise,
  deleteCapitalRaise,
  fetchCapitalRaiseProgress,
  fetchCapitalRaises,
  updateCapitalRaise,
  type CapitalRaise,
  type CapitalRaiseProgress,
} from "@/api/captacao";

function fmtBrl(n: number): string {
  return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatBR(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = String(ymd).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(ymd);
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseMoneyInput(raw: string): number {
  const s = String(raw || "").trim();
  if (!s) return NaN;
  // Mantém só dígitos e separadores usuais.
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
    // Sem separador decimal: remove qualquer ponto/vírgula (trata como milhar)
    normalized = normalized.replaceAll(".", "").replaceAll(",", "");
  }
  // Caso exista mais de um '.', mantém só o último como decimal.
  const parts = normalized.split(".");
  if (parts.length > 2) {
    const dec = parts.pop() as string;
    normalized = `${parts.join("")}.${dec}`;
  }
  return parseFloat(normalized);
}

function progressPct(n: number): number {
  return clampPct(n);
}

export default function Captacao() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<CapitalRaise | null>(null);
  const [detailProgress, setDetailProgress] = useState<CapitalRaiseProgress | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [form, setForm] = useState({
    nome: "",
    investidor: "",
    valor_levantado: "",
    juros_percent_total: "",
    prazo_meses: "2",
    parcelas: "1",
    data_inicio: new Date().toISOString().slice(0, 10),
    data_vencimento: "",
    ativo: true,
  });

  const { data: raises = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["capital-raises"],
    queryFn: fetchCapitalRaises,
    staleTime: 30_000,
  });

  const progressQueries = useQueries({
    queries: (raises as CapitalRaise[]).map((r) => ({
      queryKey: ["capital-raise-progress", r.id, r.updated_at],
      queryFn: () => fetchCapitalRaiseProgress(r),
      staleTime: 15_000,
      retry: false,
      enabled: Boolean(r?.id),
    })),
  });

  const progressById = useMemo(() => {
    const m: Record<string, CapitalRaiseProgress | undefined> = {};
    (raises as CapitalRaise[]).forEach((r, idx) => {
      m[r.id] = progressQueries[idx]?.data;
    });
    return m;
  }, [raises, progressQueries]);

  const rows = useMemo(() => {
    return (raises as CapitalRaise[]).map((r) => {
      const parcelaValor = computeCapitalRaiseParcelaValue(r);
      const prog = progressById[r.id];
      const restante = prog ? prog.remainingPrincipal : Number(r.valor_levantado || 0);
      const pct = prog ? prog.pctPrincipal : 0;
      return { raise: r, parcelaValor, restante, pct };
    });
  }, [raises, progressById]);

  const openCreate = () => {
    setForm({
      nome: "",
      investidor: "",
      valor_levantado: "",
      juros_percent_total: "",
      prazo_meses: "2",
      parcelas: "1",
      data_inicio: new Date().toISOString().slice(0, 10),
      data_vencimento: "",
      ativo: true,
    });
    setCreateOpen(true);
  };

  const openEdit = (r: CapitalRaise) => {
    setSelected(r);
    setForm({
      nome: r.nome || "",
      investidor: r.investidor || "",
      valor_levantado: String(r.valor_levantado ?? ""),
      juros_percent_total: String(r.juros_percent_total ?? ""),
      prazo_meses: String(r.prazo_meses ?? 2),
      parcelas: String(r.parcelas ?? 1),
      data_inicio: String(r.data_inicio || new Date().toISOString().slice(0, 10)),
      data_vencimento: r.data_vencimento || "",
      ativo: Boolean(r.ativo),
    });
    setEditOpen(true);
  };

  const openDetail = async (r: CapitalRaise) => {
    setSelected(r);
    setDetailOpen(true);
    setDetailProgress(null);
    setDetailLoading(true);
    try {
      const prog = await fetchCapitalRaiseProgress(r);
      setDetailProgress(prog);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar detalhes do levantamento");
    } finally {
      setDetailLoading(false);
    }
  };

  const submitCreate = async () => {
    const nome = form.nome.trim();
    const investidor = form.investidor.trim();
    const valor = parseMoneyInput(form.valor_levantado);
    const jurosPct = parseMoneyInput(form.juros_percent_total);
    const prazo = parseInt(String(form.prazo_meses), 10);
    const parcelas = parseInt(String(form.parcelas), 10);
    if (!nome) return toast.error("Informe um nome para o levantamento");
    if (!(valor > 0)) return toast.error("Valor levantado inválido");
    if (!(jurosPct >= 0)) return toast.error("Juros (%) inválidos");
    if (!(prazo > 0)) return toast.error("Prazo (meses) inválido");
    if (!(parcelas > 0)) return toast.error("Parcelas inválidas");

    try {
      await createCapitalRaise({
        nome,
        investidor: investidor ? investidor : null,
        valor_levantado: valor,
        juros_percent_total: jurosPct,
        prazo_meses: prazo,
        parcelas,
        data_inicio: form.data_inicio,
        data_vencimento: form.data_vencimento ? form.data_vencimento : null,
        ativo: form.ativo,
      });
      toast.success("Levantamento criado");
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["capital-raises"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar levantamento");
    }
  };

  const submitEdit = async () => {
    if (!selected) return;
    const nome = form.nome.trim();
    const investidor = form.investidor.trim();
    const valor = parseMoneyInput(form.valor_levantado);
    const jurosPct = parseMoneyInput(form.juros_percent_total);
    const prazo = parseInt(String(form.prazo_meses), 10);
    const parcelas = parseInt(String(form.parcelas), 10);
    if (!nome) return toast.error("Informe um nome para o levantamento");
    if (!(valor > 0)) return toast.error("Valor levantado inválido");
    if (!(jurosPct >= 0)) return toast.error("Juros (%) inválidos");
    if (!(prazo > 0)) return toast.error("Prazo (meses) inválido");
    if (!(parcelas > 0)) return toast.error("Parcelas inválidas");

    try {
      await updateCapitalRaise(selected.id, {
        nome,
        investidor: investidor ? investidor : null,
        valor_levantado: valor,
        juros_percent_total: jurosPct,
        prazo_meses: prazo,
        parcelas,
        data_inicio: form.data_inicio,
        data_vencimento: form.data_vencimento ? form.data_vencimento : null,
        ativo: form.ativo,
      });
      toast.success("Levantamento atualizado");
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: ["capital-raises"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar levantamento");
    }
  };

  const handleDelete = async (r: CapitalRaise) => {
    if (!confirm(`Remover o levantamento "${r.nome}"?`)) return;
    try {
      await deleteCapitalRaise(r.id);
      toast.success("Levantamento removido");
      queryClient.invalidateQueries({ queryKey: ["capital-raises"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover levantamento");
    }
  };

  const toggleAtivo = async (r: CapitalRaise) => {
    try {
      await updateCapitalRaise(r.id, { ativo: !r.ativo });
      queryClient.invalidateQueries({ queryKey: ["capital-raises"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar status");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Captação de Capital</h1>
        <p className="text-sm text-muted-foreground">
          Cadastre levantamentos e acompanhe a quitação pelo rateio (capital/juros) dos pagamentos dos empréstimos vinculados.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="glass-card p-5"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Levantamentos
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Juros (%) é percentual total do período. Total de quitação = levantado + levantado * juros%.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-2" disabled={isFetching} onClick={() => void refetch()}>
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
            <Button type="button" size="sm" className="gap-2" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Novo levantamento
            </Button>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive mt-4">Erro ao carregar levantamentos.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground mt-4">Carregando...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-4">Nenhum levantamento cadastrado.</p>
        ) : (
          <div className="mt-4 rounded-lg border border-border/60 overflow-hidden">
            <div className="grid grid-cols-12 gap-0 bg-muted/30 text-[11px] text-muted-foreground font-medium">
              <div className="col-span-4 p-2">Levantamento</div>
              <div className="col-span-2 p-2">Levantado</div>
              <div className="col-span-1 p-2">Parcelas</div>
              <div className="col-span-2 p-2">Valor parcela</div>
              <div className="col-span-2 p-2">Restante (levantado)</div>
              <div className="col-span-1 p-2 text-right">Ações</div>
            </div>
            <div className="divide-y divide-border/50">
              {rows.map(({ raise, parcelaValor, restante, pct }) => (
                <div key={raise.id} className="grid grid-cols-12 gap-0 items-center text-xs">
                  <div className="col-span-4 p-2 min-w-0">
                    <p className="font-medium text-foreground truncate">{raise.nome}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {raise.investidor ? `${raise.investidor} · ` : ""}
                      Início: {formatBR(raise.data_inicio)} · Venc.: {formatBR(raise.data_vencimento)} · Juros:{" "}
                      {clampPct(raise.juros_percent_total)}%
                    </p>
                  </div>
                  <div className="col-span-2 p-2 tabular-nums text-foreground">{fmtBrl(raise.valor_levantado)}</div>
                  <div className="col-span-1 p-2 tabular-nums text-foreground">{Math.max(1, raise.parcelas || 1)}</div>
                  <div className="col-span-2 p-2 tabular-nums text-foreground">{fmtBrl(parcelaValor)}</div>
                  <div className="col-span-2 p-2">
                    <p className="tabular-nums text-foreground">{fmtBrl(restante)}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Progress value={progressPct(pct)} className="h-2" />
                      <span className="text-[11px] text-muted-foreground tabular-nums w-10 text-right">
                        {progressPct(pct)}%
                      </span>
                    </div>
                  </div>
                  <div className="col-span-1 p-2 flex justify-end gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      title="Detalhes"
                      onClick={() => void openDetail(raise)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      title={raise.ativo ? "Desativar" : "Ativar"}
                      onClick={() => void toggleAtivo(raise)}
                    >
                      <span className={`text-[10px] font-semibold ${raise.ativo ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>
                        {raise.ativo ? "ON" : "OFF"}
                      </span>
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      title="Editar"
                      onClick={() => openEdit(raise)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      className="h-7 w-7"
                      title="Remover"
                      onClick={() => void handleDelete(raise)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo levantamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label>Nome *</Label>
              <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Investidor (opcional)</Label>
              <Input value={form.investidor} onChange={(e) => setForm((f) => ({ ...f, investidor: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Valor levantado (R$) *</Label>
                <Input
                  inputMode="decimal"
                  value={form.valor_levantado}
                  onChange={(e) => setForm((f) => ({ ...f, valor_levantado: e.target.value.replace(/[^\d,.-]/g, "") }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Juros total (%) *</Label>
                <Input
                  inputMode="decimal"
                  value={form.juros_percent_total}
                  onChange={(e) => setForm((f) => ({ ...f, juros_percent_total: e.target.value.replace(/[^\d,.-]/g, "") }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Prazo (meses) *</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.prazo_meses}
                  onChange={(e) => setForm((f) => ({ ...f, prazo_meses: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Parcelas *</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.parcelas}
                  onChange={(e) => setForm((f) => ({ ...f, parcelas: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Início *</Label>
                <Input
                  type="date"
                  value={form.data_inicio}
                  onChange={(e) => setForm((f) => ({ ...f, data_inicio: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Vencimento (opcional)</Label>
              <Input
                type="date"
                value={form.data_vencimento}
                onChange={(e) => setForm((f) => ({ ...f, data_vencimento: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.ativo} onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: Boolean(v) }))} />
              <span>Ativo</span>
            </label>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitCreate}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar levantamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label>Nome *</Label>
              <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Investidor (opcional)</Label>
              <Input value={form.investidor} onChange={(e) => setForm((f) => ({ ...f, investidor: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Valor levantado (R$) *</Label>
                <Input
                  inputMode="decimal"
                  value={form.valor_levantado}
                  onChange={(e) => setForm((f) => ({ ...f, valor_levantado: e.target.value.replace(/[^\d,.-]/g, "") }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Juros total (%) *</Label>
                <Input
                  inputMode="decimal"
                  value={form.juros_percent_total}
                  onChange={(e) => setForm((f) => ({ ...f, juros_percent_total: e.target.value.replace(/[^\d,.-]/g, "") }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Prazo (meses) *</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.prazo_meses}
                  onChange={(e) => setForm((f) => ({ ...f, prazo_meses: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Parcelas *</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.parcelas}
                  onChange={(e) => setForm((f) => ({ ...f, parcelas: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Início *</Label>
                <Input
                  type="date"
                  value={form.data_inicio}
                  onChange={(e) => setForm((f) => ({ ...f, data_inicio: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Vencimento (opcional)</Label>
              <Input
                type="date"
                value={form.data_vencimento}
                onChange={(e) => setForm((f) => ({ ...f, data_vencimento: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.ativo} onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: Boolean(v) }))} />
              <span>Ativo</span>
            </label>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitEdit}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailOpen}
        onOpenChange={(v) => {
          setDetailOpen(v);
          if (!v) {
            setSelected(null);
            setDetailProgress(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do levantamento</DialogTitle>
          </DialogHeader>
          {!selected ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : detailLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : !detailProgress ? (
            <p className="text-sm text-muted-foreground">Sem dados.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                <p className="text-sm font-semibold text-foreground">{detailProgress.raise.nome}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {detailProgress.raise.investidor ? `${detailProgress.raise.investidor} · ` : ""}
                  Início: {formatBR(detailProgress.raise.data_inicio)} · Venc.: {formatBR(detailProgress.raise.data_vencimento)} · Prazo:{" "}
                  {detailProgress.raise.prazo_meses} mês(es) · Parcelas: {Math.max(1, detailProgress.raise.parcelas || 1)} · Juros:{" "}
                  {clampPct(detailProgress.raise.juros_percent_total)}%
                </p>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="rounded-md border border-border/60 bg-background/60 p-3">
                    <p className="text-[11px] text-muted-foreground">Valor levantado</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">{fmtBrl(detailProgress.raise.valor_levantado)}</p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/60 p-3">
                    <p className="text-[11px] text-muted-foreground">Valor parcela</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">{fmtBrl(computeCapitalRaiseParcelaValue(detailProgress.raise))}</p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/60 p-3">
                    <p className="text-[11px] text-muted-foreground">Valor restante (levantado)</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">{fmtBrl(detailProgress.remainingPrincipal)}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Progresso (capital):{" "}
                  <span className="text-foreground tabular-nums font-medium">{progressPct(detailProgress.pctPrincipal)}%</span>
                </p>
                <div className="mt-2">
                  <Progress value={progressPct(detailProgress.pctPrincipal)} className="h-2" />
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-foreground mb-2">Empréstimos vinculados</p>
                <ScrollArea className="h-[320px] rounded-lg border border-border/60">
                  <div className="p-3 space-y-2">
                    {detailProgress.byLoan.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum empréstimo vinculado.</p>
                    ) : (
                      detailProgress.byLoan.map((l) => (
                        <div key={l.loanId} className="rounded-lg border border-border/50 bg-muted/10 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{l.clientName}</p>
                              <p className="text-[11px] text-muted-foreground">
                                Alocado: {fmtBrl(l.allocatedTotal)} · Recebido: {fmtBrl(l.receivedTotal)}
                              </p>
                            </div>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {progressPct(l.allocatedTotal > 0 ? (l.receivedTotal / l.allocatedTotal) * 100 : 0)}%
                            </span>
                          </div>
                          <div className="mt-2">
                            <Progress value={progressPct(l.allocatedTotal > 0 ? (l.receivedTotal / l.allocatedTotal) * 100 : 0)} className="h-2" />
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                            <div className="rounded-md border border-border/50 bg-background/60 p-2">
                              <p>Juros: recebido {fmtBrl(l.receivedInterest)} · falta {fmtBrl(l.remainingInterest)}</p>
                            </div>
                            <div className="rounded-md border border-border/50 bg-background/60 p-2">
                              <p>Capital: recebido {fmtBrl(l.receivedCapital)} · falta {fmtBrl(l.remainingCapital)}</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
