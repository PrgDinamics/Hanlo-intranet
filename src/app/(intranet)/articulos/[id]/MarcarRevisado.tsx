"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Sparkles } from "lucide-react";
import { marcarRevisado } from "@/lib/acciones-nuevos";
import { DIAS_NUEVO } from "@/lib/nuevos";
import ui from "@/components/ui/ui.module.css";

/** Aviso en la ficha de un artículo nuevo, con el botón para quitarle la etiqueta */
export function MarcarRevisado({ id, dias, editable }: { id: string; dias: number; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={ui.alert} style={{ background: "var(--brand-soft, #eef4ff)", color: "var(--brand-ink)", borderColor: "transparent", alignItems: "center" }}>
      <Sparkles />
      <span style={{ flex: 1 }}>
        Artículo nuevo: llegó en una lista de proveedor. Sale como nuevo {DIAS_NUEVO} días desde que se creó
        (le {dias === 1 ? "queda 1 día" : `quedan ${dias} días`}) o hasta que alguien lo revise.
        {error && <><br /><strong>{error}</strong></>}
      </span>
      {editable && (
        <button type="button" className={ui.btn} disabled={pending}
          onClick={() => start(async () => {
            setError(null);
            const r = await marcarRevisado(id);
            if (!r.ok) return setError(r.error);
            router.refresh();
          })}>
          <CheckCheck /> {pending ? "Guardando..." : "Ya lo revisé"}
        </button>
      )}
    </div>
  );
}
