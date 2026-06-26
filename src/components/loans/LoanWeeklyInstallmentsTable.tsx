import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { LoanWeeklyInstallment } from "@/api/loan-weekly-installments";

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(s: string) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

type Props = {
  rows: LoanWeeklyInstallment[];
  onMarkPaid?: (row: LoanWeeklyInstallment) => void;
  markingId?: string | null;
};

export function LoanWeeklyInstallmentsTable({ rows, onMarkPaid, markingId }: Props) {
  if (!rows.length) {
    return <p className="text-xs text-muted-foreground">Nenhuma parcela semanal cadastrada.</p>;
  }

  const paidCount = rows.filter((r) => r.status === "paid").length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">Parcelas semanais</p>
        <Badge variant="outline" className="text-[10px]">
          {paidCount}/{rows.length} pagas
        </Badge>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr className="border-b">
              <th className="text-left p-2 font-semibold w-16">Semana</th>
              <th className="text-left p-2 font-semibold">Vencimento</th>
              <th className="text-right p-2 font-semibold">Valor</th>
              <th className="text-left p-2 font-semibold">Status</th>
              {onMarkPaid ? <th className="p-2 w-24" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const paid = row.status === "paid";
              return (
                <tr key={row.id} className="border-b border-border/40 last:border-0">
                  <td className="p-2 font-medium">{row.week_number}ª</td>
                  <td className="p-2">{formatDate(row.due_date)}</td>
                  <td className="p-2 text-right tabular-nums font-medium">{formatCurrency(row.amount)}</td>
                  <td className="p-2">
                    <span
                      className={`inline-flex items-center gap-1 ${paid ? "text-green-600" : "text-muted-foreground"}`}
                    >
                      {paid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                      {paid ? "Paga" : "Pendente"}
                    </span>
                  </td>
                  {onMarkPaid ? (
                    <td className="p-2 text-right">
                      {!paid ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px]"
                          disabled={markingId === row.id}
                          onClick={() => onMarkPaid(row)}
                        >
                          {markingId === row.id ? "..." : "Marcar paga"}
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
