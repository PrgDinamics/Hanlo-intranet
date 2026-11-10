"use client";

import { Printer } from "lucide-react";
import s from "./imprimir.module.css";

export function ImprimirBoton() {
  return (
    <div className={s.barra}>
      <span>Vista de impresión · usa “Guardar como PDF” para enviarla</span>
      <button onClick={() => window.print()}><Printer size={16} /> Imprimir / PDF</button>
    </div>
  );
}
