"use server";

import { revalidatePath } from "next/cache";
import { getSesion } from "@/lib/sesion";
import { mensajeError } from "@/lib/errores";
import type { Resultado } from "@/lib/acciones";

export type PrecioInput = {
  id?: string | null;
  articulo_id: string;
  proveedor_id: string;
  precio_compra: number;
  precio_venta: number;
  precio_ciento: number | null;
  precio_millar: number | null;
  desde_ciento: number;
  desde_millar: number;
  moneda: "PEN" | "USD";
  preferido: boolean;
};

export async function guardarPrecio(p: PrecioInput): Promise<Resultado> {
  if (!p.articulo_id || !p.proveedor_id) return { ok: false, error: "Selecciona artículo y proveedor" };
  if (!(p.precio_venta >= 0) || !(p.precio_compra >= 0)) return { ok: false, error: "Precios inválidos" };
  if ((p.precio_ciento ?? 0) < 0 || (p.precio_millar ?? 0) < 0) return { ok: false, error: "Precios inválidos" };
  if (!(p.precio_venta > 0) && !(Number(p.precio_ciento) > 0) && !(Number(p.precio_millar) > 0)) {
    return { ok: false, error: "Ingresa al menos un precio (muestra, ciento o millar)" };
  }
  const { supabase } = await getSesion(); // sin sesión: lleva al login
  const data = {
    articulo_id: p.articulo_id,
    proveedor_id: p.proveedor_id,
    precio_compra: p.precio_compra,
    precio_venta: p.precio_venta,
    precio_ciento: Number(p.precio_ciento) > 0 ? p.precio_ciento : null,
    precio_millar: Number(p.precio_millar) > 0 ? p.precio_millar : null,
    desde_ciento: Math.max(1, Math.trunc(p.desde_ciento || 50)),
    desde_millar: Math.max(1, Math.trunc(p.desde_millar || 500)),
    moneda: p.moneda,
    preferido: p.preferido,
  };
  if (p.preferido) {
    // solo un proveedor preferido por artículo
    await supabase.from("articulo_proveedor").update({ preferido: false }).eq("articulo_id", p.articulo_id);
  }
  const { data: row, error } = p.id
    ? await supabase.from("articulo_proveedor").update(data).eq("id", p.id).select("id").single()
    : await supabase.from("articulo_proveedor").insert(data).select("id").single();
  if (error) {
    return { ok: false, error: error.code === "23505" ? "Ese proveedor ya está registrado para este artículo" : mensajeError(error) };
  }
  revalidatePath("/articulos", "layout");
  revalidatePath("/proveedores", "layout");
  return { ok: true, id: row.id };
}

export async function eliminarPrecio(id: string): Promise<Resultado> {
  const { supabase } = await getSesion(); // sin sesión: lleva al login
  const { error } = await supabase.from("articulo_proveedor").delete().eq("id", id);
  if (error) return { ok: false, error: mensajeError(error) };
  revalidatePath("/articulos", "layout");
  revalidatePath("/proveedores", "layout");
  return { ok: true, id };
}
