import { motion } from "framer-motion";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPayments, fetchPaymentsByDateRange, fetchPaymentsTotalForPeriod } from "@/api/payments";
import { Pagination } from "@/components/Pagination";
import { PAGE_SIZE } from "@/lib/constants";
import { paymentTypeLabel } from "@/lib/payment-type-label";
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
import { supabase } from "@/lib/supabase";
import { effectiveLoanPrincipal, INTEREST_ONLY_TYPES } from "@/api/loan-calc";

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

      // Rateio por pagamento (capital x juros) com base no saldo devedor do empréstimo.
      // Regras são as mesmas do cálculo do sistema (ver `amortizationWaterfall`).
      const loanIds = Array.from(new Set(list.map((p: { loan_id: string }) => String(p.loan_id || "")).filter(Boolean)));
      const { data: loansData, error: loansErr } = await supabase
        .from("loans")
        .select("id, amount, original_amount, interest_rate")
        .in("id", loanIds);
      if (loansErr) throw loansErr;

      const loanById = new Map<string, { amount?: unknown; original_amount?: unknown; interest_rate?: unknown }>();
      (loansData || []).forEach((l: any) => loanById.set(String(l.id), l));

      // Pagamentos que abatem só capital.
      const PRINCIPAL_ONLY_TYPES = new Set(["capital_renewal"]);

      const splitByPaymentId = new Map<string, { juros: number; capital: number }>();
      for (const loanId of loanIds) {
        const loan = loanById.get(loanId);
        const originalCapital = effectiveLoanPrincipal(loan || {});
        let rate = parseFloat(String(loan?.interest_rate ?? 0));
        if (rate > 100) rate = rate / 100;

        let currentCapital = Math.max(0, originalCapital);
        const paymentsForLoan = (list as any[])
          .filter((p) => String(p.loan_id || "") === loanId)
          .slice()
          .sort((a, b) => {
            const da = String(a.payment_date || "");
            const db = String(b.payment_date || "");
            if (da !== db) return da.localeCompare(db);
            return String(a.id || "").localeCompare(String(b.id || ""));
          });

        for (const p of paymentsForLoan) {
          const pid = String(p.id || "");
          const amt = parseFloat(String(p.amount || 0));
          const type = String(p.payment_type || "");

          if (!pid) continue;
          if (!(amt > 0)) {
            splitByPaymentId.set(pid, { juros: 0, capital: 0 });
            continue;
          }

          // Só juros
          if (INTEREST_ONLY_TYPES.includes(type)) {
            splitByPaymentId.set(pid, { juros: amt, capital: 0 });
            continue;
          }
          // Só capital
          if (PRINCIPAL_ONLY_TYPES.has(type)) {
            splitByPaymentId.set(pid, { juros: 0, capital: amt });
            currentCapital = Math.max(0, currentCapital - amt);
            continue;
          }

          // Regra padrão: paga juros do saldo e o restante abate capital
          const currentInterest = currentCapital * (rate / 100);
          if (amt > currentInterest) {
            const juros = currentInterest;
            const capital = amt - currentInterest;
            splitByPaymentId.set(pid, { juros, capital });
            currentCapital = Math.max(0, currentCapital - capital);
          } else {
            splitByPaymentId.set(pid, { juros: amt, capital: 0 });
          }
        }
      }

      const doc = new jsPDF();
      const m = getPdfMargin();
      const totalAmount = list.reduce(
        (s: number, p: { amount: number; fine_amount?: number }) =>
          s + (p.amount || 0) + ((p as { fine_amount?: number }).fine_amount || 0),
        0
      );
      const totalFine = list.reduce((s: number, p: { fine_amount?: number }) => s + (p.fine_amount || 0), 0);
      const totalJuros = list.reduce((s: number, p: any) => s + (splitByPaymentId.get(String(p.id))?.juros || 0), 0);
      const totalCapital = list.reduce((s: number, p: any) => s + (splitByPaymentId.get(String(p.id))?.capital || 0), 0);

      const subtitle = `Período: ${pdfFormatDateBR(from)} a ${pdfFormatDateBR(to)} | Total: ${pdfFormatCurrency(totalAmount)} | Capital: ${pdfFormatCurrency(totalCapital)} | Juros: ${pdfFormatCurrency(totalJuros)} | Multas: ${pdfFormatCurrency(totalFine)} | ${list.length} pagamento(s)`;

      let y = addPdfHeader(doc, "Relatório de Pagamentos", subtitle);
      y += 4;

      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("Cliente", m, y);
      doc.text("Total", 70, y);
      doc.text("Capital", 95, y);
      doc.text("Juros", 120, y);
      doc.text("Multa", 142, y);
      doc.text("Data", 160, y);
      y += 6;

      doc.setDrawColor(226, 232, 240);
      doc.line(m, y - 2, 196, y - 2);
      y += 2;

      let pageNum = 1;
      doc.setFont("helvetica", "normal");
      for (const p of list as Array<{ id: string; client_name: string; amount: number; fine_amount?: number; payment_date: string; payment_type: string; notes: string }>) {
        if (y > 265) {
          addPdfFooter(doc, pageNum);
          doc.addPage();
          pageNum++;
          y = 20;
          doc.setFont("helvetica", "bold");
          doc.text("Cliente", m, y);
          doc.text("Total", 70, y);
          doc.text("Capital", 95, y);
          doc.text("Juros", 120, y);
          doc.text("Multa", 142, y);
          doc.text("Data", 160, y);
          y = 28;
          doc.setFont("helvetica", "normal");
        }
        const fine = (p.fine_amount as number) || 0;
        const amt = p.amount + fine;
        const split = splitByPaymentId.get(String(p.id)) || { juros: 0, capital: 0 };
        doc.text(String(p.client_name).slice(0, 22), m, y);
        doc.text(pdfFormatCurrency(amt), 70, y);
        doc.text(pdfFormatCurrency(split.capital), 95, y);
        doc.text(pdfFormatCurrency(split.juros), 120, y);
        doc.text(pdfFormatCurrency(fine), 142, y);
        doc.text(pdfFormatDateBR(p.payment_date), 160, y);
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
                        {paymentTypeLabel(String(p.payment_type))}
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
