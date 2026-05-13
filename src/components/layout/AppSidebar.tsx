import { memo } from "react";
import {
  LayoutDashboard, Users, Search, Landmark, CalendarCheck, CalendarDays, CreditCard,
  AlertTriangle, Wallet, Receipt, TrendingUp, History, IdCard, Sparkles,
  BarChart3, FileText, Settings, UserCog, ChevronLeft, LogOut, MessageCircle
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "Consultas", url: "/consultas", icon: Search },
  { title: "Empréstimos", url: "/emprestimos", icon: Landmark },
  { title: "Parcelamentos", url: "/parcelamentos", icon: CalendarCheck },
  { title: "Calendário", url: "/calendario", icon: CalendarDays },
  { title: "Funcionários", url: "/funcionarios", icon: IdCard },
  { title: "Pagamentos", url: "/pagamentos", icon: CreditCard },
  { title: "Atendimento", url: "/atendimento", icon: MessageCircle },
  { title: "Multas", url: "/multas", icon: AlertTriangle },
  { title: "Histórico", url: "/historico", icon: History },
  { title: "Remarketing", url: "/remarketing", icon: Sparkles },
];

const financialItems = [
  { title: "Caixa", url: "/caixa", icon: Wallet },
  { title: "Despesas", url: "/despesas", icon: Receipt },
  { title: "Captação de Capital", url: "/captacao", icon: TrendingUp },
];

const systemItems = [
  { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
  { title: "PDFs", url: "/pdfs", icon: FileText },
  { title: "Gestão de Tráfego", url: "/gestao-trafego", icon: BarChart3 },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
  { title: "Usuários", url: "/usuarios", icon: UserCog },
];

const SidebarSection = memo(function SidebarSection({ label, items }: { label: string; items: typeof mainItems }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <SidebarGroup>
      {!collapsed && (
        <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-1">
          {label}
        </SidebarGroupLabel>
      )}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild className="min-h-11 h-11 py-2 md:min-h-9 md:h-9">
                <NavLink
                  to={item.url}
                  end={item.url === "/"}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors duration-75"
                  activeClassName="bg-primary/10 text-primary border-l-2 border-primary font-medium"
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="text-sm">{item.title}</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
});

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "U";
}

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const { user, logout } = useAuth();

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Landmark className="h-4 w-4 text-primary" />
            </div>
            {!collapsed && (
              <div>
                <h1 className="text-sm font-bold text-foreground tracking-tight">NEXUS</h1>
                <p className="text-[10px] text-muted-foreground">Gestão Financeira</p>
              </div>
            )}
          </div>
          {!collapsed && (
            <button onClick={toggleSidebar} className="text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3 space-y-1">
        <SidebarSection label="Principal" items={mainItems} />
        <SidebarSection label="Financeiro" items={financialItems} />
        <SidebarSection label="Sistema" items={systemItems} />
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-sidebar-border space-y-2">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
              {user ? getInitials(user.full_name) : "AD"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{user?.full_name ?? "Admin"}</p>
              <p className="text-[10px] text-muted-foreground truncate">{user?.email ?? "admin@nexus.com"}</p>
            </div>
          </div>
        )}
        <button
          onClick={() => logout()}
          className="w-full h-8 flex items-center justify-center gap-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors text-xs font-medium"
          title="Desconectar"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Desconectar</span>}
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
