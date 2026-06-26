import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Gift, MessageCircle, Search, Sparkles, User, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchRemarketingQuitados, type RemarketingQuitadoRow } from "@/api/remarketing";
import { fetchClientHistory } from "@/api/clients";
import { fetchClientTags, type ClientTagRow } from "@/api/client-tags";
import { buildRemarketingRewardMessage } from "@/lib/whatsapp-messages";
import { sendWhatsAppMessage } from "@/api/evolution";
import { toast } from "sonner";

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

function ScoreBlock({ score }: { score: RemarketingQuitadoRow["clientScore"] }) {
  if (!score) {
    return (
      <div className="rounded-xl border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
        Score indisponível no momento.
      </div>
    );
  }
  const color =
    score.score >= 80
      ? "text-emerald-600"
      : score.score >= 60
        ? "text-primary"
        : score.score >= 40
          ? "text-amber-600"
          : "text-red-600";
  return (
    <div className="rounded-xl border border-border/50 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Score do cliente</p>
      <div className="flex items-end gap-3">
        <span className={`text-4xl font-black tabular-nums ${color}`}>{score.score}</span>
        <div>
          <p className="text-sm font-semibold text-foreground">{score.label}</p>
          <p className="text-[11px] text-muted-foreground">Escala 1–100</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground pt-2 border-t border-border/40">
        <span>Quitados: {score.details.paidLoans}</span>
        <span>Total contratos: {score.details.totalLoans}</span>
        <span>Atrasos históricos: {score.details.overdueCount}</span>
        <span>No prazo: {score.details.onTimeCount}</span>
      </div>
    </div>
  );
}

export default function Remarketing() {
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<RemarketingQuitadoRow | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const { data: rows = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["remarketing-quitados"],
    queryFn: fetchRemarketingQuitados,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = r.clientName.toLowerCase();
      const cpf = (r.clientCpf || "").replace(/\D/g, "");
      const qn = q.replace(/\D/g, "");
      return name.includes(q) || (qn.length >= 3 && cpf.includes(qn));
    });
  }, [rows, search]);

  const handleSendCongrats = async (row: RemarketingQuitadoRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const phone = String(row.clientPhone || "").trim();
    if (!phone) {
      toast.error("Cliente sem telefone cadastrado");
      return;
    }
    const text = buildRemarketingRewardMessage(row.clientName, 12);
    setSendingId(row.paidLoanId);
    try {
      const res = await sendWhatsAppMessage(phone, text);
      if (res.ok && res.via === "api") toast.success("Mensagem enviada pelo WhatsApp");
      else if (res.error) toast.error(res.error);
      else toast.success("WhatsApp aberto — envie a mensagem no app");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          Remarketing
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Empréstimos quitados, score, histórico e campanha de retorno NovixCred (taxa única por 12h).
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between"
      >
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou CPF..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {(isFetching || isLoading) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>
            {filtered.length} de {rows.length} quitado(s)
          </span>
          <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
            Atualizar
          </Button>
        </div>
      </motion.div>

      {error && (
        <div className="glass-card p-6 border-destructive/40">
          <p className="text-destructive text-sm">Erro ao carregar quitados. Tente novamente.</p>
        </div>
      )}

      {isLoading && (
        <div className="glass-card p-12 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="glass-card p-12 text-center text-muted-foreground text-sm">
          {rows.length === 0 ? "Nenhum empréstimo quitado encontrado." : "Nenhum resultado para a busca."}
        </div>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Cliente</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Telefone</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Valor</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Quitado em</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Score</th>
                  <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const sc = row.clientScore?.score;
                  const scoreClass =
                    typeof sc === "number"
                      ? sc >= 80
                        ? "text-emerald-600 font-bold"
                        : sc >= 60
                          ? "text-primary font-bold"
                          : sc >= 40
                            ? "text-amber-600 font-bold"
                            : "text-red-600 font-bold"
                      : "text-muted-foreground";
                  return (
                    <tr
                      key={row.paidLoanId}
                      className="border-b border-border/30 hover:bg-muted/15 cursor-pointer"
                      onClick={() => setDetail(row)}
                    >
                      <td className="p-3 font-medium text-foreground max-w-[200px]">
                        <span className="truncate block">{row.clientName}</span>
                      </td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{row.clientPhone || "—"}</td>
                      <td className="p-3 whitespace-nowrap">{formatCurrency(row.originalAmount)}</td>
                      <td className="p-3 whitespace-nowrap">{formatDate(row.paidDate)}</td>
                      <td className={`p-3 whitespace-nowrap ${scoreClass}`}>
                        {typeof sc === "number" ? `${sc}/100` : "—"}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="default"
                            size="sm"
                            className="h-8 gap-1"
                            disabled={!row.clientPhone?.trim() || sendingId === row.paidLoanId}
                            onClick={(e) => handleSendCongrats(row, e)}
                          >
                            {sendingId === row.paidLoanId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Gift className="h-3.5 w-3.5" />
                            )}
                            Parabenizar
                          </Button>
                          <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setDetail(row)}>
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      <RemarketingDetailSheet row={detail} onOpenChange={(o) => !o && setDetail(null)} onSendCongrats={handleSendCongrats} sendingId={sendingId} />
    </div>
  );
}

function RemarketingDetailSheet({
  row,
  onOpenChange,
  onSendCongrats,
  sendingId,
}: {
  row: RemarketingQuitadoRow | null;
  onOpenChange: (open: boolean) => void;
  onSendCongrats: (row: RemarketingQuitadoRow, e?: React.MouseEvent) => void;
  sendingId: string | null;
}) {
  const open = !!row;

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ["client-history", row?.clientId],
    queryFn: () => fetchClientHistory(row!.clientId),
    enabled: open && !!row?.clientId,
  });

  const { data: tags = [], isLoading: loadingTags } = useQuery({
    queryKey: ["client-tags", row?.clientId],
    queryFn: () => fetchClientTags(row!.clientId),
    enabled: open && !!row?.clientId,
  });

  const previewText = row ? buildRemarketingRewardMessage(row.clientName, 12) : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col">
        {row && (
          <>
            <SheetHeader className="space-y-1 text-left">
              <SheetTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {row.clientName}
              </SheetTitle>
              <SheetDescription>
                Contrato quitado · {formatCurrency(row.originalAmount)} · em {formatDate(row.paidDate)}
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="flex-1 mt-4 pr-3">
              <div className="space-y-4 pb-8">
                <ScoreBlock score={row.clientScore} />

                <div className="flex flex-wrap gap-2">
                  <Button
                    className="gap-2"
                    disabled={!row.clientPhone?.trim() || sendingId === row.paidLoanId}
                    onClick={(e) => onSendCongrats(row, e)}
                  >
                    {sendingId === row.paidLoanId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MessageCircle className="h-4 w-4" />
                    )}
                    Enviar parabéns + oferta (12h)
                  </Button>
                </div>

                <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-3">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2">Prévia da mensagem</p>
                  <pre className="text-[11px] whitespace-pre-wrap font-sans text-foreground leading-relaxed">{previewText}</pre>
                </div>

                <div className="rounded-xl border border-border/50 p-4 space-y-2 text-sm">
                  <p className="text-xs font-semibold text-foreground">Dados do cliente</p>
                  <div className="grid gap-1 text-xs text-muted-foreground">
                    <p>
                      <span className="text-foreground/80">Tel:</span> {row.clientPhone || "—"}
                    </p>
                    <p>
                      <span className="text-foreground/80">CPF:</span> {row.clientCpf || "—"}
                    </p>
                    <p>
                      <span className="text-foreground/80">E-mail:</span> {row.clientEmail || "—"}
                    </p>
                    <p>
                      <span className="text-foreground/80">Endereço:</span> {row.clientAddress || "—"}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-foreground mb-2">Etiquetas</p>
                  {loadingTags ? (
                    <p className="text-xs text-muted-foreground">Carregando...</p>
                  ) : (tags as ClientTagRow[]).length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhuma etiqueta.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(tags as ClientTagRow[]).map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex px-2 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary border border-primary/20"
                        >
                          {tag.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <Tabs defaultValue="contrato" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="contrato">Este contrato</TabsTrigger>
                    <TabsTrigger value="historico">Histórico do cliente</TabsTrigger>
                  </TabsList>
                  <TabsContent value="contrato" className="mt-3 space-y-3">
                    <div className="text-xs space-y-1">
                      <p>
                        <span className="text-muted-foreground">Empréstimo:</span> {formatDate(row.loanDate)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Vencimento:</span> {formatDate(row.dueDate)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Juros:</span> {row.interestRate}%
                      </p>
                      {row.paymentMethod && (
                        <p>
                          <span className="text-muted-foreground">Forma (quitado):</span> {row.paymentMethod}
                        </p>
                      )}
                      {row.totalPaid != null && (
                        <p>
                          <span className="text-muted-foreground">Total pago (registro):</span>{" "}
                          {formatCurrency(row.totalPaid)}
                        </p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs font-semibold mb-1">Anotação do quitado</p>
                      <p className="text-xs text-muted-foreground rounded-md bg-muted/30 p-2 border border-border/40">
                        {row.quitadoNotes?.trim() || "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold mb-2">Pagamentos deste contrato</p>
                      {row.payments.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Nenhum pagamento detalhado.</p>
                      ) : (
                        <div className="space-y-2">
                          {row.payments.map((p) => (
                            <div
                              key={p.id}
                              className="rounded-md border border-border/40 p-2 text-[11px] space-y-0.5"
                            >
                              <div className="flex justify-between gap-2">
                                <span className="font-medium">{formatDate(p.payment_date)}</span>
                                <span>{formatCurrency(p.amount)}</span>
                              </div>
                              <p className="text-muted-foreground">{p.payment_type || "—"}</p>
                              {p.notes?.trim() ? (
                                <p className="text-foreground/90 border-t border-border/30 pt-1 mt-1">
                                  <span className="text-muted-foreground">Obs:</span> {p.notes}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </TabsContent>
                  <TabsContent value="historico" className="mt-3">
                    {loadingHistory ? (
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando histórico...
                      </p>
                    ) : history ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                          <div className="rounded-lg bg-muted/30 p-2">
                            <p className="text-muted-foreground">Empréstimos</p>
                            <p className="text-lg font-bold text-primary">{history.totalLoans}</p>
                          </div>
                          <div className="rounded-lg bg-muted/30 p-2">
                            <p className="text-muted-foreground">Pagamentos</p>
                            <p className="text-lg font-bold">{history.totalPayments}</p>
                          </div>
                          <div className="rounded-lg bg-muted/30 p-2">
                            <p className="text-muted-foreground">Total pago</p>
                            <p className="text-lg font-bold text-emerald-600">{formatCurrency(history.totalPaid)}</p>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold mb-2">Todos os empréstimos</p>
                          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                            {history.loans.map((loan: Record<string, unknown>) => (
                              <div
                                key={String(loan.id)}
                                className="flex justify-between gap-2 text-[11px] py-1 border-b border-border/20"
                              >
                                <span>{formatCurrency(parseFloat(String(loan.amount || 0)))}</span>
                                <span className="text-muted-foreground">{formatDate(String(loan.due_date || ""))}</span>
                                <span>{statusLabels[String(loan.status)] || String(loan.status)}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold mb-2">Todos os pagamentos</p>
                          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                            {history.payments.map((p: Record<string, unknown>) => (
                              <div
                                key={String(p.id)}
                                className="rounded-md border border-border/30 p-2 text-[11px]"
                              >
                                <div className="flex justify-between">
                                  <span>{formatDate(String(p.payment_date || p.created_at || ""))}</span>
                                  <span className="font-medium">{formatCurrency(parseFloat(String(p.amount || 0)))}</span>
                                </div>
                                <p className="text-muted-foreground">{String(p.payment_type || "")}</p>
                                {String(p.notes || "").trim() ? (
                                  <p className="mt-1 text-foreground/90">Obs: {String(p.notes)}</p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Não foi possível carregar o histórico.</p>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
