type Props = {
  /** Login: luz um pouco mais forte */
  variant?: "app" | "login";
};

/**
 * Fundo fixo com malha sutil, orbes lentos e luz que se move e cintila sozinha (sem cursor).
 */
export function InteractiveAppBackground({ variant = "app" }: Props) {
  const spotlightCore = variant === "login" ? 0.2 : 0.1;
  const spotlightMid = variant === "login" ? 0.08 : 0.045;
  const blobPrimary = variant === "login" ? "0.14" : "0.08";

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      {/* Base + malha discreta */}
      <div
        className="absolute inset-0 bg-background"
        style={{
          backgroundImage: `
            linear-gradient(hsl(var(--border) / 0.35) 1px, transparent 1px),
            linear-gradient(90deg, hsl(var(--border) / 0.35) 1px, transparent 1px)
          `,
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 85% 70% at 50% 40%, black 20%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 85% 70% at 50% 40%, black 20%, transparent 75%)",
          opacity: 0.45,
        }}
      />

      {/* Luz principal — percorre a viewport + cintila */}
      <div className="absolute left-1/2 top-1/2 h-[min(140vmin,920px)] w-[min(140vmin,920px)] nexus-light-drift">
        <div
          className="h-full w-full nexus-light-twinkle rounded-full"
          style={{
            background: `radial-gradient(
              circle closest-side at 50% 50%,
              hsl(var(--primary) / ${spotlightCore}),
              hsl(var(--primary) / ${spotlightMid}) 32%,
              transparent 58%
            )`,
            filter: "blur(1px)",
          }}
        />
      </div>

      {/* Segundo facho — ritmo e trajetória diferentes (mais “sintilante”) */}
      <div className="absolute left-1/2 top-1/2 h-[min(100vmin,640px)] w-[min(100vmin,640px)] nexus-light-drift-alt">
        <div
          className="h-full w-full nexus-light-twinkle-slow rounded-full opacity-80"
          style={{
            background: `radial-gradient(
              circle closest-side at 50% 50%,
              hsl(var(--primary) / ${variant === "login" ? 0.12 : 0.06}),
              transparent 52%
            )`,
            filter: "blur(2px)",
          }}
        />
      </div>

      {/* Orbes lentos */}
      <div
        className={`absolute -left-[12%] top-[18%] h-[min(55vw,480px)] w-[min(55vw,480px)] rounded-full blur-[100px] nexus-blob-1 ${variant === "login" ? "opacity-90" : "opacity-60"}`}
        style={{ backgroundColor: `hsl(var(--primary) / ${blobPrimary})` }}
      />
      <div
        className={`absolute -right-[12%] bottom-[20%] h-[min(50vw,420px)] w-[min(50vw,420px)] rounded-full blur-[110px] nexus-blob-2 ${variant === "login" ? "opacity-80" : "opacity-50"}`}
        style={{ backgroundColor: "hsl(200 40% 42% / 0.07)" }}
      />
      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2">
        <div
          className="h-[min(40vw,320px)] w-[min(40vw,320px)] rounded-full blur-[90px] nexus-blob-pulse opacity-45"
          style={{ backgroundColor: `hsl(var(--primary) / ${variant === "login" ? "0.06" : "0.04"})` }}
        />
      </div>

      {/* Vinheta suave nas bordas */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 75% 65% at 50% 45%, transparent 0%, hsl(var(--background) / 0.55) 100%)",
        }}
      />
    </div>
  );
}
