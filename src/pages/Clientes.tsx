import { Users, Plus, Search, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchClients } from "@/api/clients";
import { useState, useEffect } from "react";
import { Pagination } from "@/components/Pagination";
import { PAGE_SIZE } from "@/lib/constants";

export default function Clientes() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["clients", page, search],
    queryFn: () => fetchClients(page, search),
    placeholderData: keepPreviousData,
  });
  const clients = data?.data ?? [];
  const totalClients = data?.total ?? 0;

  useEffect(() => {
    setPage(1);
  }, [search]);

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
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
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
                        <span className="text-sm font-medium text-foreground">{String(client.name)}</span>
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
                      <button className="text-muted-foreground hover:text-foreground transition-colors">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={totalClients} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>
    </div>
  );
}
