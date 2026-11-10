"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, BellRing, CheckCircle2, Hourglass, Truck, XCircle } from "lucide-react";
import { EstadoBadge } from "@/components/ui/Badge";
import { cambiarEstado } from "@/lib/acciones-cotizaciones";
import type { EstadoCotizacion } from "@/lib/estados";
import { money } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";
import s from "./seguimiento.module.css";

export type FilaSeguimiento = {
  id: string;
  codigo: string;
  cliente_nombre: string;
  agente_nombre: string | null;
  total: number;
  moneda: "PEN" | "USD";
  estado: EstadoCotizacion;
  motivo: "vencida" | "por_vencer" | "sin_respuesta";
  dias: number;
};

const TEXTO = {
  vencida: (d: number) => `Venció hace ${d} día${d === 1 ? "" : "s"}`,
  por_vencer: (d: number) => (d === 0 ? "Vence hoy" : `Vence en ${d} día${d === 1 ? "" : "s"}`),
  sin_respuesta: (d: number) => `Sin respuesta hace ${d} días`,
};

/** Cotizaciones que piden atención: vencidas sin cerrar, por vencer y sin respuesta */
export function Seguimiento({ filas, verAgente }: { filas: FilaSeguimiento[]; verAgente: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const marcar = (id: string, estado: EstadoCotizacion) => {
    setError(null);
    setEnCurso(id);
    start(async () => {
      const r = await cambiarEstado(id, estado);
      setEnCurso(null);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  };

  return (
    <div className={ui.card}>
      <div className={ui.cardHead}>
        <span className={ui.cardTitle}><BellRing /> Seguimiento</span>
        <span className={ui.muted}>{filas.length ? `${filas.length} por atender` : "todo al día"}</span>
      </div>
      {error && <div style={{ padding: "12px 18px 0" }}><div className={ui.alert}><AlertCircle /> {error}</div></div>}
      {filas.length === 0 ? (
        <p className={s.vacio}><CheckCircle2 /> No hay cotizaciones vencidas, por vencer ni sin respuesta.</p>
      ) : (
        <ul className={s.lista}>
          {filas.map((f) => (
            <li key={f.id} className={`${s.fila} ${enCurso === f.id ? s.ocupada : ""}`}>
              <span className={`${s.motivo} ${s[f.motivo]}`}>{TEXTO[f.motivo](f.dias)}</span>
              <div className={s.info}>
                <Link href={`/cotizaciones/${f.id}`} className={s.codigo}>{f.codigo}</Link>
                <span className={s.cliente}>{f.cliente_nombre}</span>
                {verAgente && f.agente_nombre && <span className={ui.muted}>· {f.agente_nombre}</span>}
              </div>
              <EstadoBadge estado={f.estado} />
              <strong className={s.total}>{money(f.total, f.moneda)}</strong>
              <div className={s.acciones}>
                {f.estado === "emitida" && f.motivo !== "vencida" && (
                  <button className={`${ui.btn} ${ui.sm}`} disabled={pending} onClick={() => marcar(f.id, "entregada")} title="Ya se la entregaste al cliente">
                    <Truck /> Entregada
                  </button>
                )}
                <button className={`${ui.btn} ${ui.sm} ${s.ok}`} disabled={pending} onClick={() => marcar(f.id, "aceptada")}>
                  <CheckCircle2 /> Aceptada
                </button>
                <button className={`${ui.btn} ${ui.sm}`} disabled={pending} onClick={() => marcar(f.id, "rechazada")}>
                  <XCircle /> Rechazada
                </button>
                {f.motivo === "vencida" && (
                  <button className={`${ui.btn} ${ui.sm}`} disabled={pending} onClick={() => marcar(f.id, "vencida")}>
                    <Hourglass /> Vencida
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
