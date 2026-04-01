import { History, User, Search, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { fetchClientsForSelect, fetchClientHistory } from "@/api/clients";
import { fetchClientTags, type ClientTagRow } from "@/api/client-tags";
import { useState } from "react";

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(s: string) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

const statusLabels: Record<string, string> = {
  active: "Ativo",
  overdue: "Vencido",
  partial_paid: "Pago parcial",
  installments: "Parcelamento",
  paid: "Quitado",
  cancelled: "Cancelado",
  due_today: "Vence hoje",
};

export default function Historico() {
  const [clientId, setClientId] = useState<string>("");
  const [clientSearch, setClientSearch] = useState("");

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-for-select"],
    queryFn: fetchClientsForSelect,
  });

  const { data: history, isLoading, error } = useQuery({
    queryKey: ["client-history", clientId],
    queryFn: () => fetchClientHistory(clientId),
    enabled: !!clientId,
  });

  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ["client-tags", clientId],
    queryFn: () => fetchClientTags(clientId),
    enabled: !!clientId,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Histórico</h1>
        <p className="text-sm text-muted-foreground">
          Visualize todos os empréstimos e pagamentos do cliente
        </p>
      </div>

      <div className="glass-card p-4 space-y-3">
        <label className="text-sm font-medium block">Selecione o cliente</label>
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente por nome..."
            className="pl-8"
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
          />
        </div>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="max-w-md">
            <SelectValue placeholder="Selecione o cliente" />
          </SelectTrigger>
          <SelectContent>
            {clients
              .filter((c: { id: string; name: string }) =>
                !clientSearch.trim() ||
                c.name.toLowerCase().includes(clientSearch.toLowerCase())
              )
              .map((c: { id: string; name: string }) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      {!clientId && (
        <div className="glass-card p-12 text-center">
          <History className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
          <p className="text-muted-foreground">Selecione um cliente para ver o histórico</p>
        </div>
      )}

      {clientId && isLoading && (
        <div className="glass-card p-12 text-center">
          <div className="animate-pulse text-muted-foreground">Carregando histórico...</div>
        </div>
      )}

      {clientId && error && (
        <div className="glass-card p-6">
          <p className="text-destructive">Erro ao carregar histórico. Verifique a conexão.</p>
        </div>
      )}

      {clientId && history && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-6"
        >
          {/* Dados do cliente */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <User className="h-5 w-5" />
              Dados do cliente
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Nome</p>
                <p className="font-medium">{history.client.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">CPF</p>
                <p>{history.client.cpf || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Telefone</p>
                <p>{history.client.phone || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">E-mail</p>
                <p>{history.client.email || "—"}</p>
              </div>
              <div className="md:col-span-2">
                <p className="text-muted-foreground text-xs">Endereço</p>
                <p>{history.client.address || "—"}</p>
              </div>
            </div>
          </div>

          {/* Score */}
          {history.score && (
            <div className="glass-card p-4 flex items-center gap-4">
              <div
                className={`text-3xl font-bold ${
                  history.score.score >= 80
                    ? "text-emerald-600"
                    : history.score.score >= 60
                      ? "text-primary"
                      : history.score.score >= 40
                        ? "text-amber-600"
                        : "text-red-600"
                }`}
              >
                {history.score.score}
              </div>
              <div>
                <p className="text-sm font-medium">Score do cliente</p>
                <p className="text-muted-foreground text-xs">{history.score.label} (1–100)</p>
              </div>
            </div>
          )}

          {/* Etiquetas do cliente */}
          <div className="glass-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">Etiquetas do cliente</p>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {tagsLoading ? "Carregando..." : `${(tags as ClientTagRow[]).length} etiqueta(s)`}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(tags as ClientTagRow[]).map((tag) => {
                const color = tag.color || "blue";
                const cls =
                  color === "green"
                    ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                    : color === "amber"
                      ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
                      : color === "red"
                        ? "bg-red-500/10 text-red-700 border-red-500/30"
                        : color === "purple"
                          ? "bg-violet-500/10 text-violet-700 border-violet-500/30"
                          : "bg-sky-500/10 text-sky-700 border-sky-500/30";
                return (
                  <span
                    key={tag.id}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${cls}`}
                  >
                    <span className="max-w-[220px] truncate">{tag.text}</span>
                    {tag.created_by_name && (
                      <span className="text-[9px] text-primary/70 ml-1">
                        · {tag.created_by_name}
                      </span>
                    )}
                  </span>
                );
              })}
              {!tagsLoading && (tags as ClientTagRow[]).length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Nenhuma etiqueta cadastrada para este cliente.
                </p>
              )}
            </div>
          </div>

          {/* Resumo */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-xs">Total de empréstimos</p>
              <p className="text-2xl font-bold text-primary">{history.totalLoans}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-xs">Total de pagamentos</p>
              <p className="text-2xl font-bold">{history.totalPayments}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-xs">Valor total pago</p>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(history.totalPaid)}</p>
            </div>
          </div>

          {/* Empréstimos */}
          <div className="glass-card overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="font-semibold">Empréstimos ({history.loans.length})</h2>
            </div>
            {history.loans.length === 0 ? (
              <p className="p-6 text-center text-muted-foreground text-sm">
                Nenhum empréstimo encontrado
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Valor</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Juros</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Data</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Vencimento</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.loans.map((loan: Record<string, unknown>) => (
                      <tr key={String(loan.id)} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="p-3 font-medium">{formatCurrency(parseFloat(String(loan.amount || 0)))}</td>
                        <td className="p-3">{loan.interest_rate}%</td>
                        <td className="p-3">{formatDate(String(loan.loan_date || ""))}</td>
                        <td className="p-3">{formatDate(String(loan.due_date || ""))}</td>
                        <td className="p-3">
                          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-muted">
                            {statusLabels[String(loan.status)] || String(loan.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pagamentos */}
          <div className="glass-card overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="font-semibold">Pagamentos ({history.payments.length})</h2>
            </div>
            {history.payments.length === 0 ? (
              <p className="p-6 text-center text-muted-foreground text-sm">
                Nenhum pagamento registrado
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Data</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Valor</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Multa</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Tipo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.payments.map((p: Record<string, unknown>) => (
                      <tr key={String(p.id)} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="p-3">{formatDate(String(p.payment_date || p.created_at || ""))}</td>
                        <td className="p-3 font-medium">{formatCurrency(parseFloat(String(p.amount || 0)))}</td>
                        <td className="p-3">{(p as { fine_amount?: number }).fine_amount ? formatCurrency(parseFloat(String((p as { fine_amount?: number }).fine_amount))) : "—"}</td>
                        <td className="p-3 text-muted-foreground">{String(p.payment_type || "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
