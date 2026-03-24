import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Clientes from "./pages/Clientes";
import Emprestimos from "./pages/Emprestimos";
import Parcelamentos from "./pages/Parcelamentos";
import Calendario from "./pages/Calendario";
import Funcionarios from "./pages/Funcionarios";
import Pagamentos from "./pages/Pagamentos";
import Multas from "./pages/Multas";
import Caixa from "./pages/Caixa";
import Despesas from "./pages/Despesas";
import Captacao from "./pages/Captacao";
import Relatorios from "./pages/Relatorios";
import PDFs from "./pages/PDFs";
import Historico from "./pages/Historico";
import Remarketing from "./pages/Remarketing";
import Configuracoes from "./pages/Configuracoes";
import Usuarios from "./pages/Usuarios";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <CompanyProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<AppLayout><Dashboard /></AppLayout>} />
              <Route path="/clientes" element={<AppLayout><Clientes /></AppLayout>} />
              <Route path="/emprestimos" element={<AppLayout><Emprestimos /></AppLayout>} />
              <Route path="/parcelamentos" element={<AppLayout><Parcelamentos /></AppLayout>} />
              <Route path="/calendario" element={<AppLayout><Calendario /></AppLayout>} />
              <Route path="/funcionarios" element={<AppLayout><Funcionarios /></AppLayout>} />
              <Route path="/pagamentos" element={<AppLayout><Pagamentos /></AppLayout>} />
              <Route path="/multas" element={<AppLayout><Multas /></AppLayout>} />
              <Route path="/caixa" element={<AppLayout><Caixa /></AppLayout>} />
              <Route path="/despesas" element={<AppLayout><Despesas /></AppLayout>} />
              <Route path="/captacao" element={<AppLayout><Captacao /></AppLayout>} />
              <Route path="/relatorios" element={<AppLayout><Relatorios /></AppLayout>} />
              <Route path="/pdfs" element={<AppLayout><PDFs /></AppLayout>} />
              <Route path="/historico" element={<AppLayout><Historico /></AppLayout>} />
              <Route path="/remarketing" element={<AppLayout><Remarketing /></AppLayout>} />
              <Route path="/configuracoes" element={<AppLayout><Configuracoes /></AppLayout>} />
              <Route path="/usuarios" element={<AppLayout><Usuarios /></AppLayout>} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </CompanyProvider>
  </QueryClientProvider>
);

export default App;
