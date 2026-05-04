import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { InteractiveAppBackground } from "@/components/InteractiveAppBackground";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="relative flex min-h-[100dvh] min-h-svh items-center justify-center overflow-x-clip bg-background px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom,0px))] pt-[max(2rem,env(safe-area-inset-top,0px))]">
      <InteractiveAppBackground variant="login" />
      <div className="relative z-10 text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
