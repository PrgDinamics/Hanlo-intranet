"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImageIcon, Search, X } from "lucide-react";
import s from "./FotoZoom.module.css";

/**
 * Miniatura con lupa: al hacer clic muestra la foto en grande.
 * Sirve dentro de filas clicables y de modales (no dispara sus clics ni su Esc).
 */
export function FotoZoom({
  src, titulo, className, tam = 36,
}: { src?: string | null; titulo?: string; className?: string; tam?: number }) {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation(); // que no cierre también el modal de abajo
      setAbierto(false);
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [abierto]);

  if (!src) {
    return (
      <span className={`${s.mini} ${className ?? ""}`} style={{ width: tam, height: tam }}>
        <ImageIcon />
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`${s.mini} ${s.boton} ${className ?? ""}`}
        style={{ width: tam, height: tam }}
        title="Ver foto en grande"
        aria-label={titulo ? `Ver foto de ${titulo}` : "Ver foto en grande"}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setAbierto(true); }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" />
        <span className={s.lupa}><Search /></span>
      </button>
      {abierto &&
        createPortal(
          <div
            className={s.fondo}
            role="dialog"
            aria-modal="true"
            aria-label={titulo ?? "Foto"}
            onClick={(e) => { e.stopPropagation(); setAbierto(false); }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button type="button" className={s.cerrar} aria-label="Cerrar" onClick={() => setAbierto(false)}>
              <X />
            </button>
            <figure className={s.figura} onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={titulo ?? ""} />
              {titulo && <figcaption>{titulo}</figcaption>}
            </figure>
          </div>,
          document.body,
        )}
    </>
  );
}
