"use client";

import { useEffect, useState, useTransition } from "react";
import { Globe } from "lucide-react";
import { publicarCatalogoWeb, ultimaPublicacionWeb } from "@/lib/acciones-catalogo-web";
import type { InfoCatalogoWeb } from "@/lib/catalogo-web";
import { useConfirmar } from "@/components/ui/Confirmar";
import ui from "@/components/ui/ui.module.css";

const cuando = (iso: string) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

/** Publica el catálogo en hanloinnova.com (también se publica solo al importar y al editar artículos) */
export function PublicarWeb() {
  const confirmar = useConfirmar();
  const [info, setInfo] = useState<InfoCatalogoWeb | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    let vivo = true;
    ultimaPublicacionWeb().then((i) => vivo && setInfo(i)).catch(() => {});
    return () => { vivo = false; };
  }, []);
  return (
    <button type="button" className={ui.btn} disabled={pending}
      title={info ? `Última publicación: ${cuando(info.actualizado)} · ${info.articulos} artículos` : "Aún no se ha publicado"}
      onClick={() => start(async () => {
        const r = await publicarCatalogoWeb();
        if (r.ok) setInfo(r.info);
        await confirmar(r.ok
          ? { titulo: "Catálogo publicado en la web", mensaje: `${r.info.articulos} artículos en hanloinnova.com (sin precios ni proveedores).`, soloAceptar: true }
          : { titulo: "No se pudo publicar", mensaje: r.error, soloAceptar: true, peligro: true });
      })}>
      <Globe /> {pending ? "Publicando..." : info ? `Web: ${cuando(info.actualizado)}` : "Publicar en la web"}
    </button>
  );
}
