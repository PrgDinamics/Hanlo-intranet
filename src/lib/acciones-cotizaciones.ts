"use server";

import { revalidatePath } from "next/cache";
import { MAX_COLORES, impresionPorUnidad } from "@/lib/impresion";
import { getSesion } from "@/lib/sesion";
import { mensajeError } from "@/lib/errores";
import type { Resultado } from "@/lib/acciones";
import { TRANSICIONES, type EstadoCotizacion } from "@/lib/estados";
import { precioMaximo } from "@/lib/precios";

/** Ítem sin stock suficiente según las listas de proveedores más recientes */
export type Faltante = { orden: number; descripcion: string; color: string | null; cantidad: number; disponible: number };

/** Igual que Resultado, pero puede pedir confirmación por falta de stock al emitir */
export type ResultadoCot =
  | Resultado
  | { ok: false; error: string; id: string; faltantes: Faltante[] };

async function faltantesDe(supabase: Awaited<ReturnType<typeof getSesion>>["supabase"], id: string): Promise<Faltante[]> {
  const { data } = await supabase.rpc("revisar_stock", { p_id: id });
  return ((data ?? []) as Faltante[]).map((f) => ({ ...f, cantidad: Number(f.cantidad), disponible: Number(f.disponible) }));
}

export type CabeceraInput = {
  id?: string | null;
  empresa_id: string;
  cliente_id: string;
  agente_id: string | null;
  moneda: "PEN" | "USD";
  tipo_cambio: number | null;
  forma_pago_id: string | null;
  lugar: string;
  fecha_emision: string;
  validez_dias: number;
  tiempo_entrega: string;
  precios_incluyen_igv: boolean;
  observaciones: string;
};

export type ItemInput = {
  articulo_id: string | null;
  proveedor_id: string | null;
  descripcion: string;
  detalle: string;
  unidad: string;
  cantidad: number;
  precio_costo: number;
  precio_unitario: number;
  descuento_pct: number;
  color: string;
  /** Factor con el que se calculó el precio (venta = costo ÷ factor); null = precio manual */
  factor: number | null;
  /** Colores o impresiones del logo por producto (impresiones = cantidad × colores) */
  impresion_colores: number;
};

/** Fila sin nada escrito: sin descripción, artículo ni detalle, precio 0 y cantidad 1 (o vacía) */
function filaVacia(i: ItemInput) {
  return !i.descripcion.trim() && !i.articulo_id && !(i.detalle ?? "").trim() && !Number(i.impresion_colores)
    && !Number(i.precio_unitario) && (!Number(i.cantidad) || Number(i.cantidad) === 1);
}

/** T.C. de la cotización: obligatorio en dólares y, si se escribe, entre 1 y 10 (igual que la base) */
function validarTipoCambio(moneda: string, tipoCambio: number | null): string | null {
  const tc = tipoCambio === null || tipoCambio === undefined || String(tipoCambio) === "" ? null : Number(tipoCambio);
  if (tc === null) return moneda === "USD" ? "Registra el tipo de cambio: es obligatorio en cotizaciones en dólares" : null;
  if (!(tc >= 1 && tc <= 10)) return "El tipo de cambio debe estar entre 1 y 10 (ej. 3.75)";
  return null;
}

function revalidar(id?: string) {
  revalidatePath("/cotizaciones");
  revalidatePath("/");
  if (id) revalidatePath(`/cotizaciones/${id}`);
}

export async function guardarCotizacion(
  cab: CabeceraInput, items: ItemInput[], emitir = false, forzarStock = false,
): Promise<ResultadoCot> {
  await getSesion(); // sin sesión: lleva al login antes de revisar nada
  if (!cab.empresa_id) return { ok: false, error: "Selecciona la empresa que cotiza" };
  if (!cab.cliente_id) return { ok: false, error: "Selecciona el cliente" };
  const tcError = validarTipoCambio(cab.moneda, cab.tipo_cambio);
  if (tcError) return { ok: false, error: tcError };
  // Solo se descartan las filas totalmente vacías (como nace una fila nueva en el editor)
  const limpios = items.filter((i) => !filaVacia(i));
  if (!limpios.length) return { ok: false, error: "Agrega al menos un ítem" };
  for (const [n, i] of limpios.entries()) {
    if (!i.descripcion.trim()) return { ok: false, error: `Ítem ${n + 1}: falta la descripción` };
    if (!(i.cantidad > 0)) return { ok: false, error: `Ítem ${n + 1}: la cantidad debe ser mayor a 0` };
    if (i.cantidad > 10_000_000) return { ok: false, error: `Ítem ${n + 1}: la cantidad es demasiado grande` };
    if (i.precio_unitario > 100_000_000) return { ok: false, error: `Ítem ${n + 1}: el precio es demasiado grande` };
    if (i.cantidad * i.precio_unitario > 1_000_000_000) return { ok: false, error: `Ítem ${n + 1}: el importe supera S/ 1,000 millones. Revisa cantidad y precio` };
    if (!(i.precio_unitario >= 0)) return { ok: false, error: `Ítem ${n + 1}: precio inválido` };
    const col = Number(i.impresion_colores ?? 0);
    if (!Number.isInteger(col) || col < 0 || col > MAX_COLORES) return { ok: false, error: `Ítem ${n + 1}: los colores de impresión van de 0 a ${MAX_COLORES}` };
    if (i.factor !== null && i.factor !== undefined && !(i.factor > 0 && i.factor <= 1)) return { ok: false, error: `Ítem ${n + 1}: factor inválido` };
  }

  const { supabase } = await getSesion(); // sin sesión: lleva al login

  // Regla del cliente: el precio de venta nunca baja del costo más alto entre sus proveedores (según cantidad).
  // Con factor (costo ÷ 0.75, etc.) siempre queda por encima; esto protege contra precios escritos a mano.
  const artIds = [...new Set(limpios.map((i) => i.articulo_id).filter(Boolean))] as string[];
  if (artIds.length) {
    const [{ data: precios, error: ePrecios }, { data: emp, error: eEmp }] = await Promise.all([
      supabase
        .from("articulo_proveedor")
        .select("articulo_id, proveedor_id, precio_venta, precio_ciento, precio_millar, desde_ciento, desde_millar, moneda")
        .in("articulo_id", artIds),
      supabase.from("empresas").select("igv_pct, margen_pct, costo_impresion").eq("id", cab.empresa_id).single(),
    ]);
    // Sin los precios no se puede revisar el mínimo: no se guarda (nunca se salta la validación)
    if (ePrecios || eEmp) {
      return { ok: false, error: `No se pudieron revisar los precios de los proveedores: ${mensajeError(ePrecios ?? eEmp)}. Intenta de nuevo.` };
    }
    const tc = Number(cab.tipo_cambio) || 0;
    if ((precios ?? []).some((p) => p.moneda !== cab.moneda) && !tc) {
      return { ok: false, error: "Falta el tipo de cambio para convertir precios" };
    }
    const ctx = {
      moneda: cab.moneda, tipoCambio: tc, incluyeIgv: cab.precios_incluyen_igv,
      igvPct: Number(emp?.igv_pct ?? 18), margenPct: 0,
    };
    for (const [n, i] of limpios.entries()) {
      if (!i.articulo_id) continue;
      const max = precioMaximo((precios ?? []).filter((p) => p.articulo_id === i.articulo_id), i.cantidad, ctx);
      // La impresión del logo también es costo: el mínimo es proveedor más alto + impresión por unidad
      let imp = impresionPorUnidad(i.impresion_colores, Number(emp?.costo_impresion ?? 0), cab.moneda, tc);
      if (cab.precios_incluyen_igv) imp = imp * (1 + ctx.igvPct / 100);
      const minimo = Math.round(((max?.precio ?? 0) + imp) * 10000) / 10000;
      if (minimo > 0 && i.precio_unitario < minimo - 0.00005) {
        return {
          ok: false,
          error: `Ítem ${n + 1}: para ${i.cantidad} unidades el precio no puede ser menor al costo (proveedor más alto${imp ? " e impresión" : ""}: ${minimo}). Elige un factor.`,
        };
      }
    }
  }

  // El descuento por ítem ya no se usa: siempre 0
  const filas = limpios.map((i) => ({
    ...i, descuento_pct: 0,
    impresion_colores: Number(i.impresion_colores) || 0,
  }));
  const { data: id, error } = await supabase.rpc("guardar_cotizacion", { p_cab: cab, p_items: filas });
  if (error) return { ok: false, error: mensajeError(error) };

  if (emitir) {
    const { data: actual } = await supabase.from("cotizaciones").select("estado").eq("id", id).single();
    if (actual?.estado === "borrador") {
      // Antes de emitir se revisa el stock con las listas más recientes; queda guardada como borrador
      if (!forzarStock) {
        const faltantes = await faltantesDe(supabase, id as string);
        if (faltantes.length) {
          revalidar(id as string);
          return { ok: false, error: "stock", id: id as string, faltantes };
        }
      }
      // Si supera el límite del vendedor queda "por_aprobar"
      const { error: e2 } = await supabase.rpc("emitir_cotizacion", { p_id: id });
      if (e2) return { ok: false, error: mensajeError(e2) };
    }
  }
  revalidar(id as string);
  return { ok: true, id: id as string };
}

export async function cambiarEstado(
  id: string, estado: EstadoCotizacion, motivo?: string, forzarStock = false,
): Promise<ResultadoCot> {
  const { supabase } = await getSesion(); // sin sesión: lleva al login
  const { data: actual } = await supabase.from("cotizaciones").select("estado").eq("id", id).single();
  if (!actual) return { ok: false, error: "Cotización no encontrada" };
  if (!TRANSICIONES[actual.estado as EstadoCotizacion]?.includes(estado)) {
    return { ok: false, error: "Ese cambio de estado no está permitido" };
  }
  if (estado === "emitida" && ["borrador", "por_aprobar"].includes(actual.estado) && !forzarStock) {
    const faltantes = await faltantesDe(supabase, id);
    if (faltantes.length) return { ok: false, error: "stock", id, faltantes };
  }
  if (estado === "emitida" && actual.estado === "borrador") {
    const { error } = await supabase.rpc("emitir_cotizacion", { p_id: id });
    if (error) return { ok: false, error: mensajeError(error) };
    revalidar(id);
    return { ok: true, id };
  }
  const cambios: Record<string, unknown> = { estado };
  if (estado === "anulada") {
    if (!motivo?.trim()) return { ok: false, error: "Indica el motivo de anulación" };
    cambios.motivo_anulacion = motivo.trim();
  }
  const { error } = await supabase.from("cotizaciones").update(cambios).eq("id", id);
  if (error) return { ok: false, error: mensajeError(error) };
  revalidar(id);
  return { ok: true, id };
}

export async function nuevaVersion(id: string): Promise<Resultado> {
  const { supabase } = await getSesion(); // sin sesión: lleva al login
  const { data, error } = await supabase.rpc("nueva_version_cotizacion", { p_id: id });
  if (error) return { ok: false, error: mensajeError(error) };
  revalidar(id);
  return { ok: true, id: data as string };
}

export async function duplicarCotizacion(id: string): Promise<Resultado> {
  const { supabase } = await getSesion(); // sin sesión: lleva al login
  const { data, error } = await supabase.rpc("duplicar_cotizacion", { p_id: id });
  if (error) return { ok: false, error: mensajeError(error) };
  revalidar();
  return { ok: true, id: data as string };
}
