import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

/**
 * Service workers de ambientes de preview (ex.: plataformas tipo Lovable) costumam usar cache-first e
 * interceptar fetch — isso quebra POST para /api/* e gera 405 ou "Failed to fetch".
 * Desregistramos por padrão; defina VITE_KEEP_SERVICE_WORKER=true para manter.
 */
if (import.meta.env.VITE_KEEP_SERVICE_WORKER !== "true" && "serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) void r.unregister();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
