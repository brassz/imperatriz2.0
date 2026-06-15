import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Gavel,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  FileText,
  CircleCheck,
  CircleX,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchAdvocaciaOverdueLoans, type AdvocaciaOverdueLoan } from "@/api/advocacia";
import { fetchPixKeys } from "@/api/pix-keys";
import {
  fetchConnectionStateForInstance,
  sendWhatsAppDocumentWithInstance,
  sendWhatsAppTextWithInstance,
} from "@/api/evolution";
import {
  ADVOCACIA_INSTANCE_IDS,
  getApiKeyForEvolutionInstance,
  getEvolutionConfig,
} from "@/lib/evolution-settings";
import {
  buildAdvocaciaWhatsAppMessage,
  getCreditorCompanyName,
} from "@/lib/advocacia-messages";
import {
  generateNotificacaoExtrajudicialPdf,
  notificacaoPdfToBase64,
} from "@/lib/notificacao-extrajudicial-pdf";

const CONTACT_STORAGE_KEY = "nexus_advocacia_contact_phone";
const INSTANCE_STORAGE_KEY = "nexus_advocacia_instance";

function formatCurrency(n: number) {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(s: string) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("T")[0].split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

function loadStored(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) || fallback;
}

export default function Advocacia() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [instance, setInstance] = useState(() => loadStored(INSTANCE_STORAGE_KEY, ADVOCACIA_INSTANCE_IDS[0]));
  const [contactPhone, setContactPhone] = useState(() => loadStored(CONTACT_STORAGE_KEY, ""));
  const [selectedPixId, setSelectedPixId] = useState("");
  const [delaySeconds, setDelaySeconds] = useState("3");
  const [previewItem, setPreviewItem] = useState<AdvocaciaOverdueLoan | null>(null);
  const [sending, setSending] = useState(false);

  const evolutionBase = getEvolutionConfig().baseUrl;

  const { data: rows = [], isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["advocacia-overdue-30"],
    queryFn: () => fetchAdvocaciaOverdueLoans({ requirePhone: false, minDaysOverdue: 30 }),
    staleTime: 60_000,
  });

  const { data: pixKeys = [] } = useQuery({
    queryKey: ["pix-keys"],
    queryFn: fetchPixKeys,
  });

  const { data: connectionState } = useQuery({
    queryKey: ["advocacia-connection", instance],
    queryFn: () =>
      fetchConnectionStateForInstance({
        instance,
        apiKey: getApiKeyForEvolutionInstance(instance),
        baseUrl: evolutionBase,
      }),
    enabled: !!instance,
    staleTime: 30_000,
  });

  const isConnected = connectionState?.ok ? connectionState.connected : false;
  const apiKey = getApiKeyForEvolutionInstance(instance);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.loan.client_name.toLowerCase().includes(q) ||
        r.loan.client_phone.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const selectedPix = useMemo(() => {
    const p = (pixKeys as Array<Record<string, unknown>>).find((x) => String(x.id) === selectedPixId);
    if (!p) return null;
    return {
      bank: String(p.bank || "PIX"),
      holder: String(p.holder || ""),
      key: String(p.key || ""),
    };
  }, [pixKeys, selectedPixId]);

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? filtered.map((r) => r.id) : []);
  };

  const buildMessageFor = (item: AdvocaciaOverdueLoan) =>
    buildAdvocaciaWhatsAppMessage({
      clientName: item.loan.client_name,
      amount: item.loan.amount,
      dueDate: item.loan.due_date,
      creditorName: getCreditorCompanyName(),
      contactWhatsApp: contactPhone,
    });

  const sendOne = async (item: AdvocaciaOverdueLoan, opts?: { silent?: boolean }) => {
    const phone = item.loan.client_phone?.trim();
    if (!phone) {
      toast.error("Cliente sem telefone cadastrado");
      return false;
    }
    if (!selectedPix?.key) {
      toast.error("Selecione uma chave PIX");
      return false;
    }
    if (!apiKey) {
      toast.error(`Configure a API key da instância ${instance} no .env (VITE_EVOLUTION_API_KEY_${instance.toUpperCase()})`);
      return false;
    }
    if (!contactPhone.trim()) {
      toast.error("Informe o WhatsApp de contato da Capital Advocacia");
      return false;
    }

    const text = buildMessageFor(item);
    const pdf = generateNotificacaoExtrajudicialPdf({
      clientName: item.loan.client_name,
      creditorName: getCreditorCompanyName(),
      debtDescription:
        item.source === "installment" ? "parcelamento de dívida" : "contrato de empréstimo pessoal",
      amount: item.loan.amount,
      dueDate: item.loan.due_date,
      pix: selectedPix,
      contactPhone: contactPhone.trim(),
    });
    const b64 = notificacaoPdfToBase64(pdf);
    const fileName = `notificacao-extrajudicial-${item.loan.client_name.replace(/\s+/g, "-").slice(0, 40)}.pdf`;

    const textRes = await sendWhatsAppTextWithInstance(phone, text, {
      instance,
      apiKey,
      baseUrl: evolutionBase,
    });
    if (!textRes.ok) {
      if (!opts?.silent) toast.error(textRes.error || "Falha ao enviar mensagem");
      return false;
    }

    const docRes = await sendWhatsAppDocumentWithInstance(phone, {
      base64: b64,
      fileName,
      caption: "Notificação extrajudicial — Capital Advocacia",
      instance,
      apiKey,
      baseUrl: evolutionBase,
    });
    if (!docRes.ok) {
      if (!opts?.silent) toast.error(docRes.error || "Mensagem enviada, mas falha ao enviar PDF");
      return false;
    }

    if (!opts?.silent) toast.success(`Cobrança enviada para ${item.loan.client_name}`);
    return true;
  };

  const handleSendSelected = async () => {
    const list = rows.filter((r) => selected.includes(r.id) && r.loan.client_phone?.trim());
    if (list.length === 0) {
      toast.error("Selecione ao menos um cliente com telefone");
      return;
    }
    const delay = Math.max(0, parseFloat(String(delaySeconds).replace(",", ".")) || 0) * 1000;
    setSending(true);
    let ok = 0;
    let fail = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        const sent = await sendOne(list[i], { silent: true });
        if (sent) ok++;
        else fail++;
        if (i < list.length - 1 && delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      toast.message(`Fila concluída: ${ok} enviado(s)${fail > 0 ? `, ${fail} falha(s)` : ""}`);
    } finally {
      setSending(false);
    }
  };

  const savePrefs = () => {
    localStorage.setItem(CONTACT_STORAGE_KEY, contactPhone.trim());
    localStorage.setItem(INSTANCE_STORAGE_KEY, instance);
    toast.success("Preferências salvas");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Gavel className="h-5 w-5" />
          Advocacia
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cobrança extrajudicial via Capital Advocacia — empréstimos e parcelamentos vencidos há mais de 30 dias.
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <Label className="text-xs">Instância WhatsApp</Label>
            <Select
              value={instance}
              onValueChange={(v) => {
                setInstance(v);
                localStorage.setItem(INSTANCE_STORAGE_KEY, v);
              }}
            >
              <SelectTrigger className="mt-1 h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADVOCACIA_INSTANCE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {instance ? (
            isConnected ? (
              <Badge variant="outline" className="h-9 gap-1.5 border-emerald-600/40 text-emerald-700">
                <CircleCheck className="h-3.5 w-3.5" />
                Conectado
              </Badge>
            ) : (
              <Badge variant="outline" className="h-9 gap-1.5 text-muted-foreground">
                <CircleX className="h-3.5 w-3.5" />
                Desconectado
              </Badge>
            )
          ) : null}
          <div className="min-w-[200px] flex-1">
            <Label className="text-xs">Chave PIX (notificação)</Label>
            <Select value={selectedPixId} onValueChange={setSelectedPixId}>
              <SelectTrigger className="mt-1 h-9 text-xs">
                <SelectValue placeholder="Selecione PIX" />
              </SelectTrigger>
              <SelectContent>
                {(pixKeys as Array<Record<string, unknown>>).map((p) => (
                  <SelectItem key={String(p.id)} value={String(p.id)}>
                    {String(p.bank)} – {String(p.holder)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[160px]">
            <Label className="text-xs">WhatsApp Capital Advocacia</Label>
            <Input
              className="mt-1 h-9 text-xs"
              placeholder="Ex: 16999999999"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
          <div className="w-[100px]">
            <Label className="text-xs">Intervalo (s)</Label>
            <Input
              className="mt-1 h-9 text-xs"
              type="number"
              min={0}
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" className="h-9" onClick={savePrefs}>
            Salvar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button
            size="sm"
            className="h-9 gap-1"
            disabled={sending || selected.length === 0}
            onClick={() => void handleSendSelected()}
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Enviar selecionados
          </Button>
        </div>
        {!apiKey ? (
          <p className="text-xs text-amber-600">
            Configure <code className="text-[10px]">VITE_EVOLUTION_API_KEY_{instance.toUpperCase()}</code> no ambiente
            para enviar mensagens pela instância {instance}.
          </p>
        ) : null}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-sm font-semibold">
              Inadimplentes +30 dias{" "}
              <span className="text-muted-foreground font-normal">({filtered.length})</span>
            </p>
            {error ? (
              <p className="text-xs text-destructive mt-1">
                {error instanceof Error ? error.message : "Erro ao carregar"}
              </p>
            ) : null}
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-9 text-xs"
              placeholder="Buscar cliente ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhum empréstimo ou parcelamento vencido há mais de 30 dias.
          </div>
        ) : (
          <ScrollArea className="h-[min(520px,60vh)] rounded-lg border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                <tr className="border-b">
                  <th className="p-3 w-10">
                    <Checkbox
                      checked={filtered.length > 0 && selected.length === filtered.length}
                      onCheckedChange={(c) => toggleAll(Boolean(c))}
                    />
                  </th>
                  <th className="text-left p-3 font-semibold">Cliente</th>
                  <th className="text-left p-3 font-semibold">Tipo</th>
                  <th className="text-left p-3 font-semibold">Telefone</th>
                  <th className="text-left p-3 font-semibold">Vencimento</th>
                  <th className="text-right p-3 font-semibold">Dias</th>
                  <th className="text-right p-3 font-semibold">Valor</th>
                  <th className="p-3 w-28" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="p-3">
                      <Checkbox
                        checked={selected.includes(item.id)}
                        onCheckedChange={(c) => {
                          if (c) setSelected((prev) => [...prev, item.id]);
                          else setSelected((prev) => prev.filter((x) => x !== item.id));
                        }}
                      />
                    </td>
                    <td className="p-3 font-medium">{item.loan.client_name}</td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {item.source === "installment" ? "Parcelamento" : "Empréstimo"}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {item.loan.client_phone || (
                        <span className="text-amber-600">Sem telefone</span>
                      )}
                    </td>
                    <td className="p-3">{formatDate(item.loan.due_date)}</td>
                    <td className="p-3 text-right tabular-nums">{item.days_overdue}</td>
                    <td className="p-3 text-right tabular-nums font-medium">{formatCurrency(item.loan.amount)}</td>
                    <td className="p-3">
                      <div className="flex gap-1 justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Prévia"
                          onClick={() => setPreviewItem(item)}
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Enviar"
                          disabled={sending || !item.loan.client_phone}
                          onClick={() => void sendOne(item)}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </motion.div>

      <Dialog open={!!previewItem} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Prévia da cobrança</DialogTitle>
          </DialogHeader>
          {previewItem ? (
            <pre className="text-xs whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-sans">
              {buildMessageFor(previewItem)}
            </pre>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewItem(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
