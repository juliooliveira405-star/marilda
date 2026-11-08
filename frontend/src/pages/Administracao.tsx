import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Mail, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, Skeleton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiDelete, apiDownload, apiPatch, apiPost, apiPut, errorMessage } from "@/lib/api";
import { qk, useAudit, useMe, useSettings, useUsers } from "@/lib/queries";
import type { Invite, InviteIn, Role, Settings, UserRow } from "@/lib/types";
import { cn } from "@/lib/utils";

const ASSIGNABLE: { value: Exclude<Role, "pendente">; label: string }[] = [
  { value: "gerente", label: "Gerente" },
  { value: "alimentador", label: "Alimentador" },
  { value: "chefe", label: "Chefe de Departamento" },
];

const CHEF_SECTORS = ["Cozinha", "Bar", "Salão", "Quiosque"];

function SectorPicker({ value, onChange, testId }: { value: string; onChange: (s: string) => void; testId: string }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid={testId}>
      {CHEF_SECTORS.map((s) => (
        <button key={s} type="button" data-testid={`${testId}-${s}`} onClick={() => onChange(s)}
          className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors duration-150", value === s ? "border-amber bg-amber/10 text-amber" : "border-slate-800 text-slate-300")}>{s}</button>
      ))}
    </div>
  );
}

function ApproveDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<string>("");
  const [sector, setSector] = useState("");
  const approve = useMutation({
    mutationFn: () => apiPatch<UserRow>(`/users/${user?.user_id}/role`, { role, sector: role === "chefe" ? sector : null }),
    onSuccess: (u) => {
      toast.success(`${u.email || "Usuário"} aprovado como ${u.role_label}`);
      void qc.invalidateQueries({ queryKey: qk.users });
      setRole("");
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o) { setRole(""); onClose(); } }}>
      <DialogContent data-testid="approve-user-dialog">
        <DialogHeader>
          <DialogTitle>{user?.status === "pendente" ? "Aprovar" : "Alterar perfil de"} {user?.email}</DialogTitle>
          <DialogDescription>Escolha o perfil de acesso (obrigatório). Chefe precisa de setor.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {ASSIGNABLE.map((r) => (
            <button key={r.value} data-testid={`approve-role-${r.value}`} onClick={() => setRole(r.value)}
              className={cn("rounded-lg border px-3 py-2.5 text-left text-sm transition-[border-color,background-color] duration-150",
                role === r.value ? "border-amber bg-amber/10 text-amber" : "border-slate-800 text-slate-300 hover:border-slate-600")}>
              {r.label}
            </button>
          ))}
        </div>
        {role === "chefe" && <SectorPicker value={sector} onChange={setSector} testId="approve-sector" />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="approve-cancel-button">Cancelar</Button>
          <Button disabled={!role || (role === "chefe" && !sector) || approve.isPending} onClick={() => approve.mutate()} data-testid="approve-confirm-button">
            {approve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Aprovar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvitePanel({ invites }: { invites: Invite[] }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteIn["role"]>("alimentador");
  const [sector, setSector] = useState("");
  const send = useMutation({
    mutationFn: () => apiPost<Invite>("/users/invite", { email, role, sector: role === "chefe" ? sector : null }),
    onSuccess: (i) => {
      toast.success(`Convite enviado para ${i.email} (${i.role_label})`);
      setEmail("");
      void qc.invalidateQueries({ queryKey: qk.users });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível enviar o convite")),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete<Invite>(`/users/invites/${id}`),
    onSuccess: () => { toast.success("Convite cancelado"); void qc.invalidateQueries({ queryKey: qk.users }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="Convidar por e-mail" testId="admin-invite-panel">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input data-testid="invite-email-input" type="email" placeholder="email@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Select value={role} onValueChange={(v: string) => setRole(v as InviteIn["role"])}>
          <SelectTrigger className="w-full sm:w-56" data-testid="invite-role-select"><SelectValue>{(v: string) => ASSIGNABLE.find((r) => r.value === v)?.label}</SelectValue></SelectTrigger>
          <SelectContent>{ASSIGNABLE.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button data-testid="invite-send-button" disabled={!/^\S+@\S+\.\S+$/.test(email) || (role === "chefe" && !sector) || send.isPending} onClick={() => send.mutate()}>
          {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Convidar
        </Button>
      </div>
      {role === "chefe" && <div className="mt-3"><SectorPicker value={sector} onChange={setSector} testId="invite-sector" /></div>}
      <p className="mt-2 text-xs text-slate-500">A pessoa recebe um e-mail, cria a senha e já entra com o perfil escolhido.</p>
      {invites.length > 0 && (
        <ul className="mt-4 space-y-2" data-testid="invite-list">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm" data-testid={`invite-row-${i.id}`}>
              <span className="min-w-0 truncate">{i.email} <span className="text-xs text-slate-500">· {i.role_label} · convidado</span></span>
              <Button variant="ghost" size="xs" data-testid={`invite-revoke-${i.id}`} onClick={() => revoke.mutate(i.id)}>Cancelar</Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function UsersPanel() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data, isLoading, isError } = useUsers(true);
  const [approving, setApproving] = useState<UserRow | null>(null);
  const labels = Object.fromEntries((data?.roles ?? []).map((r) => [r.value, r.label])) as Record<string, string>;
  const users = isError ? [] : (data?.users ?? []);
  const pendingCount = users.filter((u) => u.status === "pendente").length;

  const change = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => apiPatch<UserRow>(`/users/${id}/role`, { role }),
    onSuccess: (u) => {
      toast.success(`${u.email || "Usuário"} agora é ${u.role_label}`);
      void qc.invalidateQueries({ queryKey: qk.users });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const roleControl = (u: UserRow, prefix = "admin") =>
    u.status === "pendente" ? (
      <Button size="sm" data-testid={`${prefix}-approve-${u.user_id}`} onClick={() => setApproving(u)}>
        <UserCheck className="mr-1 h-4 w-4" />Aprovar
      </Button>
    ) : (
      <Select value={u.role} onValueChange={(v: string) => { if (v === "chefe") setApproving(u); else if (v !== u.role) change.mutate({ id: u.user_id, role: v }); }}>
        <SelectTrigger size="sm" className="w-full sm:w-56" data-testid={`${prefix}-user-role-select-${u.user_id}`}><SelectValue>{(v: string) => `${labels[v] ?? v}${v === "chefe" && u.sector ? ` · ${u.sector}` : ""}`}</SelectValue></SelectTrigger>
        <SelectContent>{(data?.roles ?? []).map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
      </Select>
    );
  const statusBadge = (u: UserRow, prefix = "admin") => (
    <span data-testid={`${prefix}-user-status-${u.user_id}`} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
      u.status === "pendente" ? "bg-[#78350F] text-[#FDE68A]" : "bg-[#064E3B] text-[#6EE7B7]")}>{u.status === "pendente" ? "Pendente" : "Ativo"}</span>
  );

  return (
    <div className="space-y-6">
      <Panel title={`Usuários (${users.length})${pendingCount ? ` · ${pendingCount} aguardando aprovação` : ""}`} testId="admin-users-table">
        <div className="mb-4 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
          <div className="rounded-lg border border-slate-800 p-3"><strong className="text-amber">Gerente</strong> — tudo: aprova usuários, metas, horários, desfaz envios.</div>
          <div className="rounded-lg border border-slate-800 p-3"><strong className="text-slate-200">Chefe de Departamento</strong> — painéis, aprova requisições, define horários de retirada, contagens.</div>
          <div className="rounded-lg border border-slate-800 p-3"><strong className="text-slate-200">Alimentador</strong> — envia dados, conta estoque, retira itens nos horários livres.</div>
        </div>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <ul className="space-y-2 md:hidden" data-testid="admin-users-cards">
              {users.map((u) => (
                <li key={u.user_id} className="space-y-2 rounded-lg border border-slate-800 p-3" data-testid={`admin-user-card-${u.user_id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-100">{u.name || u.email}{u.user_id === me?.user_id && <span className="ml-1 text-[10px] text-amber">(você)</span>}</div>
                      <div className="truncate text-xs text-slate-500">{u.email}</div>
                    </div>
                    {statusBadge(u, "mobile")}
                  </div>
                  {roleControl(u, "mobile")}
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    {["Usuário", "Email", "Status", "Perfil"].map((h) => <TableHead key={h} className="text-xs uppercase text-slate-400">{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.user_id} data-testid={`admin-user-row-${u.user_id}`} className="border-slate-800/70">
                      <TableCell>{u.name || "—"}{u.user_id === me?.user_id && <span className="ml-2 text-[10px] text-amber">(você)</span>}</TableCell>
                      <TableCell className="text-sm text-slate-300">{u.email}</TableCell>
                      <TableCell>{statusBadge(u)}</TableCell>
                      <TableCell>{roleControl(u)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        <p className="mt-3 text-xs text-slate-500">Quem se cadastra em /sign-up aparece como Pendente até um Gerente aprovar e escolher o perfil.</p>
      </Panel>
      <InvitePanel invites={data?.invites ?? []} />
      <ApproveDialog user={approving} onClose={() => setApproving(null)} />
    </div>
  );
}

function SettingsPanel() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const [form, setForm] = useState({ empresa: "", min: "", max: "" });
  useEffect(() => {
    if (data) setForm({ empresa: data.empresa, min: String(+(data.cmv_meta_min * 100).toFixed(1)), max: String(+(data.cmv_meta_max * 100).toFixed(1)) });
  }, [data]);

  const save = useMutation({
    mutationFn: () => apiPut<Settings>("/settings", { empresa: form.empresa, cmv_meta_min: Number(form.min) / 100, cmv_meta_max: Number(form.max) / 100 }),
    onSuccess: () => {
      toast.success("Metas atualizadas");
      void qc.invalidateQueries({ queryKey: qk.settings });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Panel title="Meta de CMV e empresa" testId="admin-settings">
      <div className="grid max-w-xl gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Empresa / unidade</Label>
          <Input data-testid="settings-company-input" value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} />
        </div>
        <div>
          <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Meta mínima (%)</Label>
          <Input type="number" step="0.1" data-testid="settings-cmv-min-input" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} />
        </div>
        <div>
          <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Meta máxima (%)</Label>
          <Input type="number" step="0.1" data-testid="settings-cmv-max-input" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} />
        </div>
        <div className="flex items-end">
          <Button className="w-full" data-testid="settings-save-button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function AuditPanel() {
  const { data, isError } = useAudit();
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Log de auditoria & backup" testId="admin-audit-panel"
      action={<Button size="sm" variant="outline" data-testid="backup-export-button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await apiDownload("/backup", `madrila_backup_${new Date().toISOString().slice(0, 10)}.xlsx`); toast.success("Backup baixado — pode ser reimportado como Planilha completa"); }
        catch (e) { toast.error(errorMessage(e, "Falha no backup")); } finally { setBusy(false); }
      }}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}Exportar backup completo</Button>}>
      <ul className="max-h-96 divide-y divide-slate-800/70 overflow-y-auto text-xs" data-testid="audit-list">
        {(isError ? [] : (data ?? [])).map((a) => (
          <li key={`${a.at}-${a.user}-${a.action}`} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
            <span className="shrink-0 text-slate-500">{new Date(a.at).toLocaleString("pt-BR")}</span>
            <span className="shrink-0 text-slate-300">{a.user}</span>
            <span className="text-amber">{a.action}</span>
            <span className="text-slate-400">{a.detail}</span>
          </li>
        ))}
        {!data?.length && <li className="py-3 text-slate-500">Nenhuma ação registrada ainda.</li>}
      </ul>
    </Panel>
  );
}

export default function Administracao() {
  return (
    <div>
      <PageHeader eyebrow="Gerência" title="Administração & Metas" subtitle="Defina quem acessa o quê e calibre a meta de CMV usada em todos os alertas e cálculos." />
      <div className="space-y-6">
        <UsersPanel />
        <SettingsPanel />
        <AuditPanel />
      </div>
    </div>
  );
}
