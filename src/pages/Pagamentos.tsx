import { motion } from "framer-motion";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPayments, fetchPaymentsByDateRange, fetchPaymentsTotalForPeriod } from "@/api/payments";
import { Pagination } from "@/components/Pagination";
import { PAGE_SIZE } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileDown } from "lucide-react";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import {
  addPdfHeader,
  addPdfFooter,
  getPdfMargin,
  formatDateBR as pdfFormatDateBR,
  formatCurrency as pdfFormatCurrency,
} from "@/lib/pdf-utils";

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toInputDate(d: Date) {
  return d.toISOString().split("T")[0];
}

function formatDateBR(s: string) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("T")[0].split("-");
  return `${d}/${m}/${y}`;
}

export default function Pagamentos() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [page, setPage] = useState(1);
  const [dateFromInput, setDateFromInput] = useState(toInputDate(firstDay));
  const [dateToInput, setDateToInput] = useState(toInputDate(lastDay));
  const [appliedFrom, setAppliedFrom] = useState(toInputDate(firstDay));
  const [appliedTo, setAppliedTo] = useState(toInputDate(lastDay));
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const filters = appliedFrom && appliedTo ? { dateFrom: appliedFrom, dateTo: appliedTo } : undefined;

  const handleApplyFilter = () => {
    if (!dateFromInput || !dateToInput) return;
    if (dateFromInput > dateToInput) {
      toast.error("Data de deve ser anterior à data até");
      return;
    }
    setAppliedFrom(dateFromInput);
    setAppliedTo(dateToInput);
    setPage(1);
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["payments", page, filters],
    queryFn: () => fetchPayments(page, filters),
  });
  const { data: periodTotal = 0 } = useQuery({
    queryKey: ["payments-total", filters],
    queryFn: () => fetchPaymentsTotalForPeriod(appliedFrom, appliedTo),
    enabled: !!appliedFrom && !!appliedTo,
  });
  const payments = data?.data ?? [];
  const totalPayments = data?.total ?? 0;

  const handleGeneratePdf = async () => {
    const from = dateFromInput;
    const to = dateToInput;
    if (!from || !to) {
      toast.error("Selecione o período (data de e data até)");
      return;
    }
    if (from > to) {
      toast.error("Data de deve ser anterior à data até");
      return;
    }
    setIsGeneratingPdf(true);
    try {
      const list = await fetchPaymentsByDateRange(from, to);
      if (list.length === 0) {
        toast.error("Nenhum pagamento no período selecionado");
        return;
      }
      const doc = new jsPDF();
      const m = getPdfMargin();
      const totalAmount = list.reduce((s: number, p: { amount: number; fine_amount?: number }) => s + (p.amount || 0) + ((p as { fine_amount?: number }).fine_amount || 0), 0);
      const subtitle = `Período: ${pdfFormatDateBR(from)} a ${pdfFormatDateBR(to)} | Total: ${pdfFormatCurrency(totalAmount)} | ${list.length} pagamento(s)`;

      let y = addPdfHeader(doc, "Relatório de Pagamentos", subtitle);
      y += 4;

      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("Cliente", m, y);
      doc.text("Valor", 70, y);
      doc.text("Data", 100, y);
      doc.text("Tipo", 130, y);
      doc.text("Observações", 160, y);
      y += 6;

      doc.setDrawColor(226, 232, 240);
      doc.line(m, y - 2, 196, y - 2);
      y += 2;

      let pageNum = 1;
      doc.setFont("helvetica", "normal");
      for (const p of list as Array<{ client_name: string; amount: number; fine_amount?: number; payment_date: string; payment_type: string; notes: string }>) {
        if (y > 265) {
          addPdfFooter(doc, pageNum);
          doc.addPage();
          pageNum++;
          y = 20;
          doc.setFont("helvetica", "bold");
          doc.text("Cliente", m, y);
          doc.text("Valor", 70, y);
          doc.text("Data", 100, y);
          doc.text("Tipo", 130, y);
          doc.text("Observações", 160, y);
          y = 28;
          doc.setFont("helvetica", "normal");
        }
        const amt = p.amount + ((p.fine_amount as number) || 0);
        const notes = String(p.notes || "").slice(0, 25);
        doc.text(String(p.client_name).slice(0, 22), m, y);
        doc.text(pdfFormatCurrency(amt), 70, y);
        doc.text(pdfFormatDateBR(p.payment_date), 100, y);
        doc.text(String(p.payment_type).slice(0, 12), 130, y);
        doc.text(notes, 160, y);
        y += 6;
      }
      addPdfFooter(doc, pageNum);

      doc.save(`pagamentos-${from}-${to}.pdf`);
      toast.success("PDF gerado com sucesso");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar PDF");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Pagamentos</h1>
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
          <h1 className="text-xl font-bold">Pagamentos</h1>
          <p className="text-sm text-destructive">Erro ao carregar. Verifique a conexão.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Pagamentos</h1>
        <p className="text-sm text-muted-foreground">Histórico de pagamentos recebidos. Para registrar um pagamento, vá em Empréstimos e clique no ícone de pagamentos do empréstimo.</p>
      </div>

      <div className="glass-card">
        <div className="p-4 border-b border-border/30 flex flex-wrap items-end gap-4">
          {filters && (
            <div className="w-full sm:w-auto text-sm font-medium text-foreground sm:mr-auto">
              Total do período: <span className="text-primary">{formatCurrency(periodTotal)}</span>
              <span className="text-muted-foreground font-normal ml-1">
                ({totalPayments} pagamento{totalPayments !== 1 ? "s" : ""})
              </span>
            </div>
          )}
          <div className="grid gap-2">
            <Label className="text-xs">De</Label>
            <Input
              type="date"
              value={dateFromInput}
              onChange={(e) => setDateFromInput(e.target.value)}
              className="h-8 text-sm w-[140px]"
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-xs">Até</Label>
            <Input
              type="date"
              value={dateToInput}
              onChange={(e) => setDateToInput(e.target.value)}
              className="h-8 text-sm w-[140px]"
            />
          </div>
          <Button size="sm" variant="secondary" onClick={handleApplyFilter}>
            Filtrar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleGeneratePdf}
            disabled={isGeneratingPdf || !dateFromInput || !dateToInput}
            className="gap-2"
          >
            <FileDown className="h-4 w-4" />
            {isGeneratingPdf ? "Gerando..." : "Gerar PDF"}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Cliente</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Valor</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Data</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Tipo</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Observações</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    Nenhum pagamento registrado
                  </td>
                </tr>
              ) : (
                payments.map((p: Record<string, unknown>, i: number) => (
                  <motion.tr
                    key={String(p.id)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-border/20 hover:bg-surface-hover transition-colors"
                  >
                    <td className="p-4 text-sm font-medium text-foreground">{String(p.client_name)}</td>
                    <td className="p-4 text-sm text-foreground">{formatCurrency(Number(p.amount))}</td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {String(p.payment_date || "").includes("-")
                        ? String(p.payment_date).split("T")[0].split("-").reverse().join("/")
                        : String(p.payment_date)}
                    </td>
                    <td className="p-4">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
                        {String(p.payment_type)}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">{String(p.notes || "—")}</td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={totalPayments} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>
    </div>
  );
}
