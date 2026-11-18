"use server";

import { revalidatePath } from "next/cache";
import { getSesion } from "@/lib/sesion";
import { mensajeError } from "@/lib/errores";
import type { Resultado } from "@/lib/acciones";

/** "Ya lo revisé": el artículo deja de salir como nuevo */
export async function marcarRevisado(id: string): Promise<Resultado> {
  const { supabase, permisos } = await getSesion();
  if (!permisos.crea_articulo) return { ok: false, error: "No tienes permiso para editar artículos" };
  const { data, error } = await supabase.from("articulos").update({ revisado_at: new Date().toISOString() })
    .eq("id", id).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: error ? mensajeError(error) : "No se pudo marcar (sin permisos)" };
  revalidatePath("/articulos", "layout");
  return { ok: true, id };
}
