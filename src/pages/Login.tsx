import { useState } from "react";
import { Landmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { CompanySelector } from "@/components/CompanySelector";
import { InteractiveAppBackground } from "@/components/InteractiveAppBackground";
import { toast } from "sonner";

export default function Login() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [step, setStep] = useState<"email" | "token">("email");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { requestToken, verifyToken, isAuthenticated } = useAuth();
  const { companyId } = useCompany();

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleRequestToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Preencha o email");
      return;
    }
    setIsSubmitting(true);
    try {
      await requestToken(companyId as string, email.trim());
      toast.success("Token enviado no WhatsApp");
      setStep("token");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar token");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !token.trim()) {
      toast.error("Preencha email e token");
      return;
    }
    setIsSubmitting(true);
    try {
      await verifyToken(companyId as string, email.trim(), token.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Token inválido");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] min-h-svh items-center justify-center overflow-x-clip overflow-y-auto bg-background px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom,0px))] pt-[max(2rem,env(safe-area-inset-top,0px))]">
      <InteractiveAppBackground variant="login" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-sm"
      >
        <div className="glass-card p-8 space-y-6">
          {/* Logo */}
          <div className="text-center space-y-2">
            <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center mx-auto">
              <Landmark className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">NEXUS</h1>
            <p className="text-xs text-muted-foreground">Gestão Financeira</p>
          </div>

          <form onSubmit={step === "email" ? handleRequestToken : handleVerifyToken} className="space-y-4">
            <div className="space-y-1.5 w-full">
              <label className="text-xs font-medium text-muted-foreground block text-center">Empresa</label>
              <CompanySelector />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input
                type="email"
                autoComplete="email"
                placeholder="admin@nexus.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="nexus-input"
              />
            </div>

            {step === "token" ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Token (WhatsApp)</label>
                <Input
                  inputMode="numeric"
                  placeholder="000000"
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                  className="nexus-input"
                />
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    setToken("");
                    setStep("email");
                  }}
                >
                  Voltar e reenviar token
                </button>
              </div>
            ) : null}

            <Button type="submit" disabled={isSubmitting} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">
              {step === "email"
                ? isSubmitting
                  ? "Enviando token..."
                  : "Continuar"
                : isSubmitting
                  ? "Validando..."
                  : "Entrar"}
            </Button>
          </form>

          <p className="text-[10px] text-center text-muted-foreground">
            © 2026 NEXUS Gestão Financeira
          </p>
        </div>
      </motion.div>
    </div>
  );
}
