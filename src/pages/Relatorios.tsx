import {
  Landmark,
  CreditCard,
  Receipt,
  Wallet,
  FileDown,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { fetchDashboardChartData } from "@/api/dashboard";
import {
  buildGrowthReport,
  buildGrowthSummaries,
  formatGrowthPct,
  GROWTH_METRICS,
  type GrowthMetricKey,
} from "@/api/growth-report";
import { addPdfHeader, addPdfFooter, formatCurrency } from "@/lib/pdf-utils";
import { useCompany } from "@/contexts/CompanyContext";
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

function GrowthBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (value > 0) {
    return (
      <Badge variant="outline" className="text-xs gap-0.5 text-emerald-600 border-emerald-200">
        <TrendingUp className="h-3 w-3" />
        {formatGrowthPct(value)}
      </Badge>
    );
  }
  if (value < 0) {
    return (
      <Badge variant="outline" className="text-xs gap-0.5 text-destructive border-destructive/30">
        <TrendingDown className="h-3 w-3" />
        {formatGrowthPct(value)}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs gap-0.5">
      <Minus className="h-3 w-3" />
      0%
    </Badge>
  );
}

function GrowthMetricPreviewChart({
  metric,
  data,
}: {
  metric: GrowthMetricKey;
  data: Array<Record<string, string | number | null>>;
}) {
  const label = GROWTH_METRICS.find((m) => m.key === metric)?.label ?? metric;
  return (
    <ChartContainer
      config={{
        valor: { label: "Valor", color: "hsl(var(--primary))" },
        pct: { label: "Crescimento %", color: "hsl(var(--success))" },
      }}
      className="h-full w-full"
    >
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="mes" tickLine={false} axisLine={false} />
        <YAxis yAxisId="left" tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
        <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(v, name) =>
                String(name).includes("pct") ? `${Number(v).toFixed(1)}%` : formatMoney(Number(v))
              }
            />
          }
        />
        <Bar yAxisId="left" dataKey={`${metric}_valor`} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name={label} />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey={`${metric}_pct`}
          stroke="hsl(var(--success))"
          strokeWidth={2}
          dot={{ r: 4 }}
          name="vs mês ant."
        />
      </ComposedChart>
    </ChartContainer>
  );
}

export default function Relatorios() {
  const { companyName } = useCompany();
  const [months, setMonths] = useState(6);
  const [activeTab, setActiveTab] = useState("graficos");
  const [metricFilter, setMetricFilter] = useState<GrowthMetricKey | "all">("all");
  const [previewMetric, setPreviewMetric] = useState<GrowthMetricKey | null>(null);

  const { data: chartData = [], isLoading, error } = useQuery({
    queryKey: ["reports-chart-data", months],
    queryFn: () => fetchDashboardChartData(months),
  });

  const growthRows = useMemo(() => buildGrowthReport(chartData), [chartData]);
  const growthSummaries = useMemo(() => buildGrowthSummaries(growthRows), [growthRows]);

  const visibleMetrics = useMemo(
    () => (metricFilter === "all" ? GROWTH_METRICS : GROWTH_METRICS.filter((m) => m.key === metricFilter)),
    [metricFilter],
  );

  const growthChartData = useMemo(
    () =>
      growthRows.map((row) => {
        const out: Record<string, string | number | null> = { mes: row.mes };
        for (const { key } of GROWTH_METRICS) {
          out[`${key}_valor`] = row.values[key];
          out[`${key}_pct`] = row.changes[key];
        }
        return out;
      }),
    [growthRows],
  );

  const exportChartPdf = (chart: (typeof CHARTS)[number]) => {
    const doc = new jsPDF();
    const m = 14;
    const subtitle = `${companyName} · Últimos ${months} meses | Gerado em ${new Date().toLocaleDateString("pt-BR")}`;
    let y = addPdfHeader(doc, chart.title, subtitle);
    y += 6;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    const cols =
      chart.id === "fluxo"
        ? ["Mês", "Pagamentos", "Despesas", "Fluxo"]
        : ["Mês", chart.title.replace(" por Mês", "")];
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
    doc.save(`relatorio-${chart.id}.pdf`);
    toast.success("PDF gerado");
  };

  const exportGrowthPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const m = 14;
    const pageW = 297;
    const subtitle = `${companyName} · Últimos ${months} meses · Comparativo mês a mês | Gerado em ${new Date().toLocaleDateString("pt-BR")}`;
    let y = addPdfHeader(doc, "Relatório de Crescimento da Empresa", subtitle);
    y += 4;

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Resumo por indicador", m, y);
    y += 6;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");

    for (const s of growthSummaries) {
      if (y > 175) {
        addPdfFooter(doc, 1);
        doc.addPage();
        y = 20;
      }
      const growthText = s.avgGrowthPct !== null ? ` · Média MoM: ${formatGrowthPct(s.avgGrowthPct)}` : "";
      doc.text(
        `${s.label}: Total ${formatCurrency(s.total)} · Média/mês ${formatCurrency(s.average)}${growthText}`,
        m,
        y,
      );
      y += 5;
    }

    y += 4;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Detalhamento mês a mês", m, y);
    y += 6;

    const headers = ["Mês", ...GROWTH_METRICS.flatMap((g) => [g.label, "Δ%"])];
    const colCount = headers.length;
    const usable = pageW - 2 * m;
    const colW = usable / colCount;

    doc.setFontSize(7);
    headers.forEach((h, i) => doc.text(h.slice(0, 14), m + i * colW, y));
    y += 4;
    doc.setDrawColor(226, 232, 240);
    doc.line(m, y, pageW - m, y);
    y += 4;
    doc.setFont("helvetica", "normal");

    for (const row of growthRows) {
      if (y > 185) {
        addPdfFooter(doc, 1);
        doc.addPage();
        y = 20;
      }
      let x = m;
      doc.text(row.mes, x, y);
      x += colW;
      for (const { key } of GROWTH_METRICS) {
        doc.text(formatCurrency(row.values[key]), x, y);
        x += colW;
        doc.text(formatGrowthPct(row.changes[key]), x, y);
        x += colW;
      }
      y += 5;
    }

    addPdfFooter(doc, 1);
    doc.save("relatorio-crescimento-empresa.pdf");
    toast.success("PDF de crescimento gerado");
  };

  if (isLoading) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-xl font-bold text-foreground">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </motion.div>
        <motion.div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <motion.div key={i} className="glass-card p-5 animate-pulse h-72 rounded-xl" />
          ))}
        </motion.div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold text-foreground">Relatórios</h1>
        <p className="text-sm text-destructive">Erro ao carregar dados. Tente novamente.</p>
      </div>
    );
  }

  const periodFilter = (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex flex-wrap items-center gap-2"
    >
      <span className="text-xs text-muted-foreground">Período:</span>
      <motion.div className="flex gap-1" layout>
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
      </motion.div>
    </motion.div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
          <h1 className="text-xl font-bold text-foreground">Relatórios</h1>
          <p className="text-sm text-muted-foreground">
            Gráficos, crescimento mês a mês e exportação em PDF
          </p>
        </motion.div>
        {periodFilter}
      </motion.div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="graficos">Gráficos</TabsTrigger>
          <TabsTrigger value="crescimento">Crescimento mês a mês</TabsTrigger>
        </TabsList>

        <TabsContent value="graficos" className="mt-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.05 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-4"
          >
            {CHARTS.map((chart, i) => (
              <motion.div
                key={chart.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="glass-card p-5"
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center justify-between mb-4"
                >
                  <motion.div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <chart.icon className="h-4 w-4 text-primary" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">{chart.title}</h3>
                  </motion.div>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportChartPdf(chart)}>
                    <FileDown className="h-3.5 w-3.5" />
                    PDF
                  </Button>
                </motion.div>
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
          </motion.div>
        </TabsContent>

        <TabsContent value="crescimento" className="mt-4 space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Indicador:</span>
              <Select value={metricFilter} onValueChange={(v) => setMetricFilter(v as GrowthMetricKey | "all")}>
                <SelectTrigger className="w-[200px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os indicadores</SelectItem>
                  {GROWTH_METRICS.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="default" size="sm" className="gap-1.5" onClick={exportGrowthPdf}>
              <FileDown className="h-3.5 w-3.5" />
              Exportar PDF de crescimento
            </Button>
          </motion.div>

          <div className="flex flex-wrap justify-center gap-3">
            {growthSummaries
              .filter((s) => metricFilter === "all" || s.metric === metricFilter)
              .map((s, i) => (
                <motion.button
                  key={s.metric}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => setPreviewMetric(s.metric)}
                  className="glass-card w-full sm:w-56 p-4 rounded-xl text-center cursor-pointer transition-all hover:ring-2 hover:ring-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold mt-1">{formatMoney(s.total)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Média/mês: {formatMoney(s.average)}
                    {s.avgGrowthPct !== null && (
                      <span className="block sm:inline sm:ml-2 mt-0.5 sm:mt-0">
                        MoM médio:{" "}
                        <span className={s.avgGrowthPct >= 0 ? "text-emerald-600" : "text-destructive"}>
                          {formatGrowthPct(s.avgGrowthPct)}
                        </span>
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Melhor: {s.bestMonth} ({formatMoney(s.bestValue)})
                  </p>
                  <p className="text-[10px] text-primary mt-2">Clique para ver gráfico</p>
                </motion.button>
              ))}
          </div>

          <Dialog open={previewMetric !== null} onOpenChange={(open) => !open && setPreviewMetric(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {previewMetric
                    ? GROWTH_METRICS.find((m) => m.key === previewMetric)?.label
                    : "Preview"}
                </DialogTitle>
                <DialogDescription>
                  Últimos {months} meses — valor mensal e variação em relação ao mês anterior
                </DialogDescription>
              </DialogHeader>
              {previewMetric && (
                <div className="h-72 w-full">
                  <GrowthMetricPreviewChart metric={previewMetric} data={growthChartData} />
                </div>
              )}
            </DialogContent>
          </Dialog>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card rounded-xl overflow-x-auto"
          >
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="p-3 sticky left-0 bg-muted/40">Mês</th>
                  {visibleMetrics.map((m) => (
                    <th key={m.key} colSpan={2} className="p-3 text-center border-l border-border/50">
                      {m.label}
                    </th>
                  ))}
                </tr>
                <tr className="border-b text-[10px] text-muted-foreground">
                  <th className="p-2 sticky left-0 bg-card" />
                  {visibleMetrics.map((m) => (
                    <Fragment key={m.key}>
                      <th className="p-2 text-right font-normal border-l border-border/50">
                        Valor
                      </th>
                      <th className="p-2 text-center font-normal">
                        vs mês ant.
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {growthRows.map((row, ri) => (
                  <motion.tr
                    key={row.mes}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: ri * 0.03 }}
                    className="border-b border-border/50 hover:bg-muted/20"
                  >
                    <td className="p-3 font-medium sticky left-0 bg-card">{row.mes}</td>
                    {visibleMetrics.map((m) => (
                      <Fragment key={m.key}>
                        <td className="p-3 text-right border-l border-border/50">
                          {formatMoney(row.values[m.key])}
                        </td>
                        <td className="p-3 text-center">
                          <GrowthBadge value={row.changes[m.key]} />
                        </td>
                      </Fragment>
                    ))}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
