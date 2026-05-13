import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  Send,
  UserRound,
  Landmark,
  AlertTriangle,
  Search,
  FileUp,
  ScanSearch,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EVOLUTION_INSTANCE_IDS,
  getApiKeyForEvolutionInstance,
  getEvolutionConfig,
} from "@/lib/evolution-settings";
import {
  fetchConnectionStateForInstance,
  fetchEvolutionChatsForInstance,
  fetchEvolutionMessagesForChat,
  normalizePhone,
  sendWhatsAppTextWithInstance,
} from "@/api/evolution";
import {
  createClient,
  fetchClientByLooseNameCandidates,
  fetchClientByPhone,
  fetchClientHistory,
  fetchClientsByPhones,
} from "@/api/clients";
import { consultInfoseekCpf, type InfoseekConsultResult } from "@/api/infoseek";
import { InfoseekConsultBody } from "@/components/InfoseekConsultBody";
import { analyzeDocumentText } from "@/api/document-analysis";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { extractTextFromDocument } from "@/lib/document-analysis";
import { evaluateAtendimentoClient } from "@/lib/atendimento-decision";
import type { DocumentAnalysisResult } from "@/types/document-analysis";

function phoneFromRemoteJid(remoteJid: string): string {
  return String(remoteJid || "").split("@")[0].replace(/\D/g, "");
}

function formatLastSeen(timestamp: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrencyBr(value: number) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function loanStatusLabel(status: string) {
  switch (String(status || "").toLowerCase()) {
    case "active":
      return { label: "Ativo", className: "bg-blue-500/10 text-blue-700 dark:text-blue-300" };
    case "overdue":
      return { label: "Vencido", className: "bg-destructive/10 text-destructive" };
    case "partial_paid":
      return { label: "Parcial", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" };
    case "paid":
      return { label: "Quitado", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
    case "cancelled":
      return { label: "Cancelado", className: "bg-slate-500/10 text-slate-700 dark:text-slate-300" };
    case "finalized":
      return { label: "Finalizado", className: "bg-slate-500/10 text-slate-700 dark:text-slate-300" };
    default:
      return { label: status || "—", className: "bg-muted text-muted-foreground" };
  }
}

function normalizeNameCandidate(input: unknown) {
  const value = String(input || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";
  if (value === "Resultado não encontrado") return "";
  if (value.includes("@")) return "";
  if (!/[A-Za-zÀ-ÿ]/.test(value)) return "";
  return value;
}

function decisionBadge(level: "bom_cliente" | "atencao" | "nao_recomendado") {
  switch (level) {
    case "bom_cliente":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "atencao":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    default:
      return "bg-destructive/10 text-destructive";
  }
}

export default function WhatsApp() {
  const { user } = useAuth();
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const storedConfig = getEvolutionConfig("atendimento");
  const instanceStorageKey = `nexus_atendimento_inbox_instance_${companyId}_${user?.id || "anon"}`;
  const [selectedInstance, setSelectedInstance] = useState<string>(() => {
    if (typeof window === "undefined") return storedConfig.instance;
    return localStorage.getItem(instanceStorageKey) || storedConfig.instance;
  });
  const [chatSearch, setChatSearch] = useState("");
  const [selectedChatJid, setSelectedChatJid] = useState("");
  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);
  const [infoseekCpf, setInfoseekCpf] = useState("");
  const [infoseekLoading, setInfoseekLoading] = useState(false);
  const [infoseekResult, setInfoseekResult] = useState<InfoseekConsultResult | null>(null);
  const [analysisFile, setAnalysisFile] = useState<File | null>(null);
  const [documentAnalysis, setDocumentAnalysis] = useState<DocumentAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);

  const evolutionBaseUrl = storedConfig.baseUrl;
  const selectedApiKey = getApiKeyForEvolutionInstance(selectedInstance);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(instanceStorageKey, selectedInstance);
  }, [instanceStorageKey, selectedInstance]);

  const {
    data: connectionState,
    isLoading: loadingConnection,
    refetch: refetchConnection,
  } = useQuery({
    queryKey: ["whatsapp-inbox-connection", selectedInstance],
    queryFn: () =>
      fetchConnectionStateForInstance({
        instance: selectedInstance,
        apiKey: selectedApiKey,
        baseUrl: evolutionBaseUrl,
      }),
    enabled: !!selectedInstance && !!selectedApiKey,
    staleTime: 20_000,
    refetchInterval: 20_000,
  });

  const isConnected = connectionState?.ok ? connectionState.connected : false;

  const {
    data: chats = [],
    isLoading: loadingChats,
    error: chatsError,
    refetch: refetchChats,
  } = useQuery({
    queryKey: ["whatsapp-inbox-chats", selectedInstance],
    queryFn: () =>
      fetchEvolutionChatsForInstance({
        instance: selectedInstance,
        apiKey: selectedApiKey,
        baseUrl: evolutionBaseUrl,
        limit: 120,
      }),
    enabled: !!selectedInstance && !!selectedApiKey && isConnected,
    staleTime: 0,
    refetchInterval: 15_000,
  });

  const { data: clientsByPhone = {}, refetch: refetchClientsByPhone } = useQuery({
    queryKey: ["whatsapp-inbox-clients-by-phone", chats.map((chat) => phoneFromRemoteJid(chat.remoteJid)).sort().join("|")],
    queryFn: () => fetchClientsByPhones(chats.map((chat) => phoneFromRemoteJid(chat.remoteJid))),
    enabled: chats.length > 0,
    staleTime: 30_000,
  });

  const chatsWithClientNames = useMemo(() => {
    return chats.map((chat) => {
      const rawDigits = phoneFromRemoteJid(chat.remoteJid);
      const normalized = rawDigits.startsWith("55") && rawDigits.length > 11 ? rawDigits.slice(2) : rawDigits;
      const matchedClient = (clientsByPhone as Record<string, Record<string, unknown>>)[normalized] || null;
      return {
        ...chat,
        matchedClient,
        displayName: String(matchedClient?.name || "").trim() || "Resultado não encontrado",
      };
    });
  }, [chats, clientsByPhone]);

  const filteredChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return chatsWithClientNames;
    return chatsWithClientNames.filter((chat) => {
      const phone = phoneFromRemoteJid(chat.remoteJid);
      return (
        chat.displayName.toLowerCase().includes(q) ||
        chat.lastMessageText.toLowerCase().includes(q) ||
        phone.includes(q.replace(/\D/g, ""))
      );
    });
  }, [chatSearch, chatsWithClientNames]);

  useEffect(() => {
    if (!selectedChatJid && chatsWithClientNames.length > 0) {
      setSelectedChatJid(chatsWithClientNames[0].remoteJid);
      return;
    }
    if (
      selectedChatJid &&
      !chatsWithClientNames.some((chat) => chat.remoteJid === selectedChatJid) &&
      chatsWithClientNames.length > 0
    ) {
      setSelectedChatJid(chatsWithClientNames[0].remoteJid);
    }
  }, [chatsWithClientNames, selectedChatJid]);

  const selectedChat = useMemo(
    () => chatsWithClientNames.find((chat) => chat.remoteJid === selectedChatJid) || null,
    [chatsWithClientNames, selectedChatJid],
  );

  const selectedChatPhone = useMemo(
    () => (selectedChat ? normalizePhone(phoneFromRemoteJid(selectedChat.remoteJid)) : ""),
    [selectedChat],
  );

  const {
    data: messages = [],
    isLoading: loadingMessages,
    error: messagesError,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ["whatsapp-inbox-messages", selectedInstance, selectedChat?.remoteJid],
    queryFn: () =>
      fetchEvolutionMessagesForChat({
        instance: selectedInstance,
        apiKey: selectedApiKey,
        baseUrl: evolutionBaseUrl,
        remoteJid: String(selectedChat?.remoteJid || ""),
      }),
    enabled: !!selectedChat?.remoteJid && !!selectedApiKey && isConnected,
    staleTime: 0,
    refetchInterval: 7_000,
  });

  const messageNameCandidates = useMemo(() => {
    const out = new Set<string>();
    const chatName = normalizeNameCandidate(selectedChat?.name);
    if (chatName) out.add(chatName);
    for (const message of messages) {
      if (message.fromMe) continue;
      const pushName = normalizeNameCandidate(message.pushName);
      if (pushName) out.add(pushName);
      const rawParticipantName = normalizeNameCandidate(
        (message.raw as any)?.sender?.pushName || (message.raw as any)?.participantName,
      );
      if (rawParticipantName) out.add(rawParticipantName);
    }
    return Array.from(out).slice(0, 5);
  }, [messages, selectedChat?.name]);

  const {
    data: matchedClient,
    refetch: refetchMatchedClient,
    isFetched: matchedClientFetched,
  } = useQuery({
    queryKey: ["whatsapp-inbox-client", selectedChatPhone],
    queryFn: () => fetchClientByPhone(selectedChatPhone),
    enabled: !!selectedChatPhone && !!selectedChat && !selectedChat.isGroup,
    staleTime: 30_000,
  });

  const { data: matchedClientFromMessages } = useQuery({
    queryKey: ["whatsapp-inbox-client-by-message-name", selectedChat?.remoteJid, messageNameCandidates.join("|")],
    queryFn: () => fetchClientByLooseNameCandidates(messageNameCandidates),
    enabled: !!selectedChat && !selectedChat.isGroup && matchedClientFetched && !matchedClient && messageNameCandidates.length > 0,
    staleTime: 30_000,
  });

  const resolvedClient = matchedClient || matchedClientFromMessages || null;

  const { data: matchedClientHistory } = useQuery({
    queryKey: ["whatsapp-inbox-client-history", (resolvedClient as any)?.id],
    queryFn: () => fetchClientHistory(String((resolvedClient as any)?.id || "")),
    enabled: !!(resolvedClient as any)?.id,
    staleTime: 30_000,
  });

  const extractedCpfFromDocument = useMemo(() => {
    const field = documentAnalysis?.extractedFields.find((item) => item.key === "cpf");
    return String(field?.value || "").replace(/\D/g, "");
  }, [documentAnalysis]);

  const suggestedClientName = useMemo(() => {
    const docName = documentAnalysis?.extractedFields.find((item) => item.key === "nome")?.value;
    return (
      String(infoseekResult?.nome || "").trim() ||
      String(docName || "").trim() ||
      String((selectedChat as any)?.displayName || "").trim() ||
      ""
    );
  }, [documentAnalysis, infoseekResult, selectedChat]);

  const atendimentoDecision = useMemo(() => {
    if (!resolvedClient && !infoseekResult && !documentAnalysis) return null;
    const overdueLoans = Array.isArray((matchedClientHistory as any)?.loans)
      ? (matchedClientHistory as any).loans.filter((loan: any) => String(loan.status || "") === "overdue").length
      : 0;
    return evaluateAtendimentoClient({
      internalScore: Number((matchedClientHistory as any)?.score?.score || 0) || null,
      totalLoans: Number((matchedClientHistory as any)?.totalLoans || 0) || null,
      overdueLoans,
      infoseek: infoseekResult,
      documentAnalysis,
    });
  }, [documentAnalysis, infoseekResult, matchedClientHistory, resolvedClient]);

  useEffect(() => {
    setInfoseekResult(null);
    setDocumentAnalysis(null);
    setAnalysisFile(null);
    setAnalysisStatus("");
    if (!selectedChat) {
      setInfoseekCpf("");
      return;
    }
    const resolvedCpf = String((resolvedClient as any)?.cpf || "").replace(/\D/g, "");
    setInfoseekCpf(resolvedCpf);
  }, [resolvedClient, selectedChat?.remoteJid]);

  useEffect(() => {
    if (!infoseekCpf && extractedCpfFromDocument) {
      setInfoseekCpf(extractedCpfFromDocument);
    }
  }, [extractedCpfFromDocument, infoseekCpf]);

  const sendTextMessage = async (text: string) => {
    if (!selectedChat) return;
    const phone = phoneFromRemoteJid(selectedChat.remoteJid);
    if (!phone) {
      toast.error("Não foi possível identificar o número desta conversa.");
      return;
    }

    setSending(true);
    try {
      const res = await sendWhatsAppTextWithInstance(phone, text, {
        instance: selectedInstance,
        apiKey: selectedApiKey,
        baseUrl: evolutionBaseUrl,
      });
      if (!res.ok) throw new Error(res.error || "Falha ao enviar mensagem");
      setComposerText("");
      await Promise.all([refetchMessages(), refetchChats()]);
      toast.success("Mensagem enviada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const handleSendComposer = async () => {
    const text = composerText.trim();
    if (!text) return;
    await sendTextMessage(text);
  };

  const handleInfoseekConsult = async () => {
    if (!infoseekCpf.trim()) {
      toast.error("Informe um CPF para consultar na Infoseek.");
      return;
    }
    setInfoseekLoading(true);
    try {
      const result = await consultInfoseekCpf(infoseekCpf);
      setInfoseekResult(result);
      toast.success("Consulta Infoseek concluída.");
    } catch (error) {
      setInfoseekResult(null);
      toast.error(error instanceof Error ? error.message : "Erro na consulta Infoseek");
    } finally {
      setInfoseekLoading(false);
    }
  };

  const handleAnalyzeDocument = async () => {
    if (!analysisFile) {
      toast.error("Selecione um PDF ou imagem para análise.");
      return;
    }
    setAnalysisLoading(true);
    setAnalysisStatus("Preparando documento...");
    try {
      const extracted = await extractTextFromDocument(analysisFile, setAnalysisStatus);
      if (!extracted.text.trim()) {
        throw new Error("Não foi possível extrair texto útil do documento enviado.");
      }
      setAnalysisStatus("Gerando resumo e dados importantes...");
      const analyzed = await analyzeDocumentText({
        fileName: extracted.fileName,
        mimeType: extracted.mimeType,
        documentText: extracted.text,
      });
      if (!analyzed.success) {
        throw new Error(analyzed.error);
      }
      setDocumentAnalysis(analyzed);
      setAnalysisStatus(`Análise concluída por ${analyzed.source === "llm" ? "IA" : "fallback interno"}.`);
      toast.success("Documento analisado com sucesso.");
    } catch (error) {
      setDocumentAnalysis(null);
      setAnalysisStatus("");
      toast.error(error instanceof Error ? error.message : "Erro ao analisar documento");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleCreateClientFromAtendimento = async () => {
    if (resolvedClient) return;
    const name = suggestedClientName.trim();
    if (!name) {
      toast.error("Não foi possível sugerir um nome para criar o cliente.");
      return;
    }

    setCreatingClient(true);
    try {
      await createClient({
        name,
        cpf: String(infoseekResult?.cpf || extractedCpfFromDocument || "").trim() || undefined,
        phone: selectedChatPhone || undefined,
        email: infoseekResult?.emails?.[0]?.email || undefined,
        address:
          infoseekResult?.enderecos?.[0]
            ? Object.values(infoseekResult.enderecos[0]).filter(Boolean).join(" - ")
            : undefined,
      });
      await Promise.all([refetchMatchedClient(), refetchClientsByPhone()]);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-inbox-client-history"] });
      toast.success("Cliente criado a partir do atendimento.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao criar cliente");
    } finally {
      setCreatingClient(false);
    }
  };

  const connectionError = connectionState && !connectionState.ok ? connectionState.error : "";

  const crmPanel = (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contexto do contato</CardTitle>
          <CardDescription>Dados operacionais da conversa selecionada.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!selectedChat ? (
            <p className="text-muted-foreground">Selecione uma conversa para ver o contexto.</p>
          ) : (
            <>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Nome</p>
                <p className="font-medium text-foreground">
                  {String((resolvedClient as any)?.name || "").trim() || (selectedChat as any).displayName || selectedChat.name}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Telefone / JID</p>
                <p className="font-medium text-foreground break-all">{selectedChatPhone || selectedChat.remoteJid}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Última atividade</p>
                <p className="font-medium text-foreground">{formatLastSeen(selectedChat.updatedAt)}</p>
              </div>
              {selectedChat.isGroup ? (
                <Badge variant="secondary">Grupo</Badge>
              ) : (
                <Badge variant="outline">Contato direto</Badge>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Painel de atendimento</CardTitle>
          <CardDescription>Use as abas para consultar e analisar sem empilhar muitos blocos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Tabs defaultValue="cliente" className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-4">
              <TabsTrigger value="cliente" className="text-xs">Cliente</TabsTrigger>
              <TabsTrigger value="infoseek" className="text-xs">Infoseek</TabsTrigger>
              <TabsTrigger value="documento" className="text-xs">Documento</TabsTrigger>
              <TabsTrigger value="parecer" className="text-xs">Parecer</TabsTrigger>
            </TabsList>

            <TabsContent value="cliente" className="space-y-3">
              {!selectedChat ? (
                <p className="text-sm text-muted-foreground">Selecione uma conversa.</p>
              ) : selectedChat.isGroup ? (
                <p className="text-sm text-muted-foreground">As ações de CRM da v1 estão disponíveis apenas para conversas individuais.</p>
              ) : resolvedClient ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center gap-2">
                      <UserRound className="h-4 w-4 text-primary" />
                      <p className="font-medium text-foreground">{String((resolvedClient as any).name || "Cliente")}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      CPF: {String((resolvedClient as any).cpf || "—")} · Telefone: {String((resolvedClient as any).phone || "—")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link to={`/emprestimos?search=${encodeURIComponent(String((resolvedClient as any).phone || (resolvedClient as any).name || selectedChatPhone || ""))}`}>
                        <Landmark className="mr-1.5 h-3.5 w-3.5" />
                        Ir para empréstimos
                      </Link>
                    </Button>
                  </div>
                  {matchedClientHistory ? (
                    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Score</p>
                          <p className="font-semibold text-foreground">{Number((matchedClientHistory as any).score?.score || 0)}/100</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Empréstimos</p>
                          <p className="font-semibold text-foreground">{Number((matchedClientHistory as any).totalLoans || 0)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Total pago</p>
                          <p className="font-semibold text-foreground">{formatCurrencyBr(Number((matchedClientHistory as any).totalPaid || 0))}</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Últimos empréstimos</p>
                        {Array.isArray((matchedClientHistory as any).loans) && (matchedClientHistory as any).loans.length > 0 ? (
                          (matchedClientHistory as any).loans.slice(0, 3).map((loan: any) => {
                            const status = loanStatusLabel(String(loan.status || ""));
                            return (
                              <div key={String(loan.id)} className="rounded-md border border-border/50 bg-background/80 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-medium text-foreground">{formatCurrencyBr(Number(loan.amount || 0))}</p>
                                  <Badge className={status.className}>{status.label}</Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Juros: {Number(loan.interest_rate || 0)}% · Vencimento: {String(loan.due_date || "").split("T")[0] || "—"}
                                </p>
                              </div>
                            );
                          })
                        ) : (
                          <div className="flex items-center gap-2 rounded-md border border-border/50 bg-background/80 p-2 text-xs text-muted-foreground">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Nenhum empréstimo encontrado para este cliente.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum cliente encontrado pelo telefone ou pelo nome das mensagens.</p>
              )}
            </TabsContent>

            <TabsContent value="infoseek" className="space-y-3">
              {!selectedChat || selectedChat.isGroup ? (
                <p className="text-sm text-muted-foreground">Selecione um contato direto para consultar.</p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Input
                      value={infoseekCpf}
                      onChange={(e) => setInfoseekCpf(e.target.value)}
                      placeholder="CPF do cliente"
                      className="font-mono"
                    />
                    <Button type="button" size="sm" variant="outline" className="gap-2" disabled={infoseekLoading} onClick={() => void handleInfoseekConsult()}>
                      <Search className="h-3.5 w-3.5" />
                      {infoseekLoading ? "Consultando..." : "Consultar Infoseek"}
                    </Button>
                  </div>
                  {infoseekResult ? (
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                      <InfoseekConsultBody result={infoseekResult} />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Faça a consulta para trazer score externo, renda, endereços e contatos complementares.</p>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="documento" className="space-y-3">
              {!selectedChat || selectedChat.isGroup ? (
                <p className="text-sm text-muted-foreground">Selecione um contato direto para analisar documentos.</p>
              ) : (
                <>
                  <Input
                    type="file"
                    accept=".pdf,image/*"
                    onChange={(e) => setAnalysisFile(e.target.files?.[0] || null)}
                  />
                  <Button type="button" size="sm" className="gap-2" disabled={analysisLoading || !analysisFile} onClick={() => void handleAnalyzeDocument()}>
                    {analysisLoading ? <ScanSearch className="h-3.5 w-3.5" /> : <FileUp className="h-3.5 w-3.5" />}
                    {analysisLoading ? "Analisando..." : "Analisar documento"}
                  </Button>
                  {analysisStatus ? <p className="text-xs text-muted-foreground">{analysisStatus}</p> : null}
                  {documentAnalysis ? (
                    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                      <div>
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">Tipo</p>
                        <p className="font-medium text-foreground">{documentAnalysis.documentType}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">Resumo</p>
                        <p className="text-sm text-foreground">{documentAnalysis.summary}</p>
                      </div>
                      {documentAnalysis.extractedFields.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground">Dados importantes</p>
                          {documentAnalysis.extractedFields.slice(0, 6).map((field) => (
                            <p key={`${field.key}-${field.value}`} className="text-xs text-foreground">
                              <span className="text-muted-foreground">{field.label}:</span> {field.value}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {documentAnalysis.riskFlags.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground">Alertas</p>
                          {documentAnalysis.riskFlags.slice(0, 3).map((flag, index) => (
                            <div key={`${flag.title}-${index}`} className="rounded-md border border-border/50 bg-background/80 p-2">
                              <p className="text-xs font-medium text-foreground">{flag.title}</p>
                              <p className="text-xs text-muted-foreground">{flag.details}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">O sistema extrai texto do PDF, aplica OCR quando necessário e monta um resumo operacional.</p>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="parecer" className="space-y-3">
              {!atendimentoDecision ? (
                <p className="text-sm text-muted-foreground">Consulte o cliente e/ou analise um documento para gerar um parecer.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">{atendimentoDecision.headline}</p>
                      <p className="text-xs text-muted-foreground">Score operacional: {atendimentoDecision.score}/100</p>
                    </div>
                    <Badge className={decisionBadge(atendimentoDecision.level)}>
                      {atendimentoDecision.level === "bom_cliente"
                        ? "Bom cliente"
                        : atendimentoDecision.level === "atencao"
                          ? "Atenção"
                          : "Não recomendado"}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {atendimentoDecision.reasons.map((reason, index) => (
                      <p key={`${reason}-${index}`} className="text-xs text-muted-foreground">
                        - {reason}
                      </p>
                    ))}
                  </div>
                  {!resolvedClient && atendimentoDecision.level !== "nao_recomendado" ? (
                    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Deseja criar cliente?</p>
                        <p className="text-xs text-muted-foreground">
                          O cadastro será pré-preenchido com telefone do chat e dados identificados na consulta/documento.
                        </p>
                      </div>
                      <Button type="button" size="sm" className="gap-2" disabled={creatingClient} onClick={() => void handleCreateClientFromAtendimento()}>
                        <UserPlus className="h-3.5 w-3.5" />
                        {creatingClient ? "Criando..." : "Criar cliente"}
                      </Button>
                      {suggestedClientName ? (
                        <p className="text-xs text-muted-foreground">Sugestão de nome: {suggestedClientName}</p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Atendimento</h1>
          <p className="text-sm text-muted-foreground">Inbox de atendimento com chat ao vivo e triagem de clientes.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={selectedInstance} onValueChange={setSelectedInstance}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Instância" />
            </SelectTrigger>
            <SelectContent>
              {EVOLUTION_INSTANCE_IDS.map((instance) => (
                <SelectItem key={instance} value={instance}>
                  {instance}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" className="gap-2" onClick={() => {
            void refetchConnection();
            void refetchChats();
            void refetchMessages();
          }}>
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" className="xl:hidden">
                CRM da conversa
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[92vw] sm:max-w-md overflow-y-auto">
              <SheetHeader className="mb-4">
                <SheetTitle>CRM da conversa</SheetTitle>
                <SheetDescription>Ações e contexto do contato selecionado.</SheetDescription>
              </SheetHeader>
              {crmPanel}
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {!loadingConnection && connectionError ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">{connectionError}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
        <Card className="min-h-[70vh]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Conversas</CardTitle>
            <CardDescription>
              {loadingConnection ? "Verificando conexão..." : isConnected ? `Instância ${selectedInstance} conectada` : "Instância desconectada"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              placeholder="Buscar conversa..."
            />
            <ScrollArea className="h-[calc(70vh-8rem)] pr-3">
              <div className="space-y-2">
                {loadingChats ? (
                  <p className="text-sm text-muted-foreground">Carregando conversas...</p>
                ) : chatsError ? (
                  <p className="text-sm text-destructive">
                    {chatsError instanceof Error ? chatsError.message : "Erro ao carregar conversas"}
                  </p>
                ) : filteredChats.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada.</p>
                ) : (
                  filteredChats.map((chat) => (
                    <button
                      key={chat.remoteJid}
                      type="button"
                      onClick={() => setSelectedChatJid(chat.remoteJid)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        selectedChatJid === chat.remoteJid
                          ? "border-primary bg-primary/5"
                          : "border-border/60 hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{(chat as any).displayName || chat.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{phoneFromRemoteJid(chat.remoteJid)}</p>
                        </div>
                        {chat.unreadCount > 0 ? (
                          <Badge>{chat.unreadCount}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{chat.lastMessageText}</p>
                      <p className="mt-2 text-[11px] text-muted-foreground">{chat.updatedAtLabel}</p>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="min-h-[70vh]">
          <CardHeader className="pb-3 border-b border-border/60">
            {!selectedChat ? (
              <>
                <CardTitle className="text-base">Chat</CardTitle>
                <CardDescription>Selecione uma conversa para abrir a thread.</CardDescription>
              </>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">
                    {String((resolvedClient as any)?.name || "").trim() || (selectedChat as any).displayName || selectedChat.name}
                  </CardTitle>
                  <CardDescription className="truncate">
                    {selectedChatPhone || selectedChat.remoteJid}
                  </CardDescription>
                </div>
                {selectedChat.isGroup ? <Badge variant="secondary">Grupo</Badge> : null}
              </div>
            )}
          </CardHeader>
          <CardContent className="flex h-[calc(70vh-5rem)] flex-col p-0">
            <ScrollArea className="flex-1 px-4 py-4">
              {!selectedChat ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Escolha uma conversa na coluna à esquerda.
                </div>
              ) : loadingMessages ? (
                <p className="text-sm text-muted-foreground">Carregando mensagens...</p>
              ) : messagesError ? (
                <p className="text-sm text-destructive">
                  {messagesError instanceof Error ? messagesError.message : "Erro ao carregar mensagens"}
                </p>
              ) : messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma mensagem visível nesta conversa.</p>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.fromMe ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                          message.fromMe
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{message.text}</p>
                        <p
                          className={`mt-1 text-[11px] ${
                            message.fromMe ? "text-primary-foreground/80" : "text-muted-foreground"
                          }`}
                        >
                          {message.timestampLabel}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="border-t border-border/60 p-4">
              <div className="space-y-3">
                <Textarea
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  placeholder={selectedChat ? "Digite sua resposta..." : "Selecione uma conversa para responder"}
                  disabled={!selectedChat || sending}
                  className="min-h-[96px] resize-none"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" onClick={() => void handleSendComposer()} disabled={!selectedChat || sending || !composerText.trim()}>
                    <Send className="h-4 w-4 mr-1.5" />
                    {sending ? "Enviando..." : "Enviar"}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="hidden xl:block">{crmPanel}</div>
      </div>
    </div>
  );
}
