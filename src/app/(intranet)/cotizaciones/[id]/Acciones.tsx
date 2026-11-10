"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle, Ban, BadgeCheck, CheckCircle2, Copy, GitBranch, Hourglass, Pencil, Printer, Send, ShieldAlert, Truck, Undo2, XCircle,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cambiarEstado, duplicarCotizacion, nuevaVersion, type Faltante } from "@/lib/acciones-cotizaciones";
import { AvisoStock } from "@/components/cotizacion/AvisoStock";
import { EDITABLE, TRANSICIONES, VERSIONABLE, type EstadoCotizacion } from "@/lib/estados";
import ui from "@/components/ui/ui.module.css";

const BOTON: Partial<Record<EstadoCotizacion, { label: string; icon: React.ElementType; clase?: string }>> = {
  emitida: { label: "Emitir", icon: Send, clase: ui.primary },
  entregada: { label: "Marcar entregada", icon: Truck },
  aceptada: { label: "Aceptada", icon: CheckCircle2 },
  rechazada: { label: "Rechazada", icon: XCircle },
  vencida: { label: "Vencida", icon: Hourglass },
  borrador: { label: "Volver a borrador", icon: Undo2 },
};

export function Acciones({
  id, estado, esAdmin, superaLimite, limite,
}: {
  id: string;
  estado: EstadoCotizacion;
  esAdmin: boolean;
  /** El total supera el límite del vendedor actual */
  superaLimite: boolean;
  limite: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [anular, setAnular] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [faltantes, setFaltantes] = useState<Faltante[] | null>(null);

  const correr = (fn: () => Promise<{ ok: boolean; id?: string; error?: string; faltantes?: Faltante[] }>, ir?: boolean) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok && r.faltantes) return setFaltantes(r.faltantes);
      setFaltantes(null);
      if (!r.ok) return setError(r.error ?? "Error");
      setAnular(false);
      if (ir && r.id) router.push(`/cotizaciones/${r.id}`);
      router.refresh();
    });
  };

  // En "por aprobar" solo el administrador aprueba; el vendedor puede retirarla a borrador
  const siguientes = TRANSICIONES[estado].filter(
    (e) => e !== "anulada" && !(estado === "por_aprobar" && e === "emitida" && !esAdmin),
  );
  const boton = (e: EstadoCotizacion) => {
    if (estado === "por_aprobar" && e === "emitida") return { label: "Aprobar y emitir", icon: BadgeCheck, clase: ui.primary };
    if (estado === "por_aprobar" && e === "borrador") return { label: esAdmin ? "Devolver a borrador" : "Retirar a borrador", icon: Undo2 };
    if (estado === "borrador" && e === "emitida" && superaLimite) return { label: "Enviar a aprobación", icon: ShieldAlert, clase: ui.primary };
    return BOTON[e];
  };

  return (
    <>
      <div className={ui.actions} style={{ marginBottom: 14 }}>
        {EDITABLE.includes(estado) && (
          <Link href={`/cotizaciones/${id}/editar`} className={ui.btn}><Pencil /> Editar</Link>
        )}
        <a href={`/imprimir/cotizacion/${id}`} target="_blank" rel="noreferrer" className={ui.btn}>
          <Printer /> Imprimir / PDF
        </a>
        {VERSIONABLE.includes(estado) && (
          <button className={ui.btn} disabled={pending} title="Crea una copia editable y marca esta como reemplazada"
            onClick={() => confirm("Se creará una nueva versión editable y esta quedará como reemplazada. ¿Continuar?") &&
              correr(() => nuevaVersion(id), true)}>
            <GitBranch /> Nueva versión
          </button>
        )}
        <button className={ui.btn} disabled={pending} title="Crear una cotización nueva con los mismos ítems"
          onClick={() => correr(() => duplicarCotizacion(id), true)}>
          <Copy /> Duplicar
        </button>
      </div>

      {estado === "por_aprobar" && (
        <div className={`${ui.alert}`} style={{ marginBottom: 14, background: "var(--warn-soft)", color: "var(--warn)", borderColor: "#f3d9a8" }}>
          <ShieldAlert />
          {esAdmin
            ? "Esta cotización supera el límite de su vendedor. Revísala y apruébala para que pueda enviarse al cliente."
            : "Esta cotización supera tu límite de venta y está esperando la aprobación de un administrador."}
        </div>
      )}
      {estado === "borrador" && superaLimite && limite !== null && (
        <div className={ui.alert} style={{ marginBottom: 14, background: "var(--warn-soft)", color: "var(--warn)", borderColor: "#f3d9a8" }}>
          <ShieldAlert /> El total supera tu límite de S/ {limite.toLocaleString("es-PE", { minimumFractionDigits: 2 })}. Al emitirla quedará por aprobar.
        </div>
      )}
      {(siguientes.length > 0 || TRANSICIONES[estado].includes("anulada")) && (
        <div className={ui.card} style={{ marginBottom: 18 }}>
          <div className={ui.toolbar} style={{ borderBottom: "none" }}>
            <span className={ui.muted}>Cambiar estado:</span>
            {siguientes.map((e) => {
              const b = boton(e);
              if (!b) return null;
              const Icon = b.icon;
              return (
                <button key={e} className={`${ui.btn} ${ui.sm} ${b.clase ?? ""}`} disabled={pending}
                  onClick={() => correr(() => cambiarEstado(id, e))}>
                  <Icon /> {b.label}
                </button>
              );
            })}
            {TRANSICIONES[estado].includes("anulada") && (
              <button className={`${ui.btn} ${ui.sm} ${ui.danger}`} disabled={pending}
                onClick={() => { setMotivo(""); setError(null); setAnular(true); }}>
                <Ban /> Anular
              </button>
            )}
          </div>
          {error && !anular && <div style={{ padding: "0 14px 12px" }}><div className={ui.alert}><AlertCircle /> {error}</div></div>}
        </div>
      )}

      <AvisoStock
        faltantes={faltantes}
        pending={pending}
        onCancelar={() => setFaltantes(null)}
        onEmitir={() => correr(() => cambiarEstado(id, "emitida", undefined, true))}
      />

      <Modal
        open={anular}
        onClose={() => setAnular(false)}
        title="Anular cotización"
        width={480}
        footer={
          <>
            <button className={ui.btn} onClick={() => setAnular(false)}>Cancelar</button>
            <button className={`${ui.btn} ${ui.danger}`} disabled={pending || !motivo.trim()}
              onClick={() => correr(() => cambiarEstado(id, "anulada", motivo))}>
              <Ban /> Anular
            </button>
          </>
        }
      >
        <div className={ui.stack}>
          {error && <div className={ui.alert}><AlertCircle /> {error}</div>}
          <p>La cotización quedará registrada como anulada y no podrá modificarse.</p>
          <label className={ui.field}>
            <span className={`${ui.label} ${ui.req}`}>Motivo de anulación</span>
            <textarea className={ui.input} autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
        </div>
      </Modal>
    </>
  );
}
