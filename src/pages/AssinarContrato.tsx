import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { authorizeLoanByToken, fetchLoanContractPreviewUrlByToken } from "@/api/loan-signature";

function getCanvasPos(canvas: HTMLCanvasElement, e: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function paintCanvasBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.fillStyle = "#e5e7eb"; // cinza claro
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

export default function AssinarContrato() {
  const { token } = useParams<{ token: string }>();
  const tok = String(token || "").trim();
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [contractUrl, setContractUrl] = useState<string>("");
  const [loadingContract, setLoadingContract] = useState(false);
  const [contractError, setContractError] = useState<string>("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const canSubmit = useMemo(() => tok && name.trim() && accepted && !submitting, [tok, name, accepted, submitting]);

  useEffect(() => {
    if (!tok) return;
    let cancelled = false;
    (async () => {
      setLoadingContract(true);
      setContractError("");
      try {
        const res = await fetchLoanContractPreviewUrlByToken({ token: tok });
        if (!res.ok) {
          toast.error(res.error);
          if (!cancelled) setContractError(res.error);
          return;
        }
        if (!cancelled) setContractUrl(res.url);
      } finally {
        if (!cancelled) setLoadingContract(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tok]);

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    paintCanvasBackground(ctx, c.width, c.height);
  };

  const ensureCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    // Ajusta resolução para ficar nítido
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000000";
    paintCanvasBackground(ctx, c.width, c.height);
  };

  const toDataUrl = () => {
    const c = canvasRef.current;
    if (!c) return "";
    return c.toDataURL("image/png");
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return;
    drawingRef.current = true;
    c.setPointerCapture(e.pointerId);
    lastRef.current = getCanvasPos(c, e.nativeEvent);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const last = lastRef.current;
    const next = getCanvasPos(c, e.nativeEvent);
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
    }
    lastRef.current = next;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false;
    const c = canvasRef.current;
    if (!c) return;
    c.releasePointerCapture(e.pointerId);
    lastRef.current = null;
  };

  const submit = async () => {
    if (!tok) return toast.error("Link inválido");
    if (!accepted) return toast.error("Você precisa aceitar os termos");
    if (!name.trim()) return toast.error("Informe seu nome completo");
    const sig = toDataUrl();
    if (!sig) return toast.error("Assine no quadro acima");

    setSubmitting(true);
    try {
      const res = await authorizeLoanByToken({
        token: tok,
        signerName: name.trim(),
        acceptedTerms: accepted,
        signatureDataUrl: sig,
      });
      if (!res.ok) throw new Error(res.error);
      toast.success("Contrato assinado. Empréstimo autorizado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao assinar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Assinar contrato</h1>
        <p className="text-sm text-muted-foreground">
          Leia, aceite os termos e assine para autorizar o empréstimo.
        </p>
      </div>

      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
          <div className="text-sm font-medium text-foreground">Preview do contrato</div>
          <div className="text-xs text-muted-foreground">{loadingContract ? "Carregando..." : contractUrl ? "Pronto" : "Indisponível"}</div>
        </div>
        {contractUrl ? (
          <iframe title="Contrato" src={contractUrl} className="w-full h-[520px] bg-muted" />
        ) : (
          <div className="p-4 text-sm text-muted-foreground bg-muted/40">
            {loadingContract
              ? "Carregando contrato..."
              : contractError
                ? `Não foi possível carregar o contrato: ${contractError}`
                : "Não foi possível carregar o contrato para preview."}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border/60 p-4 space-y-3">
        <div className="grid gap-2">
          <Label>Nome completo *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome completo" />
        </div>

        <div className="grid gap-2">
          <Label>Assinatura *</Label>
          <div className="rounded-md border border-border/60 bg-slate-200 overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full h-40 touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerEnter={() => ensureCanvas()}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={clear}>
              Limpar
            </Button>
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={accepted} onCheckedChange={(v) => setAccepted(Boolean(v))} />
          <span className="text-muted-foreground">
            Eu li e concordo com os termos do contrato e autorizo o empréstimo.
          </span>
        </label>
      </div>

      <Button type="button" disabled={!canSubmit} onClick={submit} className="w-full">
        {submitting ? "Enviando..." : "Assinar e autorizar"}
      </Button>
    </div>
  );
}

