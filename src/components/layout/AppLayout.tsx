import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { AutomationQueueProvider } from "@/contexts/AutomationQueueContext";
import { AutomationQueueWidget } from "@/components/automation/AutomationQueueWidget";
import { StartupCobrancaModal } from "@/components/automation/StartupCobrancaModal";
import { InteractiveAppBackground } from "@/components/InteractiveAppBackground";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AutomationQueueProvider>
        <div className="relative min-h-[100dvh] min-h-svh w-full overflow-x-clip">
          <InteractiveAppBackground variant="app" />
          <div className="relative z-10 flex min-h-[100dvh] min-h-svh w-full">
            <AppSidebar />
            <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-transparent">
              <Topbar />
              <main className="flex-1 overflow-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] md:p-6 md:pb-6">
                {children}
              </main>
            </div>
          </div>
        </div>
        <AutomationQueueWidget />
        <StartupCobrancaModal />
      </AutomationQueueProvider>
    </SidebarProvider>
  );
}
