import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
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
  QrCode,
  PackageMinus,
  Bell,
  Bike,
  AlertTriangle,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMutation } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import { qk } from "@/lib/queries";
import { dateTimeBr } from "@/lib/format";
import type { Notifications } from "@/lib/types";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { setAuthTokenGetter } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useMe, useNotifications } from "@/lib/queries";
import { toast } from "sonner";
import type { Me } from "@/lib/types";
import { InstallApp } from "@/components/InstallApp";
import { CreditBadge, Skeleton } from "@/components/common";
import { cn } from "@/lib/utils";

import { allowed, type Gate } from "@/lib/roles";
const IDLE_MS = 30 * 60 * 1000;

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; gate: Gate; testId: string }[] = [
  { to: "/painel", label: "Painel Executivo", icon: LayoutDashboard, gate: "view", testId: "nav-painel" },
  { to: "/cmv-estoque", label: "CMV & Estoque", icon: TrendingDown, gate: "costs", testId: "nav-cmv-estoque" },
  { to: "/fornecedores-abc", label: "Curva ABC Fornecedores", icon: PieChart, gate: "full", testId: "nav-fornecedores" },
  { to: "/sugestao-pedidos", label: "Sugestão de Pedidos", icon: ShoppingCart, gate: "view", testId: "nav-sugestao" },
  { to: "/contagem-qr", label: "Contagem por QR Code", icon: QrCode, gate: "view", testId: "nav-contagem-qr" },
  { to: "/requisicoes", label: "Requisições", icon: PackageMinus, gate: "view", testId: "nav-requisicoes" },
  { to: "/economia", label: "Simulador de Economia", icon: Calculator, gate: "full", testId: "nav-economia" },
  { to: "/insights-ia", label: "Insights & Diagnóstico IA", icon: Sparkles, gate: "full", testId: "nav-insights" },
  { to: "/ifood", label: "iFood", icon: Bike, gate: "ifood", testId: "nav-ifood" },
  { to: "/carregar-dados", label: "Carregar Dados & PDFs", icon: UploadCloud, gate: "upload", testId: "nav-carregar" },
  { to: "/administracao", label: "Administração & Metas", icon: ShieldCheck, gate: "manage", testId: "nav-admin" },
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

function NavList({ me, onNavigate, badge }: { me: Me | undefined; onNavigate?: () => void; badge: number }) {
  const items = NAV.filter((n) => allowed(me, n.gate));
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
          {n.to === "/requisicoes" && badge > 0 && (
            <span data-testid="nav-requisicoes-badge" className="ml-auto rounded-full bg-[#F87171] px-1.5 text-[10px] font-bold text-black">{badge}</span>
          )}
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

function SidebarFooter({ email, roleLabel, sector }: { email?: string; roleLabel?: string; sector?: string | null }) {
  const { signOut } = useClerk();
  return (
    <div className="space-y-3 border-t border-slate-800/80 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs text-slate-300" data-testid="sidebar-user-email">{email ?? "—"}</div>
          <span data-testid="user-role-badge" className="mt-1 inline-flex rounded bg-amber/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber">
            {roleLabel ?? "…"}{sector ? ` · ${sector}` : ""}
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

export function RoleGate({ gate, children }: { gate: Gate; children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return null;
  if (!allowed(me, gate))
    return (
      <div data-testid="no-access" className="rounded-xl border border-slate-800 bg-panel p-8 text-center text-sm text-slate-400">
        Seu perfil ({me.role_label}) não tem acesso a esta área.
      </div>
    );
  return <>{children}</>;
}

// Signs out after 30 min without interaction (also when the phone wakes after a long pause).
// The last-activity time lives only in memory — nothing is persisted in the browser.
function useIdleLogout() {
  const { signOut } = useClerk();
  const navigate = useNavigate();
  useEffect(() => {
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    const check = async () => {
      if (Date.now() - last > IDLE_MS) {
        last = Date.now();
        await signOut();
        queryClient.clear();
        toast.info("Sessão encerrada por inatividade (30 min). Entre novamente.");
        navigate("/sign-in", { replace: true });
      }
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const onVis = () => void (document.visibilityState === "visible" && check());
    document.addEventListener("visibilitychange", onVis);
    const t = window.setInterval(() => void check(), 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(t);
    };
  }, [signOut, navigate]);
}

function useNotificationToasts(enabled: boolean) {
  const { data } = useNotifications();
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || !data) return;
    if (prev.current !== null && data.count > prev.current && data.items[0]) {
      const n = data.items[0];
      (n.priority === "urgente" ? toast.warning : toast.info)(n.message);
    }
    prev.current = data.count;
  }, [data, enabled]);
  return enabled ? (data?.count ?? 0) : 0;
}

function NotificationBell() {
  const { data } = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const save = (r: Notifications) => queryClient.setQueryData(qk.notifications, r);
  const read = useMutation({ mutationFn: (id: string) => apiPost<Notifications>(`/notifications/${id}/read`, {}), onSuccess: save });
  const seen = useMutation({ mutationFn: () => apiPost<Notifications>("/notifications/seen", {}), onSuccess: save });
  const count = data?.count ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="notification-bell"
        aria-label={`Notificações (${count})`}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 transition-colors duration-150 hover:bg-slate-800/70 hover:text-amber"
      >
        <Bell className={cn("h-5 w-5", count > 0 && "text-amber")} />
        {count > 0 && (
          <span data-testid="notification-bell-badge" className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-[#F87171] px-1 text-center text-[10px] font-bold leading-5 text-black">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] border-slate-800 bg-panel p-0" data-testid="notification-panel">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-semibold text-slate-100">Notificações</span>
          {count > 0 && (
            <button className="text-xs text-amber hover:underline" data-testid="notification-mark-all" onClick={() => seen.mutate()}>
              Marcar todas como vistas
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {data?.meses.map((m) => (
            <div key={m} className="flex gap-2 border-b border-slate-800/70 bg-amber/5 px-4 py-2.5 text-xs text-amber" data-testid="notification-month-alert">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{m}</span>
            </div>
          ))}
          {data?.validades.map((v) => (
            <button
              key={v.code}
              data-testid={`notification-validade-${v.code}`}
              className="flex w-full gap-2 border-b border-slate-800/70 bg-[#450A0A]/30 px-4 py-2.5 text-left text-xs text-[#FCA5A5] transition-colors duration-150 hover:bg-[#450A0A]/50"
              onClick={() => {
                setOpen(false);
                navigate("/contagem-qr#validades");
              }}
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>{v.dias < 0 ? "Vencido" : v.dias === 0 ? "Vence hoje" : `Vence em ${v.dias} dia${v.dias > 1 ? "s" : ""}`}</strong> · {v.descricao} · {v.sector}
              </span>
            </button>
          ))}
          {data?.items.length ? (
            data.items.map((n) => (
              <button
                key={n.id}
                data-testid={`notification-item-${n.id}`}
                className="block w-full border-b border-slate-800/70 px-4 py-3 text-left transition-colors duration-150 hover:bg-slate-800/50"
                onClick={() => {
                  read.mutate(n.id);
                  setOpen(false);
                  navigate(`/requisicoes?abrir=${n.req_id}`);
                }}
              >
                <div className="flex items-center gap-2">
                  {n.priority === "urgente" && <span className="rounded bg-[#450A0A] px-1.5 text-[9px] font-bold uppercase text-[#F87171]">Urgente</span>}
                  <span className="text-[11px] text-slate-500">{dateTimeBr(n.at)}</span>
                </div>
                <div className="mt-1 text-sm text-slate-200">{n.message}</div>
              </button>
            ))
          ) : !data?.validades.length ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500" data-testid="notification-empty">Nenhuma notificação nova.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Shell() {
  const { data: me, isLoading, isError } = useMe();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const role = me?.role;
  useIdleLogout();
  const badge = useNotificationToasts(!!role && role !== "pendente");

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
          <NavList me={me} badge={badge} />
        </div>
        <SidebarFooter email={me?.email} roleLabel={me?.role_label} sector={me?.sector} />
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
          <InstallApp />
          {role && role !== "pendente" && <NotificationBell />}
          <UserButton />
        </div>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 border-slate-800 bg-sidebar p-5">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="flex h-full flex-col justify-between gap-6">
            <div className="space-y-8">
              <Brand />
              <NavList me={me} badge={badge} onNavigate={() => setOpen(false)} />
            </div>
            <SidebarFooter email={me?.email} roleLabel={me?.role_label} sector={me?.sector} />
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
