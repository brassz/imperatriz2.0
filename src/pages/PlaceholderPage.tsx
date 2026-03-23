import { useLocation } from "react-router-dom";
import { Construction } from "lucide-react";
import { motion } from "framer-motion";

const routeNames: Record<string, string> = {
  "/emprestimos": "Empréstimos",
  "/parcelamentos": "Parcelamentos",
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

export default function PlaceholderPage() {
  const location = useLocation();
  const name = routeNames[location.pathname] || "Página";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center min-h-[60vh] space-y-4"
    >
      <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Construction className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-lg font-bold text-foreground">{name}</h2>
      <p className="text-sm text-muted-foreground text-center max-w-md">
        Esta seção será implementada em breve. Conecte o backend para ativar todas as funcionalidades.
      </p>
    </motion.div>
  );
}
