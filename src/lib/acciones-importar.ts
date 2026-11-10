"use server";

import { revalidatePath } from "next/cache";
import { requirePermiso } from "@/lib/sesion";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { articulosExistentes, importarLista, leerListaProveedor, type AvisoLista } from "@/lib/importador-listas";
import { ejecutarImportacion, leerArchivo, previsualizar, validar, type ErrorFila, type ResumenHoja } from "@/lib/importador";

/**
 * El Excel se sube primero al bucket privado "importaciones" desde el navegador
 * (puede pesar varios MB por las fotos) y aquí se descarga por su ruta.
 */
async function leer(supabase: Awaited<ReturnType<typeof requirePermiso>>["supabase"], ruta: string) {
  if (!/^[\w-]+\.xlsx$/.test(ruta)) throw new Error("Archivo no válido");
  const { data, error } = await supabase.storage.from("importaciones").download(ruta);
  if (error || !data) throw new Error("No se encontró el archivo subido. Vuelve a seleccionarlo");
  try {
    return await leerArchivo(await data.arrayBuffer());
  } catch {
    throw new Error("No se pudo leer el archivo. ¿Es un Excel .xlsx?");
  }
}

export type Analisis =
  | { ok: true; resumen: ResumenHoja[]; errores: ErrorFila[]; hojasEncontradas: number; fotos: number; formato: string }
  | { ok: false; error: string };

export async function analizarPlantilla(ruta: string): Promise<Analisis> {
  const { supabase } = await requirePermiso("importar");
  try {
    const { hojas, fotos, formato } = await leer(supabase, ruta);
    const encontradas = Object.keys(hojas).length;
    if (!encontradas) return { ok: false, error: "El archivo no tiene ninguna hoja reconocible (Artículos, Proveedores, Clientes, AgentesVenta...). Si es una lista de stock de un proveedor, usa la pestaña \"Lista de stock de proveedor\"." };
    const { registros, errores } = validar(hojas);
    const resumen = (await previsualizar(supabase, registros, errores)).filter((r) => r.hoja in hojas);
    const codigos = new Set((registros["Artículos"] ?? []).map((a) => a.clave));
    return {
      ok: true, resumen, errores: errores.sort((a, b) => a.hoja.localeCompare(b.hoja) || a.fila - b.fila),
      hojasEncontradas: encontradas, fotos: [...fotos.keys()].filter((c) => codigos.has(c)).length,
      formato: formato === "cliente" ? "Formato del cliente (Información para cargar a la BD)" : "Plantilla de carga inicial",
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type ResultadoImport =
  | { ok: true; log: string[]; omitidas: number; credenciales: { nombre: string; email: string; password: string | null; estado: string }[] }
  | { ok: false; error: string };

/** Importa solo las filas válidas; las filas con error se omiten */
export async function importarPlantilla(ruta: string): Promise<ResultadoImport> {
  const { supabase, permisos } = await requirePermiso("importar");
  try {
    const { hojas, fotos } = await leer(supabase, ruta);
    const { registros, errores } = validar(hojas);
    // Usuarios y agentes (con sus límites) solo los carga el Administrador
    if (!permisos.es_admin && (registros.Usuarios?.length || registros.Agentes?.length)) {
      return { ok: false, error: "Las hojas Usuarios y Agentes solo las puede cargar el Administrador. Bórralas del Excel o pídele que lo importe." };
    }
    await previsualizar(supabase, registros, errores); // filtra precios con referencias inexistentes
    let admin = null;
    try { admin = createAdminClient(); } catch { admin = null; }
    const silencioso = await createClient({ sinActividad: true });
    const r = await ejecutarImportacion(silencioso, admin, registros, fotos);
    await supabase.rpc("registrar_importacion", { p_registro: "Carga inicial desde Excel", p_resumen: r.log });
    await supabase.storage.from("importaciones").remove([ruta]);
    revalidatePath("/", "layout");
    return { ok: true, log: r.log, omitidas: errores.length, credenciales: r.credenciales };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Listas de stock de proveedores
// ---------------------------------------------------------------------------

async function leerLista(supabase: Awaited<ReturnType<typeof requirePermiso>>["supabase"], ruta: string) {
  if (!/^[\w-]+\.xlsx$/.test(ruta)) throw new Error("Archivo no válido");
  const { data, error } = await supabase.storage.from("importaciones").download(ruta);
  if (error || !data) throw new Error("No se encontró el archivo subido. Vuelve a seleccionarlo");
  try {
    return await leerListaProveedor(await data.arrayBuffer());
  } catch {
    throw new Error("No se pudo leer el archivo. ¿Es un Excel .xlsx?");
  }
}

export type AnalisisLista =
  | {
      ok: true;
      hojas: { nombre: string; linea: string; productos: number; colores: number; fotos: number }[];
      ignoradas: string[];
      avisos: AvisoLista[];
      productos: number;
      nuevos: number;
      existentes: number;
      conPrecio: number;
      stockTotal: number;
      /** Lo que dice el archivo (texto o nombre) sobre el IGV de sus precios */
      igvArchivo: "incluido" | "sin" | null;
      igvMotivo: string | null;
      /** Ejemplo de precio para mostrar cómo quedará */
      ejemplo: { descripcion: string; precio: number } | null;
    }
  | { ok: false; error: string };

export async function analizarLista(ruta: string, nombreArchivo = ""): Promise<AnalisisLista> {
  const { supabase } = await requirePermiso("importar");
  try {
    const l = await leerLista(supabase, ruta);
    if (!l.productos.length) {
      return { ok: false, error: "No se encontraron productos. Las hojas deben tener encabezados CODIGO, PRODUCTO, COLOR y STOCK" };
    }
    const ex = await articulosExistentes(supabase, l.productos.map((p) => p.codigo));
    void nombreArchivo;
    const igvArchivo = l.igv;
    const igvMotivo = l.igv
      ? (l.igv === "sin" ? "El archivo dice que los precios no incluyen IGV" : "El archivo muestra precios con IGV incluido")
      : null;
    const conMuestra = l.productos.find((p) => p.muestra);
    return {
      ok: true,
      hojas: l.hojas,
      ignoradas: l.ignoradas,
      avisos: l.avisos,
      productos: l.productos.length,
      nuevos: l.productos.filter((p) => !ex.has(p.codigo)).length,
      existentes: l.productos.filter((p) => ex.has(p.codigo)).length,
      conPrecio: l.productos.filter((p) => p.muestra || p.ciento || p.millar).length,
      stockTotal: l.productos.reduce((a, p) => a + [...p.colores.values()].reduce((x, y) => x + Math.max(0, y), 0), 0),
      igvArchivo,
      igvMotivo,
      ejemplo: conMuestra ? { descripcion: conMuestra.descripcion, precio: conMuestra.muestra! } : null,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function importarListaProveedor(
  ruta: string,
  proveedorId: string,
  ceroSiNoEsta: boolean,
  incluyeIgv: boolean | null,
): Promise<{ ok: true; log: string[] } | { ok: false; error: string }> {
  const { supabase } = await requirePermiso("importar");
  if (!proveedorId) return { ok: false, error: "Elige el proveedor de esta lista" };
  if (incluyeIgv === null) return { ok: false, error: "Indica si los precios de esta lista incluyen IGV" };
  try {
    const l = await leerLista(supabase, ruta);
    const silencioso = await createClient({ sinActividad: true });
    const { data: emp } = await supabase.from("empresas").select("igv_pct").eq("activo", true).order("created_at").limit(1).maybeSingle();
    const r = await importarLista(silencioso, proveedorId, l, { ceroSiNoEsta, incluyeIgv, igvPct: Number(emp?.igv_pct ?? 18) });
    // El proveedor recuerda la opción para la próxima lista
    await supabase.from("proveedores").update({ precios_incluyen_igv: incluyeIgv }).eq("id", proveedorId);
    const { data: prov } = await supabase.from("proveedores").select("razon_social").eq("id", proveedorId).maybeSingle();
    await supabase.rpc("registrar_importacion", { p_registro: `Lista de stock · ${prov?.razon_social ?? "proveedor"}`, p_resumen: r.log });
    await supabase.storage.from("importaciones").remove([ruta]);
    revalidatePath("/", "layout");
    return { ok: true, log: r.log };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
