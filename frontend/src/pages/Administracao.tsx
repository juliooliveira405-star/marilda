import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, Skeleton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiPatch, apiPut, errorMessage } from "@/lib/api";
import { qk, useMe, useSettings, useUsers } from "@/lib/queries";
import type { Settings, UserRow } from "@/lib/types";

function UsersPanel() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data, isLoading, isError } = useUsers(true);
  const labels = Object.fromEntries((data?.roles ?? []).map((r) => [r.value, r.label])) as Record<string, string>;

  const change = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => apiPatch<UserRow>(`/users/${id}/role`, { role }),
    onSuccess: (u) => {
      toast.success(`${u.email || "Usuário"} agora é ${u.role_label}`);
      void qc.invalidateQueries({ queryKey: qk.users });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Panel title="Usuários e perfis de acesso" testId="admin-users-table">
      <div className="mb-4 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
        <div className="rounded-lg border border-slate-800 p-3"><strong className="text-amber">Gerente</strong> — tudo + usuários, metas e desfazer envios.</div>
        <div className="rounded-lg border border-slate-800 p-3"><strong className="text-slate-200">Alimentador</strong> — envia planilhas/PDFs e lança faturamento; vê os painéis.</div>
        <div className="rounded-lg border border-slate-800 p-3"><strong className="text-slate-200">Chefe de Departamento</strong> — consulta painéis, ABC, pedidos, economia e IA.</div>
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              {["Usuário", "Email", "Perfil"].map((h) => <TableHead key={h} className="text-xs uppercase text-slate-400">{h}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(isError ? [] : (data?.users ?? [])).map((u) => (
              <TableRow key={u.user_id} data-testid={`admin-user-row-${u.user_id}`} className="border-slate-800/70">
                <TableCell>{u.name || "—"}{u.user_id === me?.user_id && <span className="ml-2 text-[10px] text-amber">(você)</span>}</TableCell>
                <TableCell className="text-sm text-slate-300">{u.email}</TableCell>
                <TableCell>
                  <Select value={u.role} onValueChange={(v: string) => v !== u.role && change.mutate({ id: u.user_id, role: v })}>
                    <SelectTrigger size="sm" className="w-56" data-testid="admin-user-role-select"><SelectValue>{(v: string) => labels[v] ?? v}</SelectValue></SelectTrigger>
                    <SelectContent>{(data?.roles ?? []).map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="mt-3 text-xs text-slate-500">Novos usuários se cadastram em /sign-up e aparecem aqui como Pendente até você definir o perfil.</p>
    </Panel>
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

export default function Administracao() {
  return (
    <div>
      <PageHeader eyebrow="Gerência" title="Administração & Metas" subtitle="Defina quem acessa o quê e calibre a meta de CMV usada em todos os alertas e cálculos." />
      <div className="space-y-6">
        <UsersPanel />
        <SettingsPanel />
      </div>
    </div>
  );
}
