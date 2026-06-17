import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchLoansForAutomation, type AutomationLoan } from "@/api/automation";
import { fetchPixKeys } from "@/api/pix-keys";
import { useAuth } from "@/contexts/AuthContext";
import { useAutomationQueue } from "@/contexts/AutomationQueueContext";
import {
  buildCobrancaMessage,
  buildCobrancaParcelamentoMessage,
  resolvePixInfoForMessages,
  type PixInfo,
} from "@/lib/whatsapp-messages";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SESSION_DISMISS_KEY = "nfh_startup_cobranca_modal_v1";

export function StartupCobrancaModal() {
  const { user } = useAuth();
  const queue = useAutomationQueue();
  const { data: pixKeys = [] } = useQuery({
    queryKey: ["pix-keys"],
    queryFn: fetchPixKeys,
    enabled: !!user?.id,
  });

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AutomationLoan[]>([]);
  const [selectedPixId, setSelectedPixId] = useState("");
  const [delayMinutes, setDelayMinutes] = useState("2");

  const dismissForSession = useCallback(() => {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }, []);

  /** Evita nova busca quando `isRunning` volta a false após outra fila (ex.: Configurações). */
  const initialEvaluationDoneRef = useRef(false);

  useEffect(() => {
    if (!selectedPixId && pixKeys.length > 0) {
      const first = pixKeys[0] as { id?: string };
      if (first?.id) setSelectedPixId(String(first.id));
    }
  }, [pixKeys, selectedPixId]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      if (sessionStorage.getItem(SESSION_DISMISS_KEY)) return;
    } catch {
      /* ignore */
    }
    if (queue.isRunning) return;
    if (initialEvaluationDoneRef.current) return;

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const all = await fetchLoansForAutomation({ includeInstallments: true });
        if (cancelled) return;
        initialEvaluationDoneRef.current = true;
        const dueToday = all.filter((i) => i.type === "lembrete_hoje");
        setItems(dueToday);
        if (dueToday.length === 0) {
          dismissForSession();
          return;
        }
        setOpen(true);
      } catch (e) {
        if (!cancelled) {
          initialEvaluationDoneRef.current = true;
          toast.error(e instanceof Error ? e.message : "Erro ao carregar vencimentos de hoje");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [user?.id, queue.isRunning, dismissForSession]);

  const getPixInfo = useCallback((): PixInfo | null => {
    const pix = pixKeys.find((p: Record<string, unknown>) => p.id === selectedPixId) as
      | { bank: string; holder: string; key: string }
      | undefined;
    if (!pix) return null;
    return resolvePixInfoForMessages({
      tipo: pix.bank || "CNPJ",
      titular: pix.holder || "",
      chave: pix.key || "",
    });
  }, [pixKeys, selectedPixId]);

  const sendTypes = useMemo(
    () => ({ cobranca: true, lembrete_hoje: false, lembrete_amanha: false }),
    [],
  );

  const handleStart = async () => {
    const pixInfo = getPixInfo();
    if (!pixInfo?.chave?.trim()) {
      toast.error("Selecione uma chave PIX para as mensagens");
      return;
    }
    const min = Math.max(0, parseFloat(String(delayMinutes).replace(",", ".")) || 0);
    const delayMs = Math.round(min * 60_000);

    const toSend: AutomationLoan[] = items
      .filter((i) => i.loan.client_phone?.trim())
      .map((i) => ({ ...i, type: "cobranca" }));
    if (toSend.length === 0) {
      toast.error("Nenhum destinatário com telefone para enviar.");
      return;
    }

    dismissForSession();
    try {
      await queue.start({
        items: toSend,
        delayMs,
        pixInfo,
        sendTypes,
        buildMessage: (item, p) =>
          item.source === "installment"
            ? buildCobrancaParcelamentoMessage(item.loan, p, 50)
            : buildCobrancaMessage(item.loan, p, 50),
      });
      toast.success("Fila de cobranças iniciada. Acompanhe no canto da tela.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao iniciar a fila");
    }
  };

  const onOpenChange = (next: boolean) => {
    if (!next) dismissForSession();
    else setOpen(next);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Cobrança — vencem hoje</DialogTitle>
          <DialogDescription>
            Envie as mensagens de cobrança para clientes com vencimento hoje (empréstimos e parcelamentos).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando lista…</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-medium text-foreground">{items.length}</span> registro(s) com vencimento hoje.
            </p>

            <div className="rounded-md border border-border/60 bg-muted/20 max-h-32 overflow-y-auto p-2 text-xs space-y-1">
              {items.slice(0, 12).map((i) => (
                <div key={i.id} className="truncate text-muted-foreground">
                  {i.loan.client_name}
                  {!i.loan.client_phone?.trim() ? " · sem telefone" : ""}
                </div>
              ))}
              {items.length > 12 ? (
                <p className="text-muted-foreground pt-1">… e mais {items.length - 12}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="startup-cobranca-pix">Chave PIX</Label>
              {pixKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma chave PIX ativa.{" "}
                  <Link to="/configuracoes" className="text-primary underline underline-offset-2">
                    Cadastre em Configurações
                  </Link>
                  .
                </p>
              ) : (
                <Select value={selectedPixId} onValueChange={setSelectedPixId}>
                  <SelectTrigger id="startup-cobranca-pix">
                    <SelectValue placeholder="Selecione a chave" />
                  </SelectTrigger>
                  <SelectContent>
                    {pixKeys.map((p: Record<string, unknown>) => (
                      <SelectItem key={String(p.id)} value={String(p.id)}>
                        {String(p.bank || "—")} — {String(p.key || "").slice(0, 24)}
                        {String(p.key || "").length > 24 ? "…" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="startup-cobranca-delay">Intervalo entre envios (minutos)</Label>
              <Input
                id="startup-cobranca-delay"
                type="text"
                inputMode="decimal"
                value={delayMinutes}
                onChange={(e) => setDelayMinutes(e.target.value)}
                disabled={queue.isRunning}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={dismissForSession} disabled={queue.isRunning}>
            Agora não
          </Button>
          <Button
            type="button"
            onClick={() => void handleStart()}
            disabled={loading || queue.isRunning || pixKeys.length === 0 || !selectedPixId}
          >
            Iniciar fila
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
