import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { consultInfoseekCpf, type InfoseekConsultResult } from "@/api/infoseek";
import { InfoseekConsultBody } from "@/components/InfoseekConsultBody";

export default function Consultas() {
  const [cpf, setCpf] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InfoseekConsultResult | null>(null);

  const buscar = async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await consultInfoseekCpf(cpf);
      setResult(r);
      toast.success("Consulta concluída");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na consulta");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Consultas</h1>
        <p className="text-sm text-muted-foreground">
          Busca por CPF para consulta complementar (inclui score Serasa quando a consulta retornar), sem cadastrar cliente.
        </p>
      </div>

      <div className="glass-card p-6 space-y-4 max-w-xl">
        <div className="space-y-2">
          <Label className="text-xs">CPF</Label>
          <div className="flex gap-2">
            <Input
              className="font-mono text-sm"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
              onKeyDown={(e) => {
                if (e.key === "Enter") void buscar();
              }}
            />
            <Button type="button" className="shrink-0 gap-2" disabled={loading} onClick={() => void buscar()}>
              <Search className="h-4 w-4" />
              {loading ? "Buscando…" : "Buscar"}
            </Button>
          </div>
        </div>
      </div>

      {result ? (
        <div className="glass-card p-6 max-w-2xl space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Resultado</h2>
          <div className="rounded-md border border-border/40 bg-muted/20 p-4 space-y-3">
            <InfoseekConsultBody result={result} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
