import ui from "./ui.module.css";
import { ESTADOS, type EstadoCotizacion } from "@/lib/estados";

const TONO: Record<string, string> = {
  ok: ui.b_ok, warn: ui.b_warn, danger: ui.b_danger, info: ui.b_info, brand: ui.b_brand, muted: ui.b_muted,
};

export function Badge({ tono = "muted", children }: { tono?: string; children: React.ReactNode }) {
  return <span className={`${ui.badge} ${TONO[tono] ?? ""}`}>{children}</span>;
}

export function EstadoBadge({ estado }: { estado: string }) {
  const e = ESTADOS[estado as EstadoCotizacion] ?? { label: estado, tono: "muted" };
  return <Badge tono={e.tono}>{e.label}</Badge>;
}
