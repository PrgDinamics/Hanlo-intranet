import "server-only";
import { getSesion, puede } from "@/lib/sesion";
import { consultaHabilitada } from "@/lib/decolecta";
import { asegurarTipoCambioHoy } from "@/lib/tipo-cambio";

export type PrecioCat = {
  id: string;
  proveedor_id: string;
  proveedor: string;
  precio_compra: number;
  precio_venta: number;
  precio_ciento: number | null;
  precio_millar: number | null;
  desde_ciento: number;
  desde_millar: number;
  stock: number | null;
  stock_al: string | null;
  moneda: "PEN" | "USD";
  preferido: boolean;
  colores: { color: string; stock: number }[];
};
export type ArticuloCat = {
  id: string;
  codigo: string;
  descripcion: string;
  detalle: string | null;
  unidad: string;
  foto_url: string | null;
  linea: string | null;
  stock_ref: number | null;
  empaque: string | null;
  precios: PrecioCat[];
};
export type DatosEditor = {
  empresas: { id: string; razon_social: string; igv_pct: number; margen_pct: number; factores: string; costo_impresion: number }[];
  clientes: { id: string; nombre: string; num_doc: string; agente_id: string | null }[];
  agentes: { id: string; nombre: string }[];
  formas: { id: string; nombre: string; dias_credito: number; recargo_pct: number }[];
  tipoCambio: number | null;
  /** Solo los artículos que ya están en la cotización; el resto se busca con buscarCatalogo */
  articulos: ArticuloCat[];
  agenteUsuario: string | null;
  /** Consulta RUC/DNI habilitada (para el alta rápida de clientes) */
  consulta: boolean;
  creaCliente: boolean;
  /** Límite en soles del vendedor (null = sin límite) */
  limite: number | null;
};

/**
 * Supabase devuelve como máximo 1000 filas por consulta: se pide por páginas.
 * Las páginas se piden de 4 en 4 en paralelo (con 5,000 artículos baja de ~5 viajes seguidos a 2).
 */
async function todos<T>(pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null }>) {
  const out: T[] = [];
  const TAM = 1000;
  const EN_PARALELO = 4;
  for (let bloque = 0; ; bloque += EN_PARALELO) {
    const res = await Promise.all(
      Array.from({ length: EN_PARALELO }, (_, i) => pagina((bloque + i) * TAM, (bloque + i) * TAM + TAM - 1)),
    );
    let completo = true;
    for (const { data } of res) {
      out.push(...(data ?? []));
      if (!data || data.length < TAM) { completo = false; break; }
    }
    if (!completo) break;
  }
  return out;
}

const SELECT_CATALOGO =
  "id, codigo, descripcion, detalle, unidad, foto_url, stock_ref, empaque, linea:lineas(nombre), " +
  "precios:articulo_proveedor(id, proveedor_id, precio_compra, precio_venta, precio_ciento, precio_millar, " +
  "desde_ciento, desde_millar, stock, stock_al, moneda, preferido, proveedor:proveedores(razon_social), " +
  "colores:articulo_proveedor_color(color, stock))";

type ArtRaw = Omit<ArticuloCat, "linea" | "precios"> & {
  linea: { nombre: string } | null;
  precios: (Omit<PrecioCat, "proveedor"> & { proveedor: { razon_social: string } | null })[];
};

function aCatalogo(a: ArtRaw): ArticuloCat {
  return {
    ...a,
    linea: a.linea?.nombre ?? null,
    precios: a.precios
      .map((p) => ({
        ...p,
        proveedor: p.proveedor?.razon_social ?? "",
        colores: [...(p.colores ?? [])].sort((x, y) => Number(y.stock) - Number(x.stock)),
      }))
      .sort((x, y) => Number(y.preferido) - Number(x.preferido) || x.precio_venta - y.precio_venta),
  };
}

type Cliente = Awaited<ReturnType<typeof getSesion>>["supabase"];

/** Artículos puntuales (los que ya están en la cotización que se edita) */
async function articulosPorId(supabase: Cliente, ids: string[]) {
  const unicos = [...new Set(ids.filter(Boolean))];
  const out: ArticuloCat[] = [];
  for (let i = 0; i < unicos.length; i += 150) {
    const { data } = await supabase.from("articulos").select(SELECT_CATALOGO).in("id", unicos.slice(i, i + 150));
    out.push(...((data ?? []) as unknown as ArtRaw[]).map(aCatalogo));
  }
  return out;
}

/**
 * Búsqueda en el catálogo para el editor: hasta 60 artículos activos.
 * Cada palabra debe aparecer en el código o en la descripción ("taza blanca" encuentra "Taza cerámica blanca").
 * Antes se mandaba el catálogo completo al navegador; con miles de artículos abrir el editor tardaba 10 s o más.
 */
export async function buscarEnCatalogo(q: string): Promise<ArticuloCat[]> {
  const { supabase } = await getSesion();
  let query = supabase.from("articulos").select(SELECT_CATALOGO).eq("activo", true);
  const palabras = q.trim().replace(/[%,()*\\]/g, " ").split(/\s+/).filter(Boolean).slice(0, 6);
  for (const w of palabras) query = query.or(`codigo.ilike.%${w}%,descripcion.ilike.%${w}%`);
  const { data } = await query.order("descripcion").limit(60);
  return ((data ?? []) as unknown as ArtRaw[]).map(aCatalogo);
}

/** Lo que el editor de cotizaciones necesita al abrir. Los artículos se buscan aparte, a pedido. */
export async function cargarDatosEditor(articuloIds: string[] = []): Promise<DatosEditor> {
  const { supabase, perfil, permisos } = await getSesion();
  const [emp, cliData, age, fp, tc, articulos] = await Promise.all([
    supabase.from("empresas").select("id, razon_social, igv_pct, margen_pct, factores, costo_impresion").eq("activo", true).order("razon_social"),
    todos((a, b) => supabase.from("clientes").select("id, nombre, num_doc, agente_id").eq("activo", true).order("nombre").range(a, b)),
    supabase.from("agentes").select("id, nombre").eq("activo", true).order("nombre"),
    supabase.from("formas_pago").select("id, nombre, dias_credito, recargo_pct").eq("activo", true).order("dias_credito"),
    supabase.from("tipos_cambio").select("fecha, venta").order("fecha", { ascending: false }).limit(1).maybeSingle(),
    articulosPorId(supabase, articuloIds),
  ]);

  return {
    empresas: emp.data ?? [],
    clientes: cliData as DatosEditor["clientes"],
    // Un vendedor solo puede asignarse a sí mismo; quien ve todas las cotizaciones elige cualquier agente
    agentes: puede(permisos, "cotizaciones_todas") ? age.data ?? [] : (age.data ?? []).filter((x) => x.id === perfil.agente_id),
    formas: fp.data ?? [],
    tipoCambio: (await asegurarTipoCambioHoy(tc.data?.fecha ?? null)) ?? tc.data?.venta ?? null,
    agenteUsuario: perfil.agente_id,
    consulta: consultaHabilitada(),
    creaCliente: permisos.crea_cliente,
    limite: permisos.limite_venta,
    articulos,
  };
}
