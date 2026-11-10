"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, CloudDownload } from "lucide-react";
import { completarHistorialTc, traerTipoCambio } from "@/lib/acciones-externas";
import ui from "@/components/ui/ui.module.css";

export function TraerTcBoton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  return (
    <div className={ui.row}>
      {msg && (
        <span className={ui.hint} style={{ color: msg.ok ? "var(--ok)" : "var(--danger)", maxWidth: 320 }}>{msg.texto}</span>
      )}
      <button
        className={ui.btn}
        disabled={pending}
        title="Trae de SUNAT los días que falten del último mes (1 consulta por día)"
        onClick={() =>
          start(async () => {
            const r = await completarHistorialTc();
            setMsg(r.ok ? { ok: true, texto: r.mensaje } : { ok: false, texto: r.error });
            if (r.ok) router.refresh();
          })
        }
      >
        <CalendarRange /> Completar 30 días
      </button>
      <button
        className={ui.btn}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await traerTipoCambio();
            setMsg(r.ok ? { ok: true, texto: r.mensaje } : { ok: false, texto: r.error });
            if (r.ok) router.refresh();
          })
        }
      >
        <CloudDownload /> {pending ? "Consultando..." : "Traer T.C. SUNAT de hoy"}
      </button>
    </div>
  );
}
