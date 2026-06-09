import type { ChartDataPoint } from "@/api/dashboard";

export type GrowthMetricKey = "emprestimos" | "pagamentos" | "multas" | "juros";

export const GROWTH_METRICS: { key: GrowthMetricKey; label: string }[] = [
  { key: "emprestimos", label: "Empréstimos" },
  { key: "pagamentos", label: "Pagamentos" },
  { key: "multas", label: "Multas" },
  { key: "juros", label: "Lucro (juros)" },
];

const METRIC_KEYS = GROWTH_METRICS.map((m) => m.key);

export type GrowthRow = {
  mes: string;
  values: Record<GrowthMetricKey, number>;
  changes: Record<GrowthMetricKey, number | null>;
};

export type GrowthSummary = {
  metric: GrowthMetricKey;
  label: string;
  total: number;
  average: number;
  avgGrowthPct: number | null;
  bestMonth: string | null;
  bestValue: number;
  worstMonth: string | null;
  worstValue: number;
};

function pctChange(prev: number, curr: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

export function buildGrowthReport(data: ChartDataPoint[]): GrowthRow[] {
  return data.map((point, idx) => {
    const values = {} as Record<GrowthMetricKey, number>;
    const changes = {} as Record<GrowthMetricKey, number | null>;
    for (const key of METRIC_KEYS) {
      values[key] = point[key];
      changes[key] = idx === 0 ? null : pctChange(data[idx - 1][key], point[key]);
    }
    return { mes: point.mes, values, changes };
  });
}

export function buildGrowthSummaries(rows: GrowthRow[]): GrowthSummary[] {
  return GROWTH_METRICS.map(({ key, label }) => {
    const values = rows.map((r) => r.values[key]);
    const changes = rows.map((r) => r.changes[key]).filter((c): c is number => c !== null);
    const total = values.reduce((s, v) => s + v, 0);
    const average = rows.length ? total / rows.length : 0;
    let bestIdx = 0;
    let worstIdx = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[bestIdx]) bestIdx = i;
      if (values[i] < values[worstIdx]) worstIdx = i;
    }
    return {
      metric: key,
      label,
      total: Math.round(total * 100) / 100,
      average: Math.round(average * 100) / 100,
      avgGrowthPct:
        changes.length > 0
          ? Math.round((changes.reduce((s, c) => s + c, 0) / changes.length) * 10) / 10
          : null,
      bestMonth: rows[bestIdx]?.mes ?? null,
      bestValue: values[bestIdx] ?? 0,
      worstMonth: rows[worstIdx]?.mes ?? null,
      worstValue: values[worstIdx] ?? 0,
    };
  });
}

export function formatGrowthPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
