import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type {
  AiModel,
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
};

// Every data upload changes every metric — invalidate all derived queries at once.
export const DERIVED_KEYS = [qk.dashboard, qk.suppliers, qk.reorder, qk.periods, qk.uploads];

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => apiGet<Me>("/me"), retry: 1 });
export const useDashboard = () => useQuery({ queryKey: qk.dashboard, queryFn: () => apiGet<Dashboard>("/dashboard") });
export const useSuppliers = () =>
  useQuery({ queryKey: qk.suppliers, queryFn: () => apiGet<SuppliersResponse>("/suppliers") });
export const useReorder = (from?: string, to?: string) =>
  useQuery({
    queryKey: [...qk.reorder, from ?? "", to ?? ""],
    queryFn: () => {
      const q = new URLSearchParams();
      if (from) q.set("from_month", from);
      if (to) q.set("to_month", to);
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
