import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { UserButton, useAuth, useClerk } from "@clerk/react";
import {
  Calculator,
  LayoutDashboard,
  LogOut,
  Menu,
  PieChart,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  UploadCloud,
  Hourglass,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { setAuthTokenGetter } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useMe } from "@/lib/queries";
import type { Role } from "@/lib/types";
import { CreditBadge, Skeleton } from "@/components/common";
import { cn } from "@/lib/utils";

export const VIEW_ROLES: Role[] = ["gerente", "alimentador", "chefe"];
export const FEED_ROLES: Role[] = ["gerente", "alimentador"];
export const ADMIN_ROLES: Role[] = ["gerente"];

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; roles: Role[]; testId: string }[] = [
  { to: "/painel", label: "Painel Executivo", icon: LayoutDashboard, roles: VIEW_ROLES, testId: "nav-painel" },
  { to: "/cmv-estoque", label: "CMV & Estoque", icon: TrendingDown, roles: VIEW_ROLES, testId: "nav-cmv-estoque" },
  { to: "/fornecedores-abc", label: "Curva ABC Fornecedores", icon: PieChart, roles: VIEW_ROLES, testId: "nav-fornecedores" },
  { to: "/sugestao-pedidos", label: "Sugestão de Pedidos", icon: ShoppingCart, roles: VIEW_ROLES, testId: "nav-sugestao" },
  { to: "/economia", label: "Simulador de Economia", icon: Calculator, roles: VIEW_ROLES, testId: "nav-economia" },
  { to: "/insights-ia", label: "Insights & Diagnóstico IA", icon: Sparkles, roles: VIEW_ROLES, testId: "nav-insights" },
  { to: "/carregar-dados", label: "Carregar Dados & PDFs", icon: UploadCloud, roles: FEED_ROLES, testId: "nav-carregar" },
  { to: "/administracao", label: "Administração & Metas", icon: ShieldCheck, roles: ADMIN_ROLES, testId: "nav-admin" },
];

// Registers Clerk's token getter for api.ts and wipes cached data whenever the account changes.
function AuthBridge({ children }: { children: ReactNode }) {
  const { getToken, userId } = useAuth();
  setAuthTokenGetter(() => getToken());
  const prev = useRef(userId);
  useEffect(() => {
    if (prev.current !== userId) {
      queryClient.clear();
      prev.current = userId;
    }
  }, [userId]);
  return <>{children}</>;
}

function NavList({ role, onNavigate }: { role: Role | undefined; onNavigate?: () => void }) {
  const items = NAV.filter((n) => role && n.roles.includes(role));
  return (
    <nav className="flex flex-col gap-1">
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          onClick={onNavigate}
          data-testid={n.testId}
          className={({ isActive }) =>
            cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-[background-color,color] duration-150",
              isActive ? "bg-amber/10 text-amber" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100",
            )
          }
        >
          <n.icon className="h-4 w-4 shrink-0" />
          <span>{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber font-heading text-lg font-bold text-black shadow-[0_0_24px_rgba(245,158,11,0.35)]">
        M
      </div>
      <div>
        <div className="font-heading text-base font-semibold leading-tight text-slate-50">Madrila ERP</div>
        <div className="text-[11px] text-slate-500">CMV · Estoque · Compras</div>
      </div>
    </div>
  );
}

function SidebarFooter({ email, roleLabel }: { email?: string; roleLabel?: string }) {
  const { signOut } = useClerk();
  return (
    <div className="space-y-3 border-t border-slate-800/80 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs text-slate-300" data-testid="sidebar-user-email">{email ?? "—"}</div>
          <span data-testid="user-role-badge" className="mt-1 inline-flex rounded bg-amber/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber">
            {roleLabel ?? "…"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="sign-out-button"
          aria-label="Sair"
          onClick={async () => {
            await signOut();
            queryClient.clear();
          }}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
      <CreditBadge />
    </div>
  );
}

function PendingScreen() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center" data-testid="pending-screen">
      <div className="max-w-md rounded-2xl border border-slate-800 bg-panel p-8 text-center animate-rise">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber/10 text-amber animate-pulse-ring">
          <Hourglass className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-slate-50">Aguardando aprovação</h1>
        <p className="mt-2 text-sm text-slate-400">
          Sua conta foi criada. Um <strong className="text-slate-200">Gerente</strong> precisa definir seu perfil
          (Alimentador ou Chefe de Departamento) em Administração para liberar o acesso.
        </p>
        <Button variant="outline" className="mt-6" data-testid="pending-refresh-button" onClick={() => void queryClient.invalidateQueries()}>
          Já fui aprovado — atualizar
        </Button>
      </div>
    </div>
  );
}

export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return null;
  if (!roles.includes(me.role))
    return (
      <div data-testid="no-access" className="rounded-xl border border-slate-800 bg-panel p-8 text-center text-sm text-slate-400">
        Seu perfil ({me.role_label}) não tem acesso a esta área.
      </div>
    );
  return <>{children}</>;
}

function Shell() {
  const { data: me, isLoading, isError } = useMe();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const role = me?.role;

  let content: ReactNode;
  if (isLoading) content = <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  else if (isError || !me)
    content = (
      <div data-testid="me-error" className="rounded-xl border border-slate-800 bg-panel p-8 text-sm text-slate-400">
        Não foi possível carregar seu perfil agora. Verifique a conexão e atualize a página.
      </div>
    );
  else if (me.role === "pendente") content = <PendingScreen />;
  else content = <Outlet />;

  return (
    <div className="min-h-screen bg-background grid-bg">
      <aside data-testid="erp-sidebar" className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col justify-between border-r border-slate-800/80 bg-sidebar p-5 lg:flex">
        <div className="space-y-8">
          <Brand />
          <NavList role={role} />
        </div>
        <SidebarFooter email={me?.email} roleLabel={me?.role_label} />
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-800/60 bg-slate-950/80 px-4 py-3 backdrop-blur-xl lg:ml-64 lg:px-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" data-testid="mobile-menu-button" aria-label="Menu" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="lg:hidden"><Brand /></div>
          <CreditBadge className="hidden lg:inline-flex" />
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-slate-500 sm:inline" data-testid="header-company">Locale POA</span>
          <UserButton />
        </div>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 border-slate-800 bg-sidebar p-5">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="flex h-full flex-col justify-between gap-6">
            <div className="space-y-8">
              <Brand />
              <NavList role={role} onNavigate={() => setOpen(false)} />
            </div>
            <SidebarFooter email={me?.email} roleLabel={me?.role_label} />
          </div>
        </SheetContent>
      </Sheet>

      <main key={location.pathname} className="px-4 py-6 lg:ml-64 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1400px]">{content}</div>
        <footer className="mx-auto mt-12 max-w-[1400px] border-t border-slate-800/60 pt-4 pb-6">
          <CreditBadge />
        </footer>
      </main>
    </div>
  );
}

export default function AppLayout() {
  return (
    <AuthBridge>
      <Shell />
    </AuthBridge>
  );
}
