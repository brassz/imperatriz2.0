import { Users, Plus, Search, Instagram, Facebook, Eye, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient, deleteClient, fetchClientById, fetchClients, updateClient } from "@/api/clients";
import { useState, useEffect } from "react";
import { Pagination } from "@/components/Pagination";
import { PAGE_SIZE } from "@/lib/constants";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { fetchEmergencyContacts, fetchGuarantors } from "@/api/contacts";

export default function Clientes() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [editClientOpen, setEditClientOpen] = useState(false);
  const [editClientId, setEditClientId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsClientId, setDetailsClientId] = useState<string | null>(null);
  const [newClient, setNewClient] = useState({
    name: "",
    cpf: "",
    phone: "",
    email: "",
    address: "",
    instagram: "",
    facebook: "",
  });
  const [editClient, setEditClient] = useState({
    name: "",
    cpf: "",
    phone: "",
    email: "",
    address: "",
    rg: "",
    instagram: "",
    facebook: "",
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["clients", page, search],
    queryFn: () => fetchClients(page, search),
    placeholderData: keepPreviousData,
  });
  const clients = data?.data ?? [];
  const totalClients = data?.total ?? 0;

  const { data: detailsClient } = useQuery({
    queryKey: ["client-by-id", detailsClientId],
    queryFn: () => fetchClientById(String(detailsClientId)),
    enabled: detailsOpen && !!detailsClientId,
  });

  const { data: editClientRow } = useQuery({
    queryKey: ["client-by-id-edit", editClientId],
    queryFn: () => fetchClientById(String(editClientId)),
    enabled: editClientOpen && !!editClientId,
  });

  useEffect(() => {
    if (!editClientOpen || !editClientRow) return;
    const r = editClientRow as any;
    setEditClient({
      name: String(r.name || ""),
      cpf: String(r.cpf || ""),
      phone: String(r.phone || ""),
      email: String(r.email || ""),
      address: String(r.address || ""),
      rg: String(r.rg || ""),
      instagram: String(r.instagram || ""),
      facebook: String(r.facebook || ""),
    });
  }, [editClientOpen, editClientRow]);
  const { data: detailsGuarantors = [] } = useQuery({
    queryKey: ["client-guarantors", detailsClientId],
    queryFn: () => fetchGuarantors(String(detailsClientId)),
    enabled: detailsOpen && !!detailsClientId,
  });
  const { data: detailsEmergency = [] } = useQuery({
    queryKey: ["client-emergency", detailsClientId],
    queryFn: () => fetchEmergencyContacts(String(detailsClientId)),
    enabled: detailsOpen && !!detailsClientId,
  });

  useEffect(() => {
    setPage(1);
  }, [search]);

  const normalizeInstagramUrl = (raw: string): string | null => {
    const s = String(raw || "").trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    const handle = s.replace(/^@/, "").replace(/^instagram\.com\//i, "").replace(/\/.*/, "");
    if (!handle) return null;
    return `https://www.instagram.com/${handle}`;
  };

  const normalizeFacebookUrl = (raw: string): string | null => {
    const s = String(raw || "").trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    const handle = s.replace(/^@/, "").replace(/^facebook\.com\//i, "").replace(/\/.*/, "");
    if (!handle) return null;
    return `https://www.facebook.com/${handle}`;
  };

  if (isLoading && data === undefined) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Clientes</h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
        <div className="glass-card p-8 animate-pulse rounded-xl h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Clientes</h1>
          <p className="text-sm text-destructive">Erro ao carregar clientes. Verifique a conexão.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Clientes</h1>
          <p className="text-sm text-muted-foreground">Gerencie seus clientes cadastrados</p>
        </div>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
          onClick={() => setNewClientOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Novo Cliente
        </Button>
      </div>

      <div className="glass-card">
        <div className="p-4 border-b border-border/30 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente..."
              className="pl-8 h-8 text-xs nexus-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {totalClients} {search.trim() ? "encontrado(s)" : "cliente(s)"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Nome</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">CPF</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Telefone</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Email</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Empréstimos</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Status</th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Nenhum cliente encontrado
                  </td>
                </tr>
              ) : (
                clients.map((client: Record<string, unknown>, i: number) => (
                  <motion.tr
                    key={String(client.id)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    className="border-b border-border/20 hover:bg-surface-hover transition-colors"
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                          {String(client.name)
                            .split(" ")
                            .map((n: string) => n[0])
                            .join("")
                            .slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-foreground block truncate">{String(client.name)}</span>
                          <div className="flex items-center gap-2 mt-1">
                            {(() => {
                              const ig = normalizeInstagramUrl(String((client as any).instagram || ""));
                              if (!ig) return null;
                              return (
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground transition-colors"
                                  title="Abrir Instagram"
                                  onClick={() => window.open(ig, "_blank", "noopener,noreferrer")}
                                >
                                  <Instagram className="h-4 w-4" />
                                </button>
                              );
                            })()}
                            {(() => {
                              const fb = normalizeFacebookUrl(String((client as any).facebook || ""));
                              if (!fb) return null;
                              return (
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground transition-colors"
                                  title="Abrir Facebook"
                                  onClick={() => window.open(fb, "_blank", "noopener,noreferrer")}
                                >
                                  <Facebook className="h-4 w-4" />
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground font-mono">{String(client.cpf || "—")}</td>
                    <td className="p-4 text-sm text-muted-foreground">{String(client.phone || "—")}</td>
                    <td className="p-4 text-sm text-muted-foreground">{String(client.email || "—")}</td>
                    <td className="p-4 text-sm text-foreground font-medium">{Number(client.loans) || 0}</td>
                    <td className="p-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          client.status === "overdue" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
                        }`}
                      >
                        {client.status === "overdue" ? "Inadimplente" : "Ativo"}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          title="Visualizar cliente"
                          onClick={() => {
                            setDetailsClientId(String(client.id));
                            setDetailsOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          title="Editar cliente"
                          onClick={() => {
                            setEditClientId(String(client.id));
                            setEditClientOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="h-8 w-8"
                          title="Excluir cliente"
                          onClick={async () => {
                            const name = String(client.name || "cliente");
                            if (!confirm(`Excluir o cliente “${name}”?`)) return;
                            try {
                              await deleteClient(String(client.id));
                              toast.success("Cliente excluído");
                              queryClient.invalidateQueries({ queryKey: ["clients"] });
                            } catch (e) {
                              toast.error(
                                e instanceof Error
                                  ? e.message
                                  : "Não foi possível excluir (cliente pode ter empréstimos vinculados).",
                              );
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={totalClients} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>

      <Dialog open={newClientOpen} onOpenChange={setNewClientOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Nome *</Label>
              <Input value={newClient.name} onChange={(e) => setNewClient((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">CPF</Label>
              <Input value={newClient.cpf} onChange={(e) => setNewClient((p) => ({ ...p, cpf: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Telefone</Label>
              <Input value={newClient.phone} onChange={(e) => setNewClient((p) => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">E-mail</Label>
              <Input value={newClient.email} onChange={(e) => setNewClient((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Endereço</Label>
              <Input value={newClient.address} onChange={(e) => setNewClient((p) => ({ ...p, address: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Instagram</Label>
              <Input
                placeholder="@usuario ou instagram.com/usuario"
                value={newClient.instagram}
                onChange={(e) => setNewClient((p) => ({ ...p, instagram: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Facebook</Label>
              <Input
                placeholder="facebook.com/usuario"
                value={newClient.facebook}
                onChange={(e) => setNewClient((p) => ({ ...p, facebook: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setNewClientOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!newClient.name.trim()) {
                  toast.error("Informe o nome");
                  return;
                }
                try {
                  await createClient(newClient);
                  toast.success("Cliente criado");
                  setNewClientOpen(false);
                  setNewClient({ name: "", cpf: "", phone: "", email: "", address: "", instagram: "", facebook: "" });
                  queryClient.invalidateQueries({ queryKey: ["clients"] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Erro ao criar cliente");
                }
              }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editClientOpen}
        onOpenChange={(v) => {
          setEditClientOpen(v);
          if (!v) setEditClientId(null);
        }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Nome *</Label>
              <Input value={editClient.name} onChange={(e) => setEditClient((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">CPF</Label>
              <Input value={editClient.cpf} onChange={(e) => setEditClient((p) => ({ ...p, cpf: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">RG</Label>
              <Input value={editClient.rg} onChange={(e) => setEditClient((p) => ({ ...p, rg: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Telefone</Label>
              <Input value={editClient.phone} onChange={(e) => setEditClient((p) => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">E-mail</Label>
              <Input value={editClient.email} onChange={(e) => setEditClient((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Endereço</Label>
              <Input value={editClient.address} onChange={(e) => setEditClient((p) => ({ ...p, address: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Instagram</Label>
              <Input
                placeholder="@usuario ou instagram.com/usuario"
                value={editClient.instagram}
                onChange={(e) => setEditClient((p) => ({ ...p, instagram: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Facebook</Label>
              <Input
                placeholder="facebook.com/usuario"
                value={editClient.facebook}
                onChange={(e) => setEditClient((p) => ({ ...p, facebook: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setEditClientOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!editClientId) return;
                if (!editClient.name.trim()) {
                  toast.error("Informe o nome");
                  return;
                }
                try {
                  await updateClient(editClientId, editClient);
                  toast.success("Cliente atualizado");
                  setEditClientOpen(false);
                  queryClient.invalidateQueries({ queryKey: ["clients"] });
                  queryClient.invalidateQueries({ queryKey: ["client-by-id", editClientId] });
                  queryClient.invalidateQueries({ queryKey: ["client-by-id-edit", editClientId] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Erro ao atualizar cliente");
                }
              }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailsOpen}
        onOpenChange={(v) => {
          setDetailsOpen(v);
          if (!v) setDetailsClientId(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Dados do cliente</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
              <p className="text-sm font-semibold text-foreground">{String((detailsClient as any)?.name || "—")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-xs text-muted-foreground">
                <div><span className="text-muted-foreground">CPF:</span> {String((detailsClient as any)?.cpf || "—")}</div>
                <div><span className="text-muted-foreground">RG:</span> {String((detailsClient as any)?.rg || "—")}</div>
                <div><span className="text-muted-foreground">Telefone:</span> {String((detailsClient as any)?.phone || "—")}</div>
                <div><span className="text-muted-foreground">E-mail:</span> {String((detailsClient as any)?.email || "—")}</div>
                <div className="sm:col-span-2"><span className="text-muted-foreground">Endereço:</span> {String((detailsClient as any)?.address || "—")}</div>
              </div>

              <div className="flex items-center gap-3 mt-3">
                {(() => {
                  const ig = normalizeInstagramUrl(String((detailsClient as any)?.instagram || ""));
                  if (!ig) return null;
                  return (
                    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => window.open(ig, "_blank", "noopener,noreferrer")}>
                      <Instagram className="h-4 w-4" />
                      Instagram
                    </Button>
                  );
                })()}
                {(() => {
                  const fb = normalizeFacebookUrl(String((detailsClient as any)?.facebook || ""));
                  if (!fb) return null;
                  return (
                    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => window.open(fb, "_blank", "noopener,noreferrer")}>
                      <Facebook className="h-4 w-4" />
                      Facebook
                    </Button>
                  );
                })()}
              </div>
            </div>

            <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
              <p className="text-xs font-semibold text-foreground mb-2">Avalistas</p>
              {detailsGuarantors.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum avalista cadastrado.</p>
              ) : (
                <div className="space-y-2">
                  {detailsGuarantors.map((g: any) => (
                    <div key={String(g.id)} className="text-xs">
                      <p className="font-medium text-foreground">{String(g.name || "—")}</p>
                      <p className="text-muted-foreground">
                        CPF: {String(g.cpf || "—")} · Tel: {String(g.phone || "—")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
              <p className="text-xs font-semibold text-foreground mb-2">Contatos de emergência</p>
              {detailsEmergency.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum contato de emergência cadastrado.</p>
              ) : (
                <div className="space-y-2">
                  {detailsEmergency.map((c: any) => (
                    <div key={String(c.id)} className="text-xs">
                      <p className="font-medium text-foreground">{String(c.name || "—")}</p>
                      <p className="text-muted-foreground">
                        Tel: {String(c.phone || "—")} {c.relationship ? `· ${String(c.relationship)}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setDetailsOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
