"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import ui from "@/components/ui/ui.module.css";
import s from "./reportes.module.css";

type Op = { value: string; label: string };

function rango(preset: string, hoy: string): [string, string] {
  const [y, m] = hoy.split("-").map(Number);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (preset) {
    case "mes": return [`${hoy.slice(0, 7)}-01`, hoy];
    case "mes_ant": return [iso(new Date(Date.UTC(y, m - 2, 1))), iso(new Date(Date.UTC(y, m - 1, 0)))];
    case "90": return [iso(new Date(Date.UTC(y, m - 1, Number(hoy.slice(8)) - 90))), hoy];
    case "anio": return [`${y}-01-01`, hoy];
    default: return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  }
}

export function Filtros({
  desde, hasta, hoy, agentes, empresas,
}: { desde: string; hasta: string; hoy: string; agentes: Op[]; empresas: Op[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (cambios: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const presets = [
    { k: "mes", l: "Este mes" }, { k: "mes_ant", l: "Mes anterior" }, { k: "90", l: "Últimos 90 días" },
    { k: "anio", l: "Este año" }, { k: "anio_ant", l: "Año anterior" },
  ];

  return (
    <div className={`${ui.card} ${s.filtros}`}>
      <div className={s.presets}>
        <CalendarRange />
        {presets.map((p) => {
          const [d, h] = rango(p.k, hoy);
          const activo = d === desde && h === hasta;
          return (
            <button key={p.k} className={`${s.preset} ${activo ? s.presetOn : ""}`} onClick={() => set({ desde: d, hasta: h })}>
              {p.l}
            </button>
          );
        })}
      </div>
      <div className={s.campos}>
        <label className={ui.field}>
          <span className={ui.label}>Desde</span>
          <input className={ui.input} type="date" value={desde} max={hasta} onChange={(e) => set({ desde: e.target.value })} />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Hasta</span>
          <input className={ui.input} type="date" value={hasta} min={desde} onChange={(e) => set({ hasta: e.target.value })} />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Agente</span>
          <select className={ui.input} value={params.get("agente") ?? ""} onChange={(e) => set({ agente: e.target.value })}>
            <option value="">Todos</option>
            {agentes.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        {empresas.length > 1 && (
          <label className={ui.field}>
            <span className={ui.label}>Empresa</span>
            <select className={ui.input} value={params.get("empresa") ?? ""} onChange={(e) => set({ empresa: e.target.value })}>
              <option value="">Todas</option>
              {empresas.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
