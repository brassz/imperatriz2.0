import { Bell, Search, LogOut } from "lucide-react";
import { useLocation } from "react-router-dom";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";

const routeNames: Record<string, string> = {
  "/": "Dashboard",
  "/clientes": "Clientes",
  "/emprestimos": "Empréstimos",
  "/parcelamentos": "Parcelamentos",
  "/calendario": "Calendário",
  "/funcionarios": "Funcionários",
  "/pagamentos": "Pagamentos",
  "/multas": "Multas",
  "/caixa": "Caixa",
  "/despesas": "Despesas",
  "/captacao": "Captação de Capital",
  "/relatorios": "Relatórios",
  "/pdfs": "PDFs",
  "/configuracoes": "Configurações",
  "/usuarios": "Usuários",
};

export function Topbar() {
  const location = useLocation();
  const currentPage = routeNames[location.pathname] || "Página";
  const { companyName } = useCompany();
  const { logout } = useAuth();

  return (
    <header className="h-14 border-b border-border/50 bg-card/50 backdrop-blur-sm flex items-center justify-between px-4 gap-4 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">{currentPage}</h2>
          <p className="text-[10px] text-muted-foreground">{companyName} / {currentPage}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            className="w-56 h-8 pl-8 text-xs nexus-input bg-secondary border-border/30"
          />
        </div>
        <button className="relative h-8 w-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <Bell className="h-4 w-4" />
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-primary rounded-full animate-pulse-glow" />
        </button>
        <button
          onClick={() => logout()}
          className="h-8 px-3 rounded-lg flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs font-medium"
          title="Desconectar"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Desconectar</span>
        </button>
      </div>
    </header>
  );
}
