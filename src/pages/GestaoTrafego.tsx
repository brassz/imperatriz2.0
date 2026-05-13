import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { BarChart3, Users, CheckCircle2, UserMinus, ShieldAlert } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { fetchTrafficLeads, computeTrafficKpis, type TrafficLead, type TrafficSource } from "@/api/traffic";
import { fetchMetaDatasetQuality } from "@/api/meta-dataset-quality";
import { addPdfFooter, addPdfHeader, getPdfFooterY, getPdfMargin, PDF_BRAND } from "@/lib/pdf-utils";
import { jsPDF } from "jspdf";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";

function compactDay(d: string): string {
  const [y, m, day] = String(d || "").split("-");
  if (!y || !m || !day) return d;
  return `${day}/${m}`;
}

function normalizePhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length ? digits : String(raw || "");
}

function parseSupabaseTimestamp(raw: string): Date | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  // exemplos: "2026-05-06 00:50:57.049352+00" ou ISO
  const isoLike = s.includes("T")
    ? s
    : s.replace(" ", "T");
  const normalized = isoLike.endsWith("+00") ? isoLike.replace(/\+00$/, "Z") : isoLike;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTimePt(raw: string): string {
  const d = parseSupabaseTimestamp(raw);
  if (!d) return "—";
  return d.toLocaleString("pt-BR");
}

function formatCurrencyBRL(n: number): string {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateBR(raw: string): string {
  const d = parseSupabaseTimestamp(raw);
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR");
}

function truthLabel(v: boolean | null): string {
  return v ? "Sim" : "Não";
}

function statusLabel(contacted: boolean): string {
  return contacted ? "Contatado" : "Não contatado";
}

function statusClass(contacted: boolean): string {
  return contacted
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
}

function ymd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function firstDayOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function lastDayOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function clampDateRange(fromYmd: string, toYmd: string): { from: string; to: string } {
  const f = String(fromYmd || "").trim();
  const t = String(toYmd || "").trim();
  if (!f && !t) {
    const now = new Date();
    return { from: ymd(firstDayOfMonth(now)), to: ymd(lastDayOfMonth(now)) };
  }
  if (f && t && f <= t) return { from: f, to: t };
  if (f && !t) return { from: f, to: f };
  if (!f && t) return { from: t, to: t };
  // invertido
  return { from: t, to: f };
}

function leadRelevantDateYmd(lead: TrafficLead): string {
  // Preferir data de contato quando existir; senão cair para createdAt.
  const raw = lead.contactedAt || lead.createdAt;
  const d = parseSupabaseTimestamp(raw);
  return d ? ymd(d) : "";
}

function buildDaysArray(fromYmd: string, toYmd: string): string[] {
  const a = parseSupabaseTimestamp(fromYmd);
  const b = parseSupabaseTimestamp(toYmd);
  if (!a || !b) return [];
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  const out: string[] = [];
  for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(ymd(d));
  }
  return out;
}

function drawBarChartPdf(
  doc: jsPDF,
  opts: { x: number; y: number; w: number; h: number; title: string; data: Array<{ day: string; value: number }> }
): void {
  const c = PDF_BRAND.colors;
  const { x, y, w, h, title, data } = opts;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(c.text.r, c.text.g, c.text.b);
  doc.text(title, x, y);

  const chartY = y + 6;
  const chartH = h - 10;
  const chartX = x;
  const chartW = w;

  doc.setDrawColor(c.line.r, c.line.g, c.line.b);
  doc.rect(chartX, chartY, chartW, chartH);

  const maxV = Math.max(1, ...data.map((d) => d.value));
  const n = data.length || 1;
  const gap = 1.2;
  const barW = Math.max(0.8, (chartW - gap * (n + 1)) / n);

  doc.setFillColor(c.primary.r, c.primary.g, c.primary.b);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(c.textMuted.r, c.textMuted.g, c.textMuted.b);

  for (let i = 0; i < n; i++) {
    const v = data[i]?.value ?? 0;
    const bh = (v / maxV) * (chartH - 8);
    const bx = chartX + gap + i * (barW + gap);
    const by = chartY + chartH - 4 - bh;
    doc.rect(bx, by, barW, bh, "F");

    const labelEvery = n > 40 ? 10 : n > 20 ? 5 : 2;
    if (i % labelEvery === 0 || i === n - 1) {
      const dd = String(data[i]?.day || "");
      const [yy, mm, day] = dd.split("-");
      const lbl = yy && mm && day ? `${day}/${mm}` : dd;
      doc.text(lbl, bx, chartY + chartH + 3);
    }
  }

  doc.setFontSize(8);
  doc.text(String(maxV), chartX + chartW + 1, chartY + 3);
}

function LeadTable({
  leads,
  onDetails,
  onContact,
}: {
  leads: TrafficLead[];
  onDetails: (lead: TrafficLead) => void;
  onContact: (lead: TrafficLead) => void;
}) {
  return (
    <div className="rounded-xl border border-border/40 overflow-hidden">
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-sm table-fixed">
          <thead className="sticky top-0 bg-background/95 backdrop-blur border-b border-border/40">
            <tr className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              <th className="text-left p-3 w-[220px]">Nome</th>
              <th className="text-left p-3 whitespace-nowrap w-[150px]">WhatsApp</th>
              <th className="text-left p-3 whitespace-nowrap w-[110px]">Valor</th>
              <th className="text-left p-3 w-[170px]">Cidade</th>
              <th className="text-left p-3 whitespace-nowrap w-[110px]">Status</th>
              <th className="text-left p-3 whitespace-nowrap w-[190px]">Data</th>
              <th className="text-left p-3 whitespace-nowrap w-[170px]">Ações</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  Nenhum registro
                </td>
              </tr>
            ) : (
              leads.map((l) => (
                <tr key={`${l.source}-${l.id}`} className="border-b border-border/30 last:border-0">
                  <td className="p-3 font-medium text-foreground truncate">{l.name || "—"}</td>
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{normalizePhone(l.whatsapp) || "—"}</td>
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{l.value || "—"}</td>
                  <td className="p-3 text-muted-foreground truncate">{l.city || "—"}</td>
                  <td className="p-3 whitespace-nowrap">
                    <span className={`text-xs font-semibold ${statusClass(l.contacted)}`}>
                      {statusLabel(l.contacted)}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{formatDateTimePt(l.createdAt)}</td>
                  <td className="p-3 whitespace-nowrap">
                    <div className="flex flex-col sm:flex-row gap-2 justify-start">
                      <Button type="button" variant="outline" size="sm" onClick={() => onContact(l)}>
                        Contatar
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => onDetails(l)}>
                        Detalhes
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourcePanel({ source }: { source: TrafficSource }) {
  const { data: leads = [], isLoading, error, refetch } = useQuery({
    queryKey: ["traffic-leads", source],
    queryFn: () => fetchTrafficLeads(source),
    staleTime: 30_000,
  });

  const kpis = useMemo(() => computeTrafficKpis(leads), [leads]);

  const donutData = useMemo(
    () => [
      { name: "Contatados", value: kpis.contacted },
      { name: "Não contatados", value: kpis.notContacted },
    ],
    [kpis.contacted, kpis.notContacted],
  );

  const contatados = useMemo(() => leads.filter((l) => l.contacted), [leads]);
  const naoContatados = useMemo(() => leads.filter((l) => !l.contacted), [leads]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selected, setSelected] = useState<TrafficLead | null>(null);

  const openDetails = (lead: TrafficLead) => {
    setSelected(lead);
    setDetailsOpen(true);
  };

  const handleContact = (lead: TrafficLead) => {
    const digits = String(lead.whatsapp || "").replace(/\D/g, "");
    const phone = digits.startsWith("55") ? digits : digits.length >= 10 ? `55${digits}` : digits;
    const url = phone ? `https://wa.me/${phone}` : "";
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Origem</p>
          <h2 className="text-lg font-bold text-foreground">
            {source === "novixcred" ? "NovixCred" : "CredCard"}
          </h2>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading}>
          Atualizar
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="font-semibold">
            Erro ao carregar {source === "novixcred" ? "NovixCred" : "CredCard"}.
          </div>
          <div className="text-xs text-destructive/90 mt-1 whitespace-pre-wrap break-words">
            {error instanceof Error ? error.message : String(error)}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Dica: isso costuma ser RLS (permissão), tabela/colunas diferentes, ou projeto Supabase incorreto.
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Leads (total)</p>
              <p className="text-2xl font-black text-foreground tabular-nums">{kpis.total}</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Contatados</p>
              <p className="text-2xl font-black text-foreground tabular-nums">{kpis.contacted}</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <UserMinus className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Não contatados</p>
              <p className="text-2xl font-black text-foreground tabular-nums">{kpis.notContacted}</p>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Leads (últimos 30 dias)
          </h3>
          <div className="h-64">
            <ChartContainer config={{ leads: { label: "Leads", color: "hsl(var(--primary))" } }} className="h-full w-full">
              <BarChart data={kpis.last30Days}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={compactDay} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="leads" fill="var(--color-leads)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </div>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Status de contato</h3>
          <div className="h-64">
            <ChartContainer config={{ contacted: { label: "Contatados", color: "hsl(var(--success))" }, not: { label: "Não contatados", color: "hsl(var(--warning))" } }} className="h-full w-full">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  <Cell fill="hsl(var(--success))" />
                  <Cell fill="hsl(var(--warning))" />
                </Pie>
              </PieChart>
            </ChartContainer>
          </div>
        </div>
      </div>

      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">Clientes</h3>
        <Tabs defaultValue="nao">
          <TabsList className="mb-3">
            <TabsTrigger value="nao">Não contatados ({naoContatados.length})</TabsTrigger>
            <TabsTrigger value="sim">Contatados ({contatados.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="nao">
            <LeadTable leads={naoContatados} onDetails={openDetails} onContact={handleContact} />
          </TabsContent>
          <TabsContent value="sim">
            <LeadTable leads={contatados} onDetails={openDetails} onContact={handleContact} />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalhes do Cliente</DialogTitle>
            <DialogDescription>Informações completas do cadastro</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Nome Completo</p>
              <p className="text-sm font-medium text-foreground">{selected?.name || "—"}</p>
            </div>

            <div className="grid gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">WhatsApp</p>
              <p className="text-sm font-medium text-foreground">{selected?.whatsapp || "—"}</p>
            </div>

            <div className="grid gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Cidade</p>
              <p className="text-sm font-medium text-foreground">{selected?.city || "—"}</p>
            </div>

            <div className="grid gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Valor Desejado</p>
              <p className="text-sm font-medium text-foreground">{selected?.value || "—"}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <p className="text-xs font-semibold text-muted-foreground">Trabalha CLT</p>
                <p className="text-sm font-medium text-foreground">{truthLabel(selected?.worksClt ?? null)}</p>
              </div>
              <div className="grid gap-1.5">
                <p className="text-xs font-semibold text-muted-foreground">Possui CNPJ</p>
                <p className="text-sm font-medium text-foreground">{truthLabel(selected?.hasCnpj ?? null)}</p>
              </div>
              <div className="grid gap-1.5">
                <p className="text-xs font-semibold text-muted-foreground">Possui Avalista</p>
                <p className="text-sm font-medium text-foreground">{truthLabel(selected?.hasGuarantor ?? null)}</p>
              </div>
            </div>

            <div className="grid gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Status</p>
              <p className="text-sm font-semibold text-foreground">
                {selected?.contacted ? "Contatado ✓" : "Não contatado"}
              </p>
            </div>

            <div className="grid gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Data de Cadastro</p>
              <p className="text-sm font-medium text-foreground">{selected ? formatDateTimePt(selected.createdAt) : "—"}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RelatoriosPanel() {
  const now = new Date();
  const defaultFrom = ymd(firstDayOfMonth(now));
  const defaultTo = ymd(lastDayOfMonth(now));
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [dailySpend, setDailySpend] = useState("120");
  const [exporting, setExporting] = useState(false);

  const { data: novix = [], isLoading: loadingNovix } = useQuery({
    queryKey: ["traffic-leads", "novixcred"],
    queryFn: () => fetchTrafficLeads("novixcred"),
    staleTime: 30_000,
  });
  const { data: cred = [], isLoading: loadingCred } = useQuery({
    queryKey: ["traffic-leads", "credcard"],
    queryFn: () => fetchTrafficLeads("credcard"),
    staleTime: 30_000,
  });

  const { from: fromYmd, to: toYmd } = useMemo(() => clampDateRange(from, to), [from, to]);

  const daily = useMemo(() => {
    const raw = String(dailySpend || "").replace(",", ".").replace(/[^\d.]/g, "");
    const v = parseFloat(raw);
    return Number.isFinite(v) && v >= 0 ? v : 120;
  }, [dailySpend]);

  const contacted = useMemo(() => {
    const all = [...novix, ...cred].filter((l) => l.contacted);
    return all
      .map((l) => ({ ...l, _d: leadRelevantDateYmd(l) }))
      .filter((l) => l._d && l._d >= fromYmd && l._d <= toYmd)
      .sort((a, b) => String(b._d).localeCompare(String(a._d)));
  }, [novix, cred, fromYmd, toYmd]);

  const contactedNovix = useMemo(() => contacted.filter((l) => l.source === "novixcred").length, [contacted]);
  const contactedCred = useMemo(() => contacted.filter((l) => l.source === "credcard").length, [contacted]);

  const daysInRange = useMemo(() => {
    const a = parseSupabaseTimestamp(fromYmd);
    const b = parseSupabaseTimestamp(toYmd);
    if (!a || !b) return 1;
    const ms = b.getTime() - a.getTime();
    const days = Math.floor(ms / 86_400_000) + 1;
    return Math.max(1, days);
  }, [fromYmd, toYmd]);

  const estimatedSpend = daily * daysInRange;
  const costPerMessage = contacted.length > 0 ? estimatedSpend / contacted.length : 0;

  const chartSeries = useMemo(() => {
    const days = buildDaysArray(fromYmd, toYmd);
    const byDay: Record<string, number> = {};
    for (const l of contacted) {
      const d = (l as any)._d as string;
      if (!d) continue;
      byDay[d] = (byDay[d] || 0) + 1;
    }
    return days.map((day) => ({ day, value: byDay[day] || 0 }));
  }, [contacted, fromYmd, toYmd]);

  const exportPdf = async () => {
    setExporting(true);
    try {
      const doc = new jsPDF();
      const m = getPdfMargin();
      const footerY = getPdfFooterY();

      const subtitle = `Período ${fromYmd} a ${toYmd} · Tráfego/dia ${formatCurrencyBRL(daily)} · Contatados ${contacted.length}`;
      let y = addPdfHeader(doc, "Relatório · Gestão de Tráfego", subtitle);

      const pageW = 210;
      const cardW = (pageW - m * 2 - 6) / 2;
      const cardH = 18;
      const c = PDF_BRAND.colors;

      const drawCard = (x: number, y0: number, title: string, value: string, sub?: string) => {
        doc.setDrawColor(c.line.r, c.line.g, c.line.b);
        doc.setFillColor(250, 250, 250);
        doc.rect(x, y0, cardW, cardH, "FD");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(c.textMuted.r, c.textMuted.g, c.textMuted.b);
        doc.text(title, x + 3, y0 + 6);
        doc.setFontSize(12);
        doc.setTextColor(c.text.r, c.text.g, c.text.b);
        doc.text(value, x + 3, y0 + 13);
        if (sub) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(c.textMuted.r, c.textMuted.g, c.textMuted.b);
          doc.text(sub, x + 3, y0 + 17.5);
        }
      };

      drawCard(m, y, "Período", `${fromYmd} → ${toYmd}`, `${daysInRange} dia(s)`);
      drawCard(m + cardW + 6, y, "Contatados", String(contacted.length), `NovixCred ${contactedNovix} · CredCard ${contactedCred}`);
      y += cardH + 6;
      drawCard(m, y, "Gasto estimado", formatCurrencyBRL(estimatedSpend), `${formatCurrencyBRL(daily)}/dia`);
      drawCard(m + cardW + 6, y, "Custo provável / msg", contacted.length ? formatCurrencyBRL(costPerMessage) : "—");
      y += cardH + 10;

      drawBarChartPdf(doc, {
        x: m,
        y,
        w: pageW - m * 2,
        h: 60,
        title: "Contatados por dia (período selecionado)",
        data: chartSeries,
      });
      y += 68;

      const cols = [
        { t: "Nome", w: 62 },
        { t: "WhatsApp", w: 30 },
        { t: "Valor", w: 22 },
        { t: "Cidade", w: 44 },
        { t: "Origem", w: 20 },
        { t: "Data", w: 26 },
      ] as const;

      const rowH = 6;
      const headerH = 7;
      const startTable = () => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(c.text.r, c.text.g, c.text.b);
        let x = m;
        doc.setDrawColor(c.line.r, c.line.g, c.line.b);
        doc.setFillColor(245, 245, 245);
        doc.rect(m, y, pageW - m * 2, headerH, "FD");
        for (const col of cols) {
          doc.text(col.t, x + 2, y + 5);
          x += col.w;
        }
        y += headerH;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(c.text.r, c.text.g, c.text.b);
      };

      const newPage = () => {
        doc.addPage();
        y = addPdfHeader(doc, "Relatório · Gestão de Tráfego", subtitle);
        y += 4;
      };

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Clientes contatados no período", m, y);
      y += 6;
      startTable();

      const maxY = footerY - 4;
      for (const l of contacted) {
        if (y + rowH > maxY) {
          addPdfFooter(doc);
          newPage();
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.text("Clientes contatados no período (continuação)", m, y);
          y += 6;
          startTable();
        }

        const name = String(l.name || "—").slice(0, 40);
        const phone = normalizePhone(l.whatsapp);
        const value = String(l.value || "—").slice(0, 12);
        const city = String(l.city || "—").slice(0, 26);
        const src = l.source === "novixcred" ? "Novix" : "Cred";
        const date = formatDateBR(l.contactedAt || l.createdAt);

        let x = m;
        const cells = [name, phone, value, city, src, date];
        for (let i = 0; i < cols.length; i++) {
          doc.text(String(cells[i] ?? ""), x + 2, y + 4.2, { maxWidth: cols[i].w - 3 });
          x += cols[i].w;
        }
        doc.setDrawColor(c.line.r, c.line.g, c.line.b);
        doc.line(m, y + rowH, pageW - m, y + rowH);
        y += rowH;
      }

      addPdfFooter(doc);

      const name = `Relatorio_Trafego_${fromYmd}_a_${toYmd}.pdf`;
      doc.save(name);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass-card p-5">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4 justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground">Relatórios</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Clientes contatados no período e estimativa de custo por mensagem.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto">
            <div className="grid gap-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">De</span>
              <input
                type="date"
                className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Até</span>
              <input
                type="date"
                className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tráfego/dia</span>
              <input
                inputMode="decimal"
                className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm"
                value={dailySpend}
                onChange={(e) => setDailySpend(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => void exportPdf()} disabled={exporting}>
            {exporting ? "Gerando PDF..." : "Gerar PDF"}
          </Button>
        </div>
      </div>

      <div className="glass-card p-5">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
            <p className="text-xs font-medium text-muted-foreground">Período</p>
            <p className="text-sm font-bold text-foreground">{fromYmd} → {toYmd}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{daysInRange} dia(s)</p>
          </div>
          <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
            <p className="text-xs font-medium text-muted-foreground">Contatados</p>
            <p className="text-2xl font-black text-foreground tabular-nums">{contacted.length}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              NovixCred {contactedNovix} · CredCard {contactedCred}
            </p>
          </div>
          <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
            <p className="text-xs font-medium text-muted-foreground">Gasto estimado</p>
            <p className="text-2xl font-black text-foreground tabular-nums">{formatCurrencyBRL(estimatedSpend)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {formatCurrencyBRL(daily)}/dia
            </p>
          </div>
          <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
            <p className="text-xs font-medium text-muted-foreground">Custo provável / msg</p>
            <p className="text-2xl font-black text-foreground tabular-nums">
              {contacted.length > 0 ? formatCurrencyBRL(costPerMessage) : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Contatados por dia (período selecionado)
        </h3>
        <div className="h-64">
          <ChartContainer
            config={{ contatados: { label: "Contatados", color: "hsl(var(--primary))" } }}
            className="h-full w-full"
          >
            <BarChart data={chartSeries}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={compactDay} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill="var(--color-contatados)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      </div>

      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">Clientes contatados no período</h3>
        {loadingNovix || loadingCred ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="rounded-xl border border-border/40 overflow-hidden">
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-sm table-fixed">
                <thead className="sticky top-0 bg-background/95 backdrop-blur border-b border-border/40">
                  <tr className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <th className="text-left p-3 w-[220px]">Nome</th>
                    <th className="text-left p-3 whitespace-nowrap w-[150px]">WhatsApp</th>
                    <th className="text-left p-3 whitespace-nowrap w-[110px]">Valor</th>
                    <th className="text-left p-3 w-[170px]">Cidade</th>
                    <th className="text-left p-3 whitespace-nowrap w-[120px]">Origem</th>
                    <th className="text-left p-3 whitespace-nowrap w-[190px]">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {contacted.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        Nenhum cliente contatado neste período
                      </td>
                    </tr>
                  ) : (
                    contacted.map((l) => (
                      <tr key={`${l.source}-${l.id}`} className="border-b border-border/30 last:border-0">
                        <td className="p-3 font-medium text-foreground truncate">{l.name || "—"}</td>
                        <td className="p-3 text-muted-foreground whitespace-nowrap">{normalizePhone(l.whatsapp) || "—"}</td>
                        <td className="p-3 text-muted-foreground whitespace-nowrap">{l.value || "—"}</td>
                        <td className="p-3 text-muted-foreground truncate">{l.city || "—"}</td>
                        <td className="p-3 text-xs font-semibold">
                          <span className="px-2 py-0.5 rounded-full bg-muted text-foreground/80">
                            {l.source === "novixcred" ? "NovixCred" : "CredCard"}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground whitespace-nowrap">
                          {formatDateTimePt(l.contactedAt || l.createdAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GestaoTrafego() {
  const meta = useQuery({
    queryKey: ["meta-dataset-quality"],
    queryFn: fetchMetaDatasetQuality,
    staleTime: 60_000,
  });

  const metaBadge = useMemo(() => {
    if (meta.isLoading) return { text: "Carregando…", cls: "bg-muted text-muted-foreground" };
    if (meta.data?.ok) return { text: "OK", cls: "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20" };
    return { text: "Atenção", cls: "bg-amber-500/10 text-amber-700 border border-amber-500/20" };
  }, [meta.isLoading, meta.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-foreground">Gestão de Tráfego</h1>
        <p className="text-sm text-muted-foreground">
          Tráfego pago (NovixCred e CredCard), clientes e diagnóstico Meta Dataset Quality.
        </p>
      </div>

      <div className="glass-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Meta Dataset Quality</h3>
            </div>
            {meta.data && !meta.data.ok ? (
              <p className="text-xs text-muted-foreground mt-1">
                {meta.data.error}
              </p>
            ) : null}
          </div>
          <span
            className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wide ${metaBadge.cls}`}
            title="Meta Dataset Quality"
          >
            {metaBadge.text}
          </span>
        </div>
      </div>

      <Tabs defaultValue="novixcred">
        <TabsList>
          <TabsTrigger value="novixcred">NovixCred</TabsTrigger>
          <TabsTrigger value="credcard">CredCard</TabsTrigger>
          <TabsTrigger value="relatorios">Relatórios</TabsTrigger>
        </TabsList>
        <TabsContent value="novixcred">
          <SourcePanel source="novixcred" />
        </TabsContent>
        <TabsContent value="credcard">
          <SourcePanel source="credcard" />
        </TabsContent>
        <TabsContent value="relatorios">
          <RelatoriosPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

