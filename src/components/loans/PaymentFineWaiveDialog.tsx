import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLoanFineWaivers } from "@/api/loan-fine-waivers";
import { calendarDateInBrazil } from "@/lib/brazil-date";
import { DAILY_OVERDUE_FINE_BRL, listOverdueFineCalendarDates } from "@/lib/loan-overdue-fine";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

function formatDayBr(ymd: string) {
  const [y, m, d] = String(ymd).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : ymd;
}

type PaymentFineWaiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loanId: string | null;
  dueDateYmd: string;
  onContinue: (waiveDatesYmd: string[]) => void | Promise<void>;
  submitting?: boolean;
};

export function PaymentFineWaiveDialog({
  open,
  onOpenChange,
  loanId,
  dueDateYmd,
  onContinue,
  submitting,
}: PaymentFineWaiveDialogProps) {
  const [pickedWaive, setPickedWaive] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setPickedWaive(new Set());
  }, [open, loanId]);

  const { data: waived = [], isLoading } = useQuery({
    queryKey: ["loan-fine-waivers", loanId],
    queryFn: () => fetchLoanFineWaivers(String(loanId)),
    enabled: open && !!loanId,
  });

  const today = calendarDateInBrazil();
  const overdue = useMemo(() => listOverdueFineCalendarDates(dueDateYmd, today), [dueDateYmd, today]);
  const waivedSet = useMemo(() => new Set(waived.map((d) => String(d).split("T")[0])), [waived]);
  const pending = useMemo(() => overdue.filter((d) => !waivedSet.has(d)), [overdue, waivedSet]);

  const toggle = (d: string) => {
    setPickedWaive((prev) => {
      const n = new Set(prev);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Multas diárias de atraso</DialogTitle>
          <DialogDescription>
            Cada dia civil após o vencimento gera <strong>R$ {DAILY_OVERDUE_FINE_BRL.toFixed(2)}</strong> de multa.
            Marque os dias em que deseja <strong>anular</strong> a multa antes de confirmar o pagamento.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {overdue.length === 0
              ? "Não há dias em atraso com multa pendente para este empréstimo."
              : "Todas as multas diárias deste período já foram anuladas."}
          </p>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              {pending.length} dia(s) com multa pendente · Total:{" "}
              <span className="font-medium text-foreground">
                R$ {(pending.length * DAILY_OVERDUE_FINE_BRL).toFixed(2).replace(".", ",")}
              </span>
            </p>
            <div className="rounded-md border border-border/60 max-h-52 overflow-y-auto p-2 space-y-2">
              {pending.map((d) => (
                <label
                  key={d}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40 cursor-pointer"
                >
                  <Checkbox checked={pickedWaive.has(d)} onCheckedChange={() => toggle(d)} />
                  <span className="text-sm">
                    {formatDayBr(d)} — R$ {DAILY_OVERDUE_FINE_BRL.toFixed(2).replace(".", ",")}
                  </span>
                </label>
              ))}
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                Anular: <strong>{pickedWaive.size}</strong> dia(s) · R${" "}
                <strong>{(pickedWaive.size * DAILY_OVERDUE_FINE_BRL).toFixed(2).replace(".", ",")}</strong>
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Voltar
          </Button>
          <Button
            type="button"
            onClick={() => void onContinue(Array.from(pickedWaive))}
            disabled={submitting}
          >
            Continuar para confirmação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
