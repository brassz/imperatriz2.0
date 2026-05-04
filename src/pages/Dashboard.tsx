import {
  DollarSign, Users, AlertTriangle,
  Receipt, Landmark, Percent, CreditCard, CheckCircle, Activity
} from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboardMetrics, fetchDashboardChartData } from "@/api/dashboard";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Dashboard() {
  const { data: metrics, isLoading, error } = useQuery({
    queryKey: ["dashboard-metrics"],
    queryFn: fetchDashboardMetrics,
  });

  const { data: chartData = [] } = useQuery({
    queryKey: ["dashboard-chart-data"],
    queryFn: () => fetchDashboardChartData(6),
  });

  const [recentActivity, setRecentActivity] = useState<{ text: string; time: string; color: string }[]>([]);

  useEffect(() => {
    async function loadRecent() {
      try {
        const [loansRes, paymentsRes, clientsRes] = await Promise.all([
        supabase.from("loans").select("created_at, clients(name)").order("created_at", { ascending: false }).limit(2),
        supabase.from("payments").select("created_at, loans(clients(name))").order("created_at", { ascending: false }).limit(2),
        supabase.from("clients").select("name, created_at").order("created_at", { ascending: false }).limit(2),
      ]);

      const items: { text: string; time: string; color: string }[] = [];
      const formatTime = (d: string) => {
        const diff = Date.now() - new Date(d).getTime();
        if (diff < 60000) return "Agora";
        if (diff < 3600000) return `${Math.floor(diff / 60000)} min atrás`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h atrás`;
        return `${Math.floor(diff / 86400000)} dias atrás`;
      };

      (loansRes.data || []).forEach((l: Record<string, unknown>) => {
        const c = l.clients as { name?: string } | null;
        items.push({
          text: `Empréstimo para ${c?.name || "Cliente"}`,
          time: formatTime(String(l.created_at)),
          color: "bg-primary",
        });
      });
      (paymentsRes.data || []).forEach((p: Record<string, unknown>) => {
        const loans = p.loans as { clients?: { name?: string } } | null;
        items.push({
          text: `Pagamento recebido - ${loans?.clients?.name || "Cliente"}`,
          time: formatTime(String(p.created_at)),
          color: "bg-success",
        });
      });
      (clientsRes.data || []).slice(0, 1).forEach((c: Record<string, unknown>) => {
        items.push({
          text: `Novo cliente: ${c.name}`,
          time: formatTime(String(c.created_at)),
          color: "bg-primary",
        });
      });

        setRecentActivity(items.slice(0, 5));
      } catch {
        setRecentActivity([]);
      }
    }
    loadRecent();
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Visão Geral</h1>
          <p className="text-sm text-muted-foreground">Carregando métricas...</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="glass-card p-5 animate-pulse h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Visão Geral</h1>
          <p className="text-sm text-destructive">Erro ao carregar métricas. Verifique a conexão com o banco.</p>
        </div>
      </div>
    );
  }

  const m = metrics || {
    clientsCount: 0,
    totalLoaned: 0,
    jurosRestante: 0,
    totalRestante: 0,
    activeLoans: 0,
    ativosCount: 0,
    partialPaidCount: 0,
    vencidosCount: 0,
    parcelamentosCount: 0,
    paidLoansCount: 0,
    parcelamentosTotal: 0,
    parcelamentosAtrasadosValor: 0,
    paidLoansValor: 0,
    cashBalance: 0,
    vencidosValor: 0,
    totalReceived: 0,
    expensesTotal: 0,
    commissions: 0,
  };

  // Saúde da operação: 0-100 baseado em % vencidos do total a receber
  const totalRestante = (m.totalRestante || 0) + (m.parcelamentosTotal || 0);
  const vencidosValor = (m.vencidosValor || 0) + (m.parcelamentosAtrasadosValor || 0);
  const healthScore = totalRestante > 0
    ? Math.round(100 - (vencidosValor / totalRestante) * 100)
    : 100;
  const clampedScore = Math.max(0, Math.min(100, healthScore));
  const healthStatus =
    clampedScore >= 80 ? { label: "Excelente", color: "text-emerald-600", bg: "bg-emerald-500", bar: "bg-emerald-500" } :
    clampedScore >= 50 ? { label: "Razoável", color: "text-amber-600", bg: "bg-amber-500", bar: "bg-amber-500" } :
    { label: "Prejuízo", color: "text-red-600", bg: "bg-red-500", bar: "bg-red-500" };

  const metricsList = [
    { id: "clientes", title: "Total de Clientes", value: String(m.clientsCount), changeType: "neutral" as const, icon: Users },
    { id: "total-emprestado", title: "Total Emprestado", value: formatCurrency(m.totalLoaned), changeType: "neutral" as const, icon: DollarSign },
    { id: "juros-restante", title: "Juros Restante", value: formatCurrency(m.jurosRestante), changeType: "neutral" as const, icon: Percent },
    { id: "total-restante", title: "Total Restante", value: formatCurrency(m.totalRestante), changeType: "neutral" as const, icon: CreditCard },
    { id: "ativos", title: "Ativos", value: String(m.ativosCount ?? 0), changeType: "neutral" as const, icon: Landmark },
    { id: "vencidos-count", title: "Vencidos", value: String(m.vencidosCount ?? 0), changeType: "negative" as const, icon: AlertTriangle },
    { id: "parcelamentos", title: "Parcelamentos", value: String(m.parcelamentosCount ?? 0), changeType: "neutral" as const, icon: Receipt },
    { id: "quitados-count", title: "Empréstimos Quitados", value: String(m.paidLoansCount), changeType: "positive" as const, icon: CheckCircle },
    { id: "quitados-valor", title: "Valor Quitados", value: formatCurrency(m.paidLoansValor), changeType: "positive" as const, icon: CheckCircle },
    { id: "vencidos-valor", title: "Valor Vencidos", value: formatCurrency(m.vencidosValor), changeType: "negative" as const, icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Visão Geral</h1>
        <p className="text-sm text-muted-foreground">Acompanhe suas métricas financeiras em tempo real</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0, duration: 0.4 }}
        className="glass-card p-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${healthStatus.bg}/10`}>
              <Activity className={`h-6 w-6 ${healthStatus.color}`} />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Saúde da Operação</p>
              <p className={`text-2xl font-bold ${healthStatus.color}`}>{healthStatus.label}</p>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${clampedScore}%` }}
                  transition={{ duration: 0.8, delay: 0.2 }}
                  className={`h-full rounded-full ${healthStatus.bar}`}
                />
              </div>
              <span className="text-sm font-bold text-foreground w-10">{clampedScore}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              80–100 Excelente · 50–70 Razoável · 10–50 Prejuízo
            </p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {metricsList.map((metric, i) => (
          <MetricCard key={metric.id} title={metric.title} value={metric.value} changeType={metric.changeType} icon={metric.icon} index={i} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="glass-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Empréstimos por Mês</h3>
          <div className="h-56">
            <ChartContainer
              config={{
                emprestimos: { label: "Empréstimos", color: "hsl(var(--primary))" },
              }}
              className="h-full w-full"
            >
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="mes" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
                <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatCurrency(Number(v))} />} />
                <Area type="monotone" dataKey="emprestimos" stroke="var(--color-emprestimos)" fill="var(--color-emprestimos)" fillOpacity={0.3} strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="glass-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Pagamentos por Mês</h3>
          <div className="h-56">
            <ChartContainer
              config={{
                pagamentos: { label: "Pagamentos", color: "hsl(var(--success))" },
              }}
              className="h-full w-full"
            >
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="mes" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
                <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatCurrency(Number(v))} />} />
                <Bar dataKey="pagamentos" fill="var(--color-pagamentos)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </div>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }} className="glass-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Atividades Recentes</h3>
        <div className="space-y-3">
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma atividade recente</p>
          ) : (
            recentActivity.map((item, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                <div className={`h-2 w-2 rounded-full ${item.color}`} />
                <p className="text-sm text-foreground flex-1">{item.text}</p>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{item.time}</span>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
