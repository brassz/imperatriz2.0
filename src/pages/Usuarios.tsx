import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { fetchUsers } from "@/api/users";
import { useState } from "react";
import { Pagination } from "@/components/Pagination";
import { PAGE_SIZE } from "@/lib/constants";

const roleColors: Record<string, string> = {
  Admin: "bg-primary/10 text-primary",
  Manager: "bg-warning/10 text-warning",
  User: "bg-muted text-muted-foreground",
};

export default function Usuarios() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["users", page],
    queryFn: () => fetchUsers(page),
  });
  const users = data?.data ?? [];
  const totalUsers = data?.total ?? 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Usuários</h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
        <div className="glass-card p-8 animate-pulse h-64 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Usuários</h1>
          <p className="text-sm text-destructive">Erro ao carregar. Verifique a conexão.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Usuários</h1>
          <p className="text-sm text-muted-foreground">Gestão de usuários do sistema</p>
        </div>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
          <Plus className="h-4 w-4" />
          Novo Usuário
        </Button>
      </div>

      <div className="glass-card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Nome</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Email</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Perfil</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Status</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-4">Último Login</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    Nenhum usuário cadastrado
                  </td>
                </tr>
              ) : (
                users.map((u: Record<string, unknown>, i: number) => (
                  <motion.tr
                    key={String(u.id)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-border/20 hover:bg-surface-hover transition-colors"
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-8 w-8 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                          <AvatarFallback>{String(u.initials)}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium text-foreground">{String(u.name)}</span>
                      </div>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">{String(u.email)}</td>
                    <td className="p-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${roleColors[String(u.role)] || roleColors.User}`}>
                        {String(u.role)}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-success/10 text-success">
                        {String(u.status)}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">{String(u.lastLogin)}</td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={totalUsers} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>
    </div>
  );
}
