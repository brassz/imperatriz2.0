import { Plus, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { fetchFines, fetchFinesTotalForPeriod, fetchFinesByDateRange } from "@/api/fines";
import { useState } from "react";
import { Pagination } from "@/components/Pagination";
import { PAGE_SIZE } from "@/lib/constants";
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

export default function Multas() {
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
    queryKey: ["fines", page, filters],
    queryFn: () => fetchFines(page, filters),
  });
  const { data: periodTotal = 0 } = useQuery({
    queryKey: ["fines-total", filters],
    queryFn: () => fetchFinesTotalForPeriod(appliedFrom, appliedTo),
    enabled: !!appliedFrom && !!appliedTo,
  });
  const fines = data?.data ?? [];
  const totalFines = data?.total ?? 0;

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
      const list = await fetchFinesByDateRange(from, to);
      if (list.length === 0) {
        toast.error("Nenhuma multa no período selecionado");
        return;
      }
      const doc = new jsPDF();
      const m = getPdfMargin();
      const totalAmount = list.reduce((s: number, f: { amount: number }) => s + (f.amount || 0), 0);
      const subtitle = `Período: ${pdfFormatDateBR(from)} a ${pdfFormatDateBR(to)} | Total: ${pdfFormatCurrency(totalAmount)} | ${list.length} multa(s)`;

      let y = addPdfHeader(doc, "Relatório de Multas", subtitle);
      y += 4;

      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("Cliente", m, y);
      doc.text("Valor", 70, y);
      doc.text("Motivo", 110, y);
      doc.text("Data", 160, y);
      y += 6;

      doc.setDrawColor(226, 232, 240);
      doc.line(m, y - 2, 196, y - 2);
      y += 2;

      let pageNum = 1;
      doc.setFont("helvetica", "normal");
      for (const f of list as Array<{ client_name: string; amount: number; reason: string; date: string }>) {
        if (y > 265) {
          addPdfFooter(doc, pageNum);
          doc.addPage();
          pageNum++;
          y = 20;
          doc.setFont("helvetica", "bold");
          doc.text("Cliente", m, y);
          doc.text("Valor", 70, y);
          doc.text("Motivo", 110, y);
          doc.text("Data", 160, y);
          y = 28;
          doc.setFont("helvetica", "normal");
        }
        const reason = String(f.reason || "").slice(0, 35);
        doc.text(String(f.client_name).slice(0, 28), m, y);
        doc.text(pdfFormatCurrency(f.amount), 70, y);
        doc.text(reason, 110, y);
        doc.text(pdfFormatDateBR(f.date), 160, y);
        y += 6;
      }
      addPdfFooter(doc, pageNum);

      doc.save(`multas-${from}-${to}.pdf`);
      toast.success("PDF gerado com sucesso");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar PDF");
    } finally {
      setIsGeneratingPdf(false);
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
          <h1 className="text-xl font-bold">Multas</h1>
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
          <h1 className="text-xl font-bold">Multas</h1>
          <p className="text-sm text-destructive">Erro ao carregar. Verifique a conexão ou se a tabela client_fines existe.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Multas</h1>
          <p className="text-sm text-muted-foreground">Registro de multas por cliente</p>
        </div>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
          <Plus className="h-4 w-4" />
          Nova Multa
        </Button>
      </div>

      <div className="glass-card">
        <div className="p-4 border-b border-border/30 flex flex-wrap items-end gap-4">
          {filters && (
            <div className="w-full sm:w-auto text-sm font-medium text-foreground sm:mr-auto">
              Total do período: <span className="text-destructive">{formatCurrency(periodTotal)}</span>
              <span className="text-muted-foreground font-normal ml-1">
                ({totalFines} multa{totalFines !== 1 ? "s" : ""})
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
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Motivo</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Data</th>
              </tr>
            </thead>
            <tbody>
              {fines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    Nenhuma multa registrada
                  </td>
                </tr>
              ) : (
                fines.map((f: Record<string, unknown>, i: number) => (
                  <motion.tr
                    key={String(f.id)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-border/20 hover:bg-surface-hover transition-colors"
                  >
                    <td className="p-4 text-sm font-medium text-foreground">{String(f.client_name)}</td>
                    <td className="p-4 text-sm text-destructive font-medium">{formatCurrency(Number(f.amount))}</td>
                    <td className="p-4 text-sm text-muted-foreground">{String(f.reason)}</td>
                    <td className="p-4 text-sm text-muted-foreground">{formatDate(String(f.date))}</td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={totalFines} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>
    </div>
  );
}
