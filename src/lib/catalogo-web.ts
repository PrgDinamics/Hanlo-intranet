/**
 * Catálogo de la web pública (hanloinnova.com), 20/11/2026.
 * La intranet arma un JSON solo con campos seguros y lo sube al cPanel, igual que las revistas:
 *   public_html/datos/catalogo.json       lo lee la web desde su mismo dominio
 *   public_html/datos/catalogo.bak.json   copia del anterior
 *   public_html/datos/catalogo.info.json  fecha y cantidad (para mostrarlo en la intranet sin leer todo)
 * NUNCA lleva precios, costos, proveedores, stock, clientes, cotizaciones ni usuarios.
 * Solo servidor. Usa la llave secreta para leer (lo llaman acciones que ya revisaron permisos y la tarea diaria).
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todasLasFilas } from "@/lib/consultas";
import { cpanelConfigurado, crearCarpeta, ErrorCpanel, guardarTexto, leer, listar, subirArchivo } from "@/lib/cpanel";
import { esNuevo } from "@/lib/nuevos";

const CARPETA = "public_html/datos";
const ARCHIVO = "catalogo.json";
const RESPALDO = "catalogo.bak.json";
const INFO = "catalogo.info.json";
const HTACCESS = `Options -Indexes
<IfModule mod_headers.c>
  <FilesMatch "\\.json$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
`;

export type InfoCatalogoWeb = { actualizado: string; articulos: number; lineas: number };
export type ResultadoCatalogoWeb = { ok: true; info: InfoCatalogoWeb } | { ok: false; error: string };

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Arma el catálogo: artículos activos de líneas activas (o sin línea) */
export async function armarCatalogoWeb() {
  const sb = createAdminClient();
  const [lineas, articulos] = await Promise.all([
    todasLasFilas((a, b) => sb.from("lineas").select("id, nombre").eq("activo", true).order("nombre").order("id").range(a, b)),
    todasLasFilas((a, b) => sb.from("articulos")
      .select("codigo, descripcion, detalle, empaque, linea_id, foto_url, created_at, revisado_at")
      .eq("activo", true).order("descripcion").order("id").range(a, b)),
  ]);
  const activas = new Set(lineas.map((l) => l.id as string));
  const ahora = Date.now();
  return {
    version: 1,
    actualizado: new Date(ahora).toISOString(),
    lineas: lineas.map((l) => ({ id: l.id as string, nombre: l.nombre as string, categoria: null })),
    articulos: articulos
      .filter((a) => !a.linea_id || activas.has(a.linea_id as string))
      .map((a) => ({
        codigo: a.codigo as string,
        nombre: a.descripcion as string,
        detalle: texto(a.detalle),
        empaque: texto(a.empaque),
        linea: (a.linea_id as string | null) ?? null,
        foto: texto(a.foto_url),
        // Misma etiqueta que en la intranet: 15 días o hasta que alguien pulse "Ya lo revisé"
        nuevo: esNuevo(a.created_at, a.revisado_at, ahora),
      })),
  };
}

/** Arma y sube el catálogo. Nunca vacía la web por un fallo: si sale 0 y antes había artículos, no escribe */
export async function publicarCatalogo(): Promise<ResultadoCatalogoWeb> {
  if (!cpanelConfigurado()) return { ok: false, error: "Falta conectar el cPanel (CPANEL_URL, CPANEL_USUARIO y CPANEL_TOKEN en Vercel)" };
  try {
    const catalogo = await armarCatalogoWeb();
    const raiz = await listar("public_html");
    if (!raiz.some((f) => f.file === "datos" && f.type === "dir")) await crearCarpeta("public_html", "datos");
    const hay = await listar(CARPETA);
    if (!hay.some((f) => f.file === ".htaccess")) await guardarTexto(CARPETA, ".htaccess", HTACCESS);

    const previo = hay.some((f) => f.file === ARCHIVO) ? await leer(CARPETA, ARCHIVO) : null;
    if (previo && previo.trim()) {
      let antes = 0;
      try { antes = (JSON.parse(previo)?.articulos ?? []).length; } catch { antes = 0; }
      if (!catalogo.articulos.length && antes > 0) {
        return { ok: false, error: `El catálogo salió vacío y la web tiene ${antes} artículos: no se publicó para no vaciarla.` };
      }
      await subirArchivo(CARPETA, RESPALDO, new Blob([previo], { type: "application/json" }));
    }
    await subirArchivo(CARPETA, ARCHIVO, new Blob([JSON.stringify(catalogo)], { type: "application/json" }));
    const info: InfoCatalogoWeb = { actualizado: catalogo.actualizado, articulos: catalogo.articulos.length, lineas: catalogo.lineas.length };
    await guardarTexto(CARPETA, INFO, JSON.stringify(info));
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: e instanceof ErrorCpanel ? e.message : `No se pudo publicar el catálogo: ${(e as Error).message}` };
  }
}

/** Última publicación (null si nunca se publicó o no hay cPanel) */
export async function infoCatalogo(): Promise<InfoCatalogoWeb | null> {
  if (!cpanelConfigurado()) return null;
  try {
    const t = await leer(CARPETA, INFO);
    return t ? (JSON.parse(t) as InfoCatalogoWeb) : null;
  } catch {
    return null;
  }
}
