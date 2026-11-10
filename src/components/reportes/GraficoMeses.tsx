"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import s from "./reportes.module.css";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Barras agrupadas: monto cotizado vs aceptado por mes (soles) */
export function GraficoMeses({ datos }: { datos: { mes: string; cantidad: number; cotizado: number; aceptado: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!datos.length) return <div className={s.vacio}>Sin cotizaciones en el periodo</div>;
  const max = Math.max(1, ...datos.map((d) => Number(d.cotizado)));
  const fmtCorto = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : n.toFixed(0);

  return (
    <div>
      <div className={s.leyenda}>
        <span><i className={s.sw1} /> Cotizado</span>
        <span><i className={s.sw2} /> Aceptado</span>
      </div>
      <div className={s.chart} role="img" aria-label="Monto cotizado y aceptado por mes">
        {datos.map((d, i) => {
          const [y, m] = d.mes.split("-").map(Number);
          return (
            <div key={d.mes} className={s.grupo} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
              {hover === i && (
                <div className={s.tip}>
                  <strong>{MESES[m - 1]} {y}</strong>
                  <span>{d.cantidad} cotizaciones</span>
                  <span>Cotizado: {money(d.cotizado)}</span>
                  <span>Aceptado: {money(d.aceptado)}</span>
                </div>
              )}
              <div className={s.barras}>
                <div className={s.b1} style={{ height: `${(Number(d.cotizado) / max) * 100}%` }}>
                  {datos.length <= 8 && <span className={s.val}>{fmtCorto(Number(d.cotizado))}</span>}
                </div>
                <div className={s.b2} style={{ height: `${(Number(d.aceptado) / max) * 100}%` }} />
              </div>
              <span className={s.mes}>{MESES[m - 1]}{datos.length > 12 ? ` ${String(y).slice(2)}` : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
