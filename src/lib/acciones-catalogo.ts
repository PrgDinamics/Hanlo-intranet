"use server";

import { buscarEnCatalogo } from "@/components/cotizacion/datos";
import type { ArticuloCat } from "@/components/cotizacion/datos";

/** Búsqueda del catálogo desde el editor de cotizaciones */
export async function buscarCatalogo(q: string): Promise<ArticuloCat[]> {
  return buscarEnCatalogo(String(q ?? "").slice(0, 100));
}
