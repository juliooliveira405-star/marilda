import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type {
  AiModel,
  AuditRow,
  CountSummary,
  Notifications,
  IfoodSummary,
  Overview,
  Requisition,
  SectorCmv,
  SupplierSector,
  ValidadeAlert,
  WindowsResponse,
  Dashboard,
  Insight,
  Me,
  Period,
  ReorderResponse,
  Settings,
  SuppliersResponse,
  Upload,
  UsersResponse,
} from "@/lib/types";

export const qk = {
  me: ["me"] as const,
  dashboard: ["dashboard"] as const,
  suppliers: ["suppliers"] as const,
  reorder: ["reorder"] as const,
  uploads: ["uploads"] as const,
  periods: ["periods"] as const,
  settings: ["settings"] as const,
  users: ["users"] as const,
  insights: ["insights"] as const,
  aiModels: ["ai-models"] as const,
  counts: ["counts"] as const,
  requisitions: ["requisitions"] as const,
  windows: ["withdrawal-windows"] as const,
  notifications: ["notifications"] as const,
  overview: ["overview"] as const,
  audit: ["audit"] as const,
  sectorCmv: ["sector-cmv"] as const,
  supplierSectors: ["supplier-sectors"] as const,
  ifood: ["ifood"] as const,
  validades: ["validades"] as const,
};

// Every data upload changes every metric — invalidate all derived queries at once.
export const DERIVED_KEYS = [qk.dashboard, qk.suppliers, qk.reorder, qk.periods, qk.uploads, qk.overview, qk.sectorCmv, qk.supplierSectors];

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => apiGet<Me>("/me"), retry: 1 });
export const useDashboard = () => useQuery({ queryKey: qk.dashboard, queryFn: () => apiGet<Dashboard>("/dashboard") });
export const useSuppliers = () =>
  useQuery({ queryKey: qk.suppliers, queryFn: () => apiGet<SuppliersResponse>("/suppliers") });
export const useReorder = (from?: string, to?: string, sector?: string) =>
  useQuery({
    queryKey: [...qk.reorder, from ?? "", to ?? "", sector ?? ""],
    queryFn: () => {
      const q = new URLSearchParams();
      if (from) q.set("from_month", from);
      if (to) q.set("to_month", to);
      if (sector) q.set("sector", sector);
      const s = q.toString();
      return apiGet<ReorderResponse>(`/reorder${s ? `?${s}` : ""}`);
    },
  });
export const useUploads = (enabled = true) =>
  useQuery({
    queryKey: qk.uploads,
    queryFn: () => apiGet<Upload[]>("/uploads"),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((u) => u.status === "processando") ? 2500 : false),
  });
export const usePeriods = () => useQuery({ queryKey: qk.periods, queryFn: () => apiGet<Period[]>("/periods") });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: () => apiGet<Settings>("/settings") });
export const useUsers = (enabled: boolean) =>
  useQuery({ queryKey: qk.users, queryFn: () => apiGet<UsersResponse>("/users"), enabled });
export const useInsights = () => useQuery({ queryKey: qk.insights, queryFn: () => apiGet<Insight[]>("/insights") });
export const useAiModels = () => useQuery({ queryKey: qk.aiModels, queryFn: () => apiGet<AiModel[]>("/ai/models") });
export const useCounts = (month: string) =>
  useQuery({ queryKey: [...qk.counts, month], queryFn: () => apiGet<CountSummary>(`/counts/${month}`), enabled: !!month });
export const useRequisitions = () =>
  useQuery({ queryKey: qk.requisitions, queryFn: () => apiGet<Requisition[]>("/requisitions"), refetchInterval: 20000 });
export const useWindows = () => useQuery({ queryKey: qk.windows, queryFn: () => apiGet<WindowsResponse>("/withdrawals/windows") });
export const useNotifications = () =>
  useQuery({ queryKey: qk.notifications, queryFn: () => apiGet<Notifications>("/notifications"), refetchInterval: 20000 });
export const useOverview = () => useQuery({ queryKey: qk.overview, queryFn: () => apiGet<Overview>("/overview") });
export const useAudit = () => useQuery({ queryKey: qk.audit, queryFn: () => apiGet<AuditRow[]>("/audit") });
export const useSectorCmv = (sector: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [...qk.sectorCmv, sector ?? ""],
    queryFn: () => apiGet<SectorCmv>(`/cmv/sector${sector ? `?sector=${encodeURIComponent(sector)}` : ""}`),
    enabled,
    retry: false,
  });
export const useSupplierSectors = (enabled: boolean) =>
  useQuery({ queryKey: qk.supplierSectors, queryFn: () => apiGet<SupplierSector[]>("/suppliers/sectors"), enabled });
export const useIfood = (month?: string) =>
  useQuery({ queryKey: [...qk.ifood, month ?? ""], queryFn: () => apiGet<IfoodSummary>(`/ifood/summary${month ? `?month=${month}` : ""}`) });
export const useValidades = () =>
  useQuery({ queryKey: qk.validades, queryFn: () => apiGet<ValidadeAlert[]>("/validades?dias=7"), refetchInterval: 60000 });
