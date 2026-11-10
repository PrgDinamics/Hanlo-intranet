import { Badge } from "@/components/ui/Badge";
import { FotoZoom } from "@/components/ui/FotoZoom";
import { getPath, type Columna } from "@/lib/modulos";
import { fecha, money, num } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";

export function Celda({ col, row }: { col: Columna; row: Record<string, unknown> }) {
  const v = getPath(row, col.name);
  switch (col.type) {
    case "bool":
      return v ? <Badge tono="ok">Activo</Badge> : <Badge tono="muted">Inactivo</Badge>;
    case "badge":
      return v ? <Badge tono={col.tonos?.[String(v)]}>{col.labels?.[String(v)] ?? String(v)}</Badge> : null;
    case "sino":
      return v ? <Badge tono="ok">Sí</Badge> : <Badge tono="muted">No</Badge>;
    case "money":
      if (v === null || v === undefined) return <span className={ui.muted}>Sin límite</span>;
      return <>{money(v as number, (col.monedaCol ? (row[col.monedaCol] as string) : "PEN") ?? "PEN")}</>;
    case "number":
      return <>{v === null || v === undefined ? "" : num(v as number, col.decimales ?? (Number.isInteger(Number(v)) ? 0 : 2))}</>;
    case "date":
      return <>{fecha(v as string)}</>;
    case "mono":
      return <span className={ui.mono}>{String(v ?? "")}</span>;
    case "image":
      return <FotoZoom src={v ? String(v) : null} titulo={String(row.descripcion ?? row.nombre ?? "")} tam={40} />;
    default:
      return <>{v === null || v === undefined ? "" : String(v)}</>;
  }
}

export function esNumerica(col: Columna) {
  return col.type === "money" || col.type === "number";
}
