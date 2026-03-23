import { TrendingUp } from "lucide-react";
import { motion } from "framer-motion";

export default function Captacao() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Captação de Capital</h1>
        <p className="text-sm text-muted-foreground">Gestão de captação de investimentos</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass-card p-8 text-center"
      >
        <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <TrendingUp className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-lg font-bold mb-2 text-foreground">Captação de Capital</h2>
        <p className="text-sm text-muted-foreground">Funcionalidade disponível ao conectar o backend.</p>
      </motion.div>
    </div>
  );
}
