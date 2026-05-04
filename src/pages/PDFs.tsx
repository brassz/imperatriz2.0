import {
  FileText,
  Landmark,
  CreditCard,
  AlertTriangle,
  Users,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addPdfHeader, addPdfFooter, formatCurrency, formatDateBR } from "@/lib/pdf-utils";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import { paymentTypeLabel } from "@/lib/payment-type-label";
import {
  fetchLoansByDateRange,
  fetchPaidLoansByDateRange,
  fetchOverdueLoans,
} from "@/api/loans";
import { fetchPaymentsByDateRange } from "@/api/payments";
import { fetchFinesByDateRange } from "@/api/fines";
import { fetchClientsForPdf } from "@/api/clients";

function toInputDate(d: Date) {
  return d.toISOString().split("T")[0];
}

const pdfCards = [
  { id: "emprestimos", icon: Landmark, title: "Empréstimos", desc: "Empréstimos do período (por data de contratação)" },
  { id: "pagamentos", icon: CreditCard, title: "Pagamentos", desc: "Pagamentos recebidos no período" },
  { id: "multas", icon: AlertTriangle, title: "Multas", desc: "Multas aplicadas no período" },
  { id: "clientes", icon: Users, title: "Clientes", desc: "Clientes cadastrados no período" },
  { id: "quitados", icon: CheckCircle, title: "Empréstimos Quitados", desc: "Empréstimos quitados no período" },
  { id: "vencidos", icon: XCircle, title: "Empréstimos Vencidos", desc: "Empréstimos vencidos (situação atual)" },
] as const;

type PdfType = (typeof pdfCards)[number]["id"];

const now = new Date();
const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

export default function PDFs() {
  const [modalOpen, setModalOpen] = useState(false);
  const [activeType, setActiveType] = useState<PdfType | null>(null);
  const [dateFrom, setDateFrom] = useState(toInputDate(firstDay));
  const [dateTo, setDateTo] = useState(toInputDate(lastDay));
  const [isGenerating, setIsGenerating] = useState(false);

  const openModal = (type: PdfType) => {
    setActiveType(type);
    setDateFrom(toInputDate(firstDay));
    setDateTo(toInputDate(lastDay));
    setModalOpen(true);
  };

  const generatePdf = async () => {
    if (!activeType) return;
    if (activeType !== "vencidos") {
      if (!dateFrom || !dateTo) {
        toast.error("Selecione o período");
        return;
      }
      if (dateFrom > dateTo) {
        toast.error("Data de deve ser anterior à data até");
        return;
      }
    }

    setIsGenerating(true);
    try {
      const doc = new jsPDF();
      const m = 14;

      if (activeType === "emprestimos") {
        const list = await fetchLoansByDateRange(dateFrom, dateTo);
        if (list.length === 0) {
          toast.error("Nenhum empréstimo no período");
          return;
        }
        const subtitle = `Período: ${formatDateBR(dateFrom)} a ${formatDateBR(dateTo)} | ${list.length} empréstimo(s)`;
        const y = addPdfHeader(doc, "Relatório de Empréstimos", subtitle);
        addTableLoans(doc, list, m, y);
      } else if (activeType === "pagamentos") {
        const list = await fetchPaymentsByDateRange(dateFrom, dateTo);
        if (list.length === 0) {
          toast.error("Nenhum pagamento no período");
          return;
        }
        const total = list.reduce((s, p) => s + p.amount + ((p as { fine_amount?: number }).fine_amount || 0), 0);
        const subtitle = `Período: ${formatDateBR(dateFrom)} a ${formatDateBR(dateTo)} | Total: ${formatCurrency(total)}`;
        let y = addPdfHeader(doc, "Relatório de Pagamentos", subtitle);
        addTablePayments(doc, list as Array<{ client_name: string; amount: number; fine_amount?: number; payment_date: string; payment_type: string; notes: string }>, m, y);
      } else if (activeType === "multas") {
        const list = await fetchFinesByDateRange(dateFrom, dateTo);
        if (list.length === 0) {
          toast.error("Nenhuma multa no período");
          return;
        }
        const total = list.reduce((s, f) => s + (f.amount || 0), 0);
        const subtitle = `Período: ${formatDateBR(dateFrom)} a ${formatDateBR(dateTo)} | Total: ${formatCurrency(total)}`;
        let y = addPdfHeader(doc, "Relatório de Multas", subtitle);
        addTableFines(doc, list as Array<{ client_name: string; amount: number; reason: string; date: string }>, m, y);
      } else if (activeType === "clientes") {
        const list = await fetchClientsForPdf(dateFrom, dateTo);
        if (list.length === 0) {
          toast.error("Nenhum cliente no período");
          return;
        }
        const subtitle = `Período: ${formatDateBR(dateFrom)} a ${formatDateBR(dateTo)} | ${list.length} cliente(s)`;
        let y = addPdfHeader(doc, "Relatório de Clientes", subtitle);
        addTableClients(doc, list as Array<{ name: string; cpf: string; phone: string; email: string; created_at: string }>, m, y);
      } else if (activeType === "quitados") {
        const list = await fetchPaidLoansByDateRange(dateFrom, dateTo);
        if (list.length === 0) {
          toast.error("Nenhum empréstimo quitado no período");
          return;
        }
        const subtitle = `Período: ${formatDateBR(dateFrom)} a ${formatDateBR(dateTo)} | ${list.length} quitado(s)`;
        let y = addPdfHeader(doc, "Empréstimos Quitados", subtitle);
        addTableLoans(doc, list, m, y);
      } else if (activeType === "vencidos") {
        const list = await fetchOverdueLoans();
        if (list.length === 0) {
          toast.error("Nenhum empréstimo vencido");
          return;
        }
        const subtitle = `Situação atual | ${list.length} vencido(s)`;
        let y = addPdfHeader(doc, "Empréstimos Vencidos", subtitle);
        addTableLoans(doc, list, m, y);
      }
      const name = pdfCards.find((c) => c.id === activeType)?.title || "relatorio";
      doc.save(`${name.toLowerCase().replace(/\s/g, "-")}-${dateFrom}-${dateTo}.pdf`);
      toast.success("PDF gerado");
      setModalOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar PDF");
    } finally {
      setIsGenerating(false);
    }
  };

  const card = activeType ? pdfCards.find((c) => c.id === activeType) : null;
  const needsPeriod = activeType !== "vencidos";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">PDFs</h1>
        <p className="text-sm text-muted-foreground">Geração de relatórios em PDF por período</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {pdfCards.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            onClick={() => openModal(c.id)}
            className="glass-card p-5 hover:border-primary/25 transition-colors cursor-pointer group"
          >
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
              <c.icon className="h-5 w-5 text-primary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">{c.title}</h3>
            <p className="text-xs text-muted-foreground">{c.desc}</p>
          </motion.div>
        ))}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{card?.title}</DialogTitle>
            <DialogDescription>{card?.desc}</DialogDescription>
          </DialogHeader>
          {needsPeriod && (
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="grid gap-2">
                <Label>De</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Até</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          )}
          {!needsPeriod && (
            <p className="text-sm text-muted-foreground py-2">
              Este relatório mostra a situação atual dos empréstimos vencidos.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={generatePdf} disabled={isGenerating}>
              {isGenerating ? "Gerando..." : "Gerar PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function addTableLoans(
  doc: jsPDF,
  list: Array<{ client_name: string; amount: number; interest_rate: number; loan_date: string; due_date: string; status: string }>,
  m: number,
  startY: number
): number {
  let y = startY + 4;
  let pageNum = 1;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Cliente", m, y);
  doc.text("Valor", 60, y);
  doc.text("Juros", 90, y);
  doc.text("Contrato", 110, y);
  doc.text("Venc.", 140, y);
  doc.text("Status", 165, y);
  y += 6;
  doc.setDrawColor(226, 232, 240);
  doc.line(m, y - 2, 196, y - 2);
  y += 2;
  doc.setFont("helvetica", "normal");
  for (const l of list) {
    if (y > 265) {
      addPdfFooter(doc, pageNum);
      doc.addPage();
      pageNum++;
      y = 20;
    }
    doc.text(String(l.client_name).slice(0, 18), m, y);
    doc.text(formatCurrency(l.amount), 60, y);
    doc.text(`${l.interest_rate}%`, 90, y);
    doc.text(formatDateBR(l.loan_date), 110, y);
    doc.text(formatDateBR(l.due_date), 140, y);
    doc.text(l.status === "paid" ? "Quitado" : l.status === "overdue" ? "Vencido" : "Ativo", 165, y);
    y += 6;
  }
  addPdfFooter(doc, pageNum);
  return y;
}

function addTablePayments(
  doc: jsPDF,
  list: Array<{ client_name: string; amount: number; fine_amount?: number; payment_date: string; payment_type: string; notes: string }>,
  m: number,
  startY: number
): number {
  let y = startY + 4;
  let pageNum = 1;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Cliente", m, y);
  doc.text("Valor", 70, y);
  doc.text("Data", 100, y);
  doc.text("Tipo", 130, y);
  doc.text("Obs.", 160, y);
  y += 6;
  doc.setDrawColor(226, 232, 240);
  doc.line(m, y - 2, 196, y - 2);
  y += 2;
  doc.setFont("helvetica", "normal");
  for (const p of list) {
    if (y > 265) {
      addPdfFooter(doc, pageNum);
      doc.addPage();
      pageNum++;
      y = 20;
    }
    const amt = p.amount + (p.fine_amount || 0);
    doc.text(String(p.client_name).slice(0, 18), m, y);
    doc.text(formatCurrency(amt), 70, y);
    doc.text(formatDateBR(p.payment_date), 100, y);
    doc.text(String(paymentTypeLabel(p.payment_type)).slice(0, 10), 130, y);
    doc.text(String(p.notes || "").slice(0, 12), 160, y);
    y += 6;
  }
  addPdfFooter(doc, pageNum);
  return y;
}

function addTableFines(
  doc: jsPDF,
  list: Array<{ client_name: string; amount: number; reason: string; date: string }>,
  m: number,
  startY: number
): number {
  let y = startY + 4;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Cliente", m, y);
  doc.text("Valor", 70, y);
  doc.text("Motivo", 110, y);
  doc.text("Data", 165, y);
  y += 6;
  doc.setDrawColor(226, 232, 240);
  doc.line(m, y - 2, 196, y - 2);
  y += 2;
  doc.setFont("helvetica", "normal");
  let pageNum = 1;
  for (const f of list) {
    if (y > 265) {
      addPdfFooter(doc, pageNum);
      doc.addPage();
      pageNum++;
      y = 20;
    }
    doc.text(String(f.client_name).slice(0, 22), m, y);
    doc.text(formatCurrency(f.amount), 70, y);
    doc.text(String(f.reason).slice(0, 28), 110, y);
    doc.text(formatDateBR(f.date), 165, y);
    y += 6;
  }
  addPdfFooter(doc, pageNum);
  return y;
}

function addTableClients(
  doc: jsPDF,
  list: Array<{ name: string; cpf: string; phone: string; email: string; created_at: string }>,
  m: number,
  startY: number
): number {
  let y = startY + 4;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Nome", m, y);
  doc.text("CPF", 65, y);
  doc.text("Telefone", 105, y);
  doc.text("Email", 145, y);
  doc.text("Cadastro", 175, y);
  y += 6;
  doc.setDrawColor(226, 232, 240);
  doc.line(m, y - 2, 196, y - 2);
  y += 2;
  doc.setFont("helvetica", "normal");
  let pageNum = 1;
  for (const c of list) {
    if (y > 265) {
      addPdfFooter(doc, pageNum);
      doc.addPage();
      pageNum++;
      y = 20;
    }
    doc.text(String(c.name).slice(0, 16), m, y);
    doc.text(String(c.cpf).slice(0, 14), 65, y);
    doc.text(String(c.phone).slice(0, 12), 105, y);
    doc.text(String(c.email).slice(0, 18), 145, y);
    doc.text(formatDateBR(c.created_at), 175, y);
    y += 6;
  }
  addPdfFooter(doc, pageNum);
  return y;
}
