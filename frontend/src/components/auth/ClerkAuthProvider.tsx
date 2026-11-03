import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClerkProvider } from "@clerk/react";
import { dark } from "@clerk/ui/themes";

// Brand Clerk here once: it styles sign-in, sign-up and the user menu.
const appearance = {
  theme: dark,
  captcha: { theme: "dark" as const },
  variables: {
    colorPrimary: "#F59E0B",
    colorPrimaryForeground: "#000000",
    colorBackground: "#111827",
    colorForeground: "#F1F5F9",
    colorInput: "#0B0F17",
    colorInputForeground: "#F1F5F9",
    fontFamily: "'Plus Jakarta Sans Variable', sans-serif",
    borderRadius: "0.6rem",
  },
};

interface ClerkConfig {
  enabled: boolean;
  publishable_key: string;
  proxy_url: string;
}

// Starts Clerk from the backend's runtime config, so deploy's live keys need no rebuild.
// Must render inside <BrowserRouter> so Clerk navigates without reloading.
export default function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<ClerkConfig | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // Retries while the backend restarts (e.g. right after provisioning): the app's
  // Clerk components crash if they ever render without <ClerkProvider>.
  useEffect(() => {
    let cancelled = false;
    const load = async (attempt = 0): Promise<void> => {
      try {
        const cfg = (await (await fetch(`/api/clerk/config`)).json()) as ClerkConfig;
        if (cfg.enabled) {
          if (!cancelled) setConfig(cfg);
          return;
        }
      } catch {
        /* retry below */
      }
      if (cancelled) return;
      if (attempt >= 20) {
        setUnavailable(true);
        return;
      }
      setTimeout(() => void load(attempt + 1), 1500);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (unavailable)
    return (
      <p style={{ padding: 24 }} data-testid="auth-unavailable">
        O login está indisponível no momento. Atualize a página para tentar novamente.
      </p>
    );
  if (!config) return null;
  return (
    <ClerkProvider
      publishableKey={config.publishable_key}
      proxyUrl={config.proxy_url || undefined}
      appearance={appearance}
      routerPush={(to: string) => navigate(to)}
      routerReplace={(to: string) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  );
}
