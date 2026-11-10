"use server";

import { revalidatePath } from "next/cache";
import { getSesion } from "@/lib/sesion";
import { parseFactores } from "@/lib/precios";
import { MODULOS, type Campo } from "@/lib/modulos";
import { mensajeError } from "@/lib/errores";

export type Resultado = { ok: true; id: string } | { ok: false; error: string };

function limpiar(campo: Campo, raw: unknown) {
  if (campo.type === "checkbox") return raw === true || raw === "true" || raw === "on";
  if (raw === undefined || raw === null) return null;
  let v = String(raw).trim();
  if (v === "") return null;
  if (campo.upper) v = v.toUpperCase();
  if (campo.type === "number") {
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n)) throw new Error(`"${campo.label}" debe ser un número`);
    if (n < 0) throw new Error(`"${campo.label}" no puede ser negativo`);
    return n;
  }
  if (campo.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
    throw new Error(`"${campo.label}" no es un correo válido`);
  }
  if (campo.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) {
    throw new Error(`"${campo.label}" no es una fecha válida`);
  }
  const max = campo.type === "textarea" ? 2000 : 300;
  if (v.length > max) throw new Error(`"${campo.label}" es demasiado largo (máximo ${max} caracteres)`);
  return v;
}

/** Inserta o actualiza un registro de cualquier maestro configurado en MODULOS */
export async function guardarRegistro(
  modKey: string,
  id: string | null,
  valores: Record<string, unknown>,
): Promise<Resultado> {
  const mod = MODULOS[modKey];
  if (!mod) return { ok: false, error: "Módulo no válido" };

  const data: Record<string, unknown> = {};
  try {
    for (const c of mod.campos) {
      const v = limpiar(c, valores[c.name]);
      if (c.required && (v === null || v === "")) return { ok: false, error: `Completa "${c.label}"` };
      data[c.name] = v;
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  if (modKey === "empresas" && "factores" in data) {
    const f = parseFactores(String(data.factores ?? ""));
    if (!f.length) return { ok: false, error: "Indica al menos un factor entre 0.01 y 1 (ej. 0.60, 0.75, 0.77, 0.80)" };
    data.factores = f.map((x) => x.toFixed(2)).join(", ");
  }
  if (modKey === "formas_pago") data.recargo_pct = Number(data.recargo_pct ?? 0);

  if (modKey === "tipos_cambio") {
    data.fuente = "manual"; // registrado o corregido a mano
    const [c, v] = [Number(data.compra), Number(data.venta)];
    // Evita errores de tipeo como 376 en vez de 3.76: el sol nunca ha estado fuera de este rango
    if (!(c >= 1 && c <= 10 && v >= 1 && v <= 10)) return { ok: false, error: "El tipo de cambio debe estar entre 1 y 10 soles por dólar (ej. 3.752)" };
    if (c > v) return { ok: false, error: "La compra no puede ser mayor que la venta" };
  }
  if (modKey === "formas_pago" && Number(data.recargo_pct) > 100) return { ok: false, error: "El recargo no puede ser mayor a 100%" };
  if (modKey === "empresas" && Number(data.igv_pct) > 100) return { ok: false, error: "El IGV no puede ser mayor a 100%" };

  if (modKey === "clientes") {
    // Solo empresas: RUC de 11 dígitos
    const ruc = String(data.num_doc ?? "").replace(/\D/g, "");
    if (ruc.length !== 11) return { ok: false, error: "El RUC debe tener 11 dígitos. Solo se registran empresas" };
    Object.assign(data, { num_doc: ruc, tipo_doc: "RUC", tipo_persona: "juridica" });
  }

  const { supabase } = await getSesion(); // sin sesión: lleva al login
  const q = id
    ? supabase.from(mod.tabla).update(data).eq("id", id).select("id").single()
    : supabase.from(mod.tabla).insert(data).select("id").single();
  const { data: row, error } = await q;
  if (error || !row) return { ok: false, error: error ? mensajeError(error) : "No se pudo guardar (sin permisos)" };

  revalidatePath(mod.ruta, "layout");
  return { ok: true, id: row.id as string };
}

export async function eliminarRegistro(modKey: string, id: string): Promise<Resultado> {
  const mod = MODULOS[modKey];
  if (!mod) return { ok: false, error: "Módulo no válido" };
  const { supabase } = await getSesion(); // sin sesión: lleva al login
  // Artículos y proveedores que ya están en cotizaciones no se borran: se desactivan
  const col = modKey === "articulos" ? "articulo_id" : modKey === "proveedores" ? "proveedor_id" : null;
  if (col) {
    const { count } = await supabase.from("cotizacion_items").select("id", { count: "exact", head: true }).eq(col, id);
    if (count) {
      return { ok: false, error: `No se puede eliminar porque aparece en ${count} ítem(s) de cotizaciones. Desmarca "Activo" para que ya no se use.` };
    }
  }
  const { data, error } = await supabase.from(mod.tabla).delete().eq("id", id).select("id");
  if (error) return { ok: false, error: mensajeError(error) };
  if (!data?.length) return { ok: false, error: "No se pudo eliminar (sin permisos)" };
  revalidatePath(mod.ruta, "layout");
  return { ok: true, id };
}
