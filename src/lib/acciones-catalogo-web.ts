"use server";

import { getSesion } from "@/lib/sesion";
import { infoCatalogo, publicarCatalogo, type InfoCatalogoWeb, type ResultadoCatalogoWeb } from "@/lib/catalogo-web";

/** Botón "Publicar catálogo en la web" (quien puede editar artículos) */
export async function publicarCatalogoWeb(): Promise<ResultadoCatalogoWeb> {
  const { permisos } = await getSesion();
  if (!permisos.crea_articulo) return { ok: false, error: "No tienes permiso para publicar el catálogo" };
  return publicarCatalogo();
}

export async function ultimaPublicacionWeb(): Promise<InfoCatalogoWeb | null> {
  await getSesion();
  return infoCatalogo();
}
