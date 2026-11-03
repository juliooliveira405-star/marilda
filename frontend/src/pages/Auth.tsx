import { SignIn, SignUp } from "@clerk/react";
import { BarChart3, FileSpreadsheet, ShieldCheck, Sparkles } from "lucide-react";
import { CreditBadge } from "@/components/common";

function BrandPanel() {
  const points = [
    { icon: FileSpreadsheet, text: "Envie planilhas VMarket, inventários e PDFs Everest — tudo é lido e calculado sozinho." },
    { icon: BarChart3, text: "CMV mensal, estoque valorizado, curva ABC e sugestão de pedido sempre atualizados." },
    { icon: Sparkles, text: "Diagnósticos com IA e simulador de quanto e em quanto tempo economizar." },
    { icon: ShieldCheck, text: "Acessos por perfil: Gerente, Alimentador e Chefe de Departamento." },
  ];
  return (
    <div className="relative hidden flex-1 flex-col justify-between overflow-hidden border-r border-slate-800/80 bg-[#0A111E] p-12 lg:flex">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-amber/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-emerald/10 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber font-heading text-xl font-bold text-black">M</div>
        <span className="font-heading text-xl font-semibold text-slate-50">Madrila ERP</span>
      </div>
      <div className="relative max-w-lg">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-amber">Inteligência de custos</div>
        <h1 className="font-heading text-4xl font-semibold leading-tight tracking-tight text-slate-50 xl:text-5xl">
          Sua planilha de CMV, agora no piloto automático.
        </h1>
        <ul className="mt-10 space-y-5">
          {points.map((p) => (
            <li key={p.text} className="flex gap-4 text-sm text-slate-300">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-panel text-amber">
                <p.icon className="h-4 w-4" />
              </span>
              <span className="pt-2">{p.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <CreditBadge className="relative" />
    </div>
  );
}

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <BrandPanel />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-4">
        <div className="flex items-center gap-2 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber font-heading text-lg font-bold text-black">M</div>
          <span className="font-heading text-lg font-semibold text-slate-50">Madrila ERP</span>
        </div>
        {children}
        <CreditBadge className="lg:hidden" />
      </div>
    </div>
  );
}

export function SignInPage() {
  return (
    <AuthFrame>
      <div data-testid="sign-in-card">
        <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" withSignUp />
      </div>
    </AuthFrame>
  );
}

export function SignUpPage() {
  return (
    <AuthFrame>
      <div data-testid="sign-up-card">
        <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
      </div>
      <p className="max-w-sm text-center text-xs text-slate-500">
        Novos cadastros ficam <strong className="text-slate-300">pendentes</strong> até um Gerente liberar o perfil de acesso.
      </p>
    </AuthFrame>
  );
}
