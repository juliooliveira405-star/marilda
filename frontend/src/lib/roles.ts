import type { Me, Perms } from "@/lib/types";

// Access is decided by the server (GET /api/me → perms); the UI only mirrors it.
export type Gate = "view" | keyof Pick<Perms, "full" | "costs" | "stock" | "manage" | "ifood" | "upload">;

export const allowed = (me: Me | undefined, gate: Gate): boolean =>
  !!me && me.role !== "pendente" && (gate === "view" || !!me.perms?.[gate]);

export const ROLE_SECTORS: Record<string, string[]> = {
  chefe: ["Cozinha", "Bar", "Estoque", "Salão", "Quiosque"],
  alimentador: ["Cozinha", "Bar", "Estoque", "Salão"],
};
