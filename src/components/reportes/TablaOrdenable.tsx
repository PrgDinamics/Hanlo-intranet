"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Empty } from "@/components/ui/Empty";
import { fecha, money, num } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";
import s from "./reportes.module.css";

export type ColRep = {
  key: string;
  label: string;
  tipo?: "text" | "money" | "int" | "num" | "pct" | "date" | "mono";
  /** Dibuja una barra proporcional en la celda */
  barra?: boolean;
};

type Fila = Record<string, unknown>;

export function TablaOrdenable({
  columnas, filas, orden: ordenInicial, link, limite = 15,
}: {
  columnas: ColRep[];
  filas: Fila[];
  orden: string;
  link?: { base: string; key: string };
  limite?: number;
}) {
  const [orden, setOrden] = useState({ key: ordenInicial, desc: true });
  const [todos, setTodos] = useState(false);

  const ordenadas = useMemo(() => {
    const col = columnas.find((c) => c.key === orden.key);
    const num = col?.tipo && !["text", "mono", "date"].includes(col.tipo);
    return [...filas].sort((a, b) => {
      const x = a[orden.key], y = b[orden.key];
      const r = num ? Number(x) - Number(y) : String(x ?? "").localeCompare(String(y ?? ""));
      return orden.desc ? -r : r;
    });
  }, [filas, orden, columnas]);

  const maximos = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of columnas) if (c.barra) m[c.key] = Math.max(1, ...filas.map((f) => Number(f[c.key]) || 0));
    return m;
  }, [filas, columnas]);

  if (!filas.length) return <Empty>Sin datos en el periodo</Empty>;
  const visibles = todos ? ordenadas : ordenadas.slice(0, limite);

  const celda = (c: ColRep, v: unknown) => {
    switch (c.tipo) {
      case "money": return money(v as number);
      case "int": return num(v as number, 0);
      case "num": return num(v as number);
      case "pct": return `${num(v as number, 1)}%`;
      case "date": return fecha(v as string);
      default: return String(v ?? "");
    }
  };
  const esNum = (c: ColRep) => c.tipo && !["text", "mono", "date"].includes(c.tipo);

  return (
    <>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              {columnas.map((c) => (
                <th key={c.key} className={`${esNum(c) ? ui.num : ""} ${s.sortable}`}
                  onClick={() => setOrden((o) => ({ key: c.key, desc: o.key === c.key ? !o.desc : true }))}>
                  {c.label}{" "}
                  {orden.key === c.key ? (orden.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />) : <ChevronsUpDown size={12} className={s.sortIcon} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((f, i) => (
              <tr key={i}>
                <td className={ui.muted}>{i + 1}</td>
                {columnas.map((c, j) => {
                  const contenido = celda(c, f[c.key]);
                  return (
                    <td key={c.key} className={`${esNum(c) ? ui.num : ""} ${c.tipo === "mono" ? ui.mono : ""}`}>
                      {c.barra ? (
                        <div className={s.celdaBarra}>
                          <span className={s.barraFondo}>
                            <span className={s.barraRelleno} style={{ width: `${((Number(f[c.key]) || 0) / maximos[c.key]) * 100}%` }} />
                          </span>
                          <span>{contenido}</span>
                        </div>
                      ) : j === 0 && link && f[link.key] ? (
                        <Link href={`${link.base}/${f[link.key]}`} className={s.link}>{contenido}</Link>
                      ) : (
                        contenido
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filas.length > limite && (
        <div className={ui.pager}>
          <span>{todos ? filas.length : limite} de {filas.length}</span>
          <button className={`${ui.btn} ${ui.sm}`} onClick={() => setTodos((t) => !t)}>{todos ? "Ver menos" : "Ver todos"}</button>
        </div>
      )}
    </>
  );
}
