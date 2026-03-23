import { Landmark, CreditCard, Receipt, Wallet, FileDown, AlertTriangle, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ComposedChart,
  Line,
} from "recharts";
import { fetchDashboardChartData, type ChartDataPoint } from "@/api/dashboard";
import { addPdfHeader, addPdfFooter, formatCurrency } from "@/lib/pdf-utils";
import { jsPDF } from "jspdf";
import { toast } from "sonner";

const CHARTS = [
  { id: "emprestimos", icon: Landmark, title: "Empréstimos por Mês", dataKey: "emprestimos" as const, color: "hsl(var(--primary))" },
  { id: "pagamentos", icon: CreditCard, title: "Pagamentos por Mês", dataKey: "pagamentos" as const, color: "hsl(var(--success))" },
  { id: "despesas", icon: Receipt, title: "Despesas por Mês", dataKey: "despesas" as const, color: "hsl(var(--destructive))" },
  { id: "fluxo", icon: Wallet, title: "Fluxo de Caixa (Pagamentos - Despesas)", dataKey: "fluxo" as const, color: "hsl(var(--primary))" },
  { id: "multas", icon: AlertTriangle, title: "Multas por Mês", dataKey: "multas" as const, color: "hsl(var(--destructive))" },
  { id: "juros", icon: TrendingUp, title: "Lucro por Juros por Mês", dataKey: "juros" as const, color: "hsl(var(--success))" },
];

function formatMoney(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Relatorios() {
  const [months, setMonths] = useState(6);

  const { data: chartData = [], isLoading, error } = useQuery({
    queryKey: ["reports-chart-data", months],
    queryFn: () => fetchDashboardChartData(months),
  });

  const exportChartPdf = (chart: (typeof CHARTS)[number]) => {
    const doc = new jsPDF();
    const m = 14;

    const subtitle = `Últimos ${months} meses | Gerado em ${new Date().toLocaleDateString("pt-BR")}`;
    let y = addPdfHeader(doc, chart.title, subtitle);
    y += 6;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    const cols = chart.id === "fluxo"
      ? ["Mês", "Pagamentos", "Despesas", "Fluxo"]
      : chart.id === "emprestimos"
        ? ["Mês", "Empréstimos"]
        : chart.id === "pagamentos"
          ? ["Mês", "Pagamentos"]
          : chart.id === "despesas"
            ? ["Mês", "Despesas"]
            : chart.id === "multas"
              ? ["Mês", "Multas"]
              : chart.id === "juros"
                ? ["Mês", "Lucro Juros"]
                : ["Mês", chart.title];
    const colWidth = (210 - 2 * m) / cols.length;
    cols.forEach((c, i) => doc.text(c, m + i * colWidth, y));
    y += 6;
    doc.setDrawColor(226, 232, 240);
    doc.line(m, y - 2, 196, y - 2);
    y += 4;
    doc.setFont("helvetica", "normal");

    for (const row of chartData) {
      if (y > 265) {
        addPdfFooter(doc, 1);
        doc.addPage();
        y = 20;
      }
      if (chart.id === "fluxo") {
        doc.text(row.mes, m, y);
        doc.text(formatCurrency(row.pagamentos), m + colWidth, y);
        doc.text(formatCurrency(row.despesas), m + 2 * colWidth, y);
        doc.text(formatCurrency(row.fluxo), m + 3 * colWidth, y);
      } else {
        doc.text(row.mes, m, y);
        doc.text(formatCurrency(row[chart.dataKey]), m + colWidth, y);
      }
      y += 6;
    }
    addPdfFooter(doc, 1);
    const name = chart.title.toLowerCase().replace(/\s+/g, "-");
    doc.save(`relatorio-${name}.pdf`);
    toast.success("PDF gerado");
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Gráficos e exportação em PDF</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="glass-card p-5 animate-pulse h-72 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Relatórios</h1>
          <p className="text-sm text-destructive">Erro ao carregar dados. Tente novamente.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Gráficos e exportação em PDF com os dados</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Período:</span>
          <div className="flex gap-1">
            {[3, 6, 12].map((n) => (
              <Button
                key={n}
                variant={months === n ? "default" : "outline"}
                size="sm"
                onClick={() => setMonths(n)}
              >
                {n} meses
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {CHARTS.map((chart, i) => (
          <motion.div
            key={chart.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="glass-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <chart.icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">{chart.title}</h3>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportChartPdf(chart)}>
                <FileDown className="h-3.5 w-3.5" />
                PDF
              </Button>
            </div>
            <div className="h-56">
              {chart.id === "fluxo" ? (
                <ChartContainer
                  config={{
                    pagamentos: { label: "Pagamentos", color: "hsl(var(--success))" },
                    despesas: { label: "Despesas", color: "hsl(var(--destructive))" },
                    fluxo: { label: "Fluxo", color: "hsl(var(--primary))" },
                  }}
                  className="h-full w-full"
                >
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="mes" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
                    <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatMoney(Number(v))} />} />
                    <Bar dataKey="pagamentos" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="despesas" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="fluxo" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ChartContainer>
              ) : (
                <ChartContainer
                  config={{ [chart.dataKey]: { label: chart.title, color: chart.color } }}
                  className="h-full w-full"
                >
                  {chart.id === "emprestimos" || chart.id === "juros" ? (
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="mes" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
                      <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatMoney(Number(v))} />} />
                      <Area
                        type="monotone"
                        dataKey={chart.dataKey}
                        stroke={chart.color}
                        fill={chart.color}
                        fillOpacity={0.3}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  ) : (
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="mes" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
                      <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatMoney(Number(v))} />} />
                      <Bar dataKey={chart.dataKey} fill={chart.color} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  )}
                </ChartContainer>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
