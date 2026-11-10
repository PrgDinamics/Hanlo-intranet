"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/sesion";
import { mensajeError } from "@/lib/errores";
import { esPermiso } from "@/lib/permisos";
import type { Resultado } from "@/lib/acciones";

export type RolInput = { id: string | null; nombre: string; descripcion: string; permisos: string[] };

/** Crea o edita un rol. El rol Administrador no se modifica (la base lo protege igual) */
export async function guardarRol(r: RolInput): Promise<Resultado> {
  const { supabase } = await requireAdmin();
  const nombre = r.nombre.trim().replace(/\s+/g, " ");
  if (nombre.length < 3 || nombre.length > 40) return { ok: false, error: "El nombre debe tener entre 3 y 40 caracteres" };
  const permisos = [...new Set(r.permisos.filter(esPermiso))];
  const datos = { nombre, descripcion: r.descripcion.trim().slice(0, 300) || null, permisos };
  if (r.id) {
    const { data: actual } = await supabase.from("roles").select("sistema").eq("id", r.id).maybeSingle();
    if (!actual) return { ok: false, error: "El rol no existe" };
    if (actual.sistema) return { ok: false, error: "El rol Administrador es fijo: siempre tiene todos los permisos" };
  }
  const q = r.id
    ? supabase.from("roles").update(datos).eq("id", r.id).select("id").single()
    : supabase.from("roles").insert(datos).select("id").single();
  const { data, error } = await q;
  if (error || !data) return { ok: false, error: error ? mensajeError(error) : "No se pudo guardar" };
  revalidatePath("/", "layout");
  return { ok: true, id: data.id as string };
}

export async function eliminarRol(id: string): Promise<Resultado> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("roles").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: mensajeError(error) };
  if (!data?.length) return { ok: false, error: "No se pudo eliminar" };
  revalidatePath("/configuracion/roles");
  return { ok: true, id };
}
