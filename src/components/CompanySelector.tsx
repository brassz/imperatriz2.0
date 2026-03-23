import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";

export function CompanySelector() {
  const { companyId, setCompany, companies } = useCompany();

  return (
    <Select value={companyId} onValueChange={(v) => setCompany(v as typeof companyId)}>
      <SelectTrigger
        className="h-8 w-[180px] gap-2 bg-secondary/50 border-border/50 text-xs font-medium nexus-input"
        title="Selecionar empresa"
      >
        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <SelectValue placeholder="Empresa" />
      </SelectTrigger>
      <SelectContent>
        {companies.map((c) => (
          <SelectItem key={c.id} value={c.id} className="text-xs">
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
