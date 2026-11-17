"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import ui from "./ui.module.css";
import s from "./Confirmar.module.css";

/**
 * Ventana de confirmación propia (reemplaza los confirm() y alert() del navegador).
 *   const confirmar = useConfirmar();
 *   if (!(await confirmar({ titulo: "Eliminar agente", mensaje: "…", peligro: true, aceptar: "Eliminar" }))) return;
 *   await confirmar({ titulo: "No se pudo eliminar", mensaje: error, soloAceptar: true });
 */
export type OpcionesConfirmar = {
  titulo: string;
  mensaje?: React.ReactNode;
  aceptar?: string;
  cancelar?: string;
  /** Acción que borra o no se puede deshacer: botón rojo */
  peligro?: boolean;
  /** Solo un aviso: un botón "Entendido" */
  soloAceptar?: boolean;
};

type Pendiente = OpcionesConfirmar & { resolver: (v: boolean) => void };

const Ctx = createContext<(o: OpcionesConfirmar) => Promise<boolean>>(async () => false);

export function useConfirmar() {
  return useContext(Ctx);
}

export function ConfirmarProvider({ children }: { children: React.ReactNode }) {
  const [p, setP] = useState<Pendiente | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);

  const confirmar = useCallback(
    (o: OpcionesConfirmar) => new Promise<boolean>((resolver) => setP({ ...o, resolver })),
    [],
  );

  const cerrar = useCallback((v: boolean) => {
    setP((actual) => {
      actual?.resolver(v);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!p) return;
    botonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); cerrar(false); }
    };
    // En captura: así Escape cierra esta ventana y no la que está debajo
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [p, cerrar]);

  return (
    <Ctx.Provider value={confirmar}>
      {children}
      {p && (
        <div className={s.fondo} onMouseDown={(e) => e.target === e.currentTarget && cerrar(false)}>
          <div className={s.caja} role="alertdialog" aria-modal="true" aria-labelledby="confirmar-titulo">
            <div className={`${s.icono} ${p.peligro ? s.iconoPeligro : ""}`}>
              {p.peligro ? <AlertTriangle /> : <Info />}
            </div>
            <div className={s.texto}>
              <h2 id="confirmar-titulo" className={s.titulo}>{p.titulo}</h2>
              {p.mensaje && <div className={s.mensaje}>{p.mensaje}</div>}
            </div>
            <div className={s.botones}>
              {!p.soloAceptar && (
                <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={() => cerrar(false)}>
                  {p.cancelar ?? "Cancelar"}
                </button>
              )}
              <button type="button" ref={botonRef} data-peligro={p.peligro ? "true" : undefined}
                className={`${ui.btn} ${p.peligro ? "" : ui.primary}`} onClick={() => cerrar(true)}>
                {p.aceptar ?? (p.soloAceptar ? "Entendido" : "Aceptar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
