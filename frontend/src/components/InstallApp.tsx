import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** "Instalar app": native prompt on Android/Windows (Chrome/Edge), instructions on iPhone/iPad (Safari). */
export function InstallApp() {
  const [evt, setEvt] = useState<PromptEvent | null>(null);
  const [installed, setInstalled] = useState(standalone);
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as PromptEvent); };
    const onInstalled = () => { setInstalled(true); toast.success("Madrila ERP instalado na tela inicial"); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  if (installed || (!evt && !isIos())) return null;
  const click = async () => {
    if (evt) {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      if (outcome === "accepted") setEvt(null);
      return;
    }
    toast.info("No iPhone/iPad: toque em Compartilhar (quadrado com seta) → “Adicionar à Tela de Início”.", { duration: 9000 });
  };
  return (
    <button type="button" onClick={() => void click()} data-testid="install-app-button" aria-label="Instalar app"
      className="flex h-10 items-center gap-1.5 rounded-lg border border-amber/40 px-2.5 text-xs font-medium text-amber transition-colors duration-150 hover:bg-amber/10">
      <Download className="h-4 w-4" /><span className="hidden sm:inline">Instalar app</span>
    </button>
  );
}
