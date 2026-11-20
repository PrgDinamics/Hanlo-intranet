"use server";

import { revalidatePath } from "next/cache";
import { getSesion, requirePermiso } from "@/lib/sesion";
import { borrar, cpanelConfigurado, crearCarpeta, ErrorCpanel, guardarTexto, leer, listar, listarSiExiste, sitioPublico, subirArchivo } from "@/lib/cpanel";
import { CARPETA_REVISTAS, INDICE_REVISTAS, type Revista } from "@/lib/revistas";
import {
  archivoPortada, CARPETA_DATOS, CARPETA_PORTADA, CASILLEROS, CATEGORIAS_WEB, INDICE_PORTADA, MAX_ETIQUETA_TEXTO,
  MAX_ETIQUETA_TITULO, RESPALDO_PORTADA, rutaPortada, type PortadaWeb,
} from "@/lib/portada-web";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const SIN_CPANEL = "Falta conectar el cPanel (variables CPANEL_URL, CPANEL_USUARIO y CPANEL_TOKEN en Vercel)";
const fallo = (e: unknown): { ok: false; error: string } => ({
  ok: false,
  error: e instanceof ErrorCpanel ? e.message : `Error inesperado: ${e instanceof Error ? e.message : String(e)}`,
});
const HTACCESS = `Options -Indexes
<IfModule mod_headers.c>
  <FilesMatch "\\.json$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
`;
const esJpg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** portada.json actual (null si no existe: la web usa la de siempre). Si está dañado, se detiene */
async function leerPortada(): Promise<PortadaWeb | null> {
  const txt = await leer(CARPETA_DATOS, INDICE_PORTADA);
  if (txt === null || !txt.trim()) return null;
  try {
    const j = JSON.parse(txt) as PortadaWeb;
    if (!Array.isArray(j.imagenes)) throw new Error();
    return j;
  } catch {
    throw new ErrorCpanel(`${CARPETA_DATOS}/${INDICE_PORTADA} está dañado. Restáuralo desde ${RESPALDO_PORTADA} en el cPanel o usa "Volver a la de siempre".`);
  }
}

async function revistasPublicadas(): Promise<{ slug: string; titulo: string }[]> {
  const txt = await leer(CARPETA_REVISTAS, INDICE_REVISTAS).catch(() => null);
  if (!txt) return [];
  try {
    return ((JSON.parse(txt).revistas ?? []) as Revista[]).filter((r) => r.activo).map((r) => ({ slug: r.slug, titulo: r.titulo }));
  } catch {
    return [];
  }
}

export async function estadoPortada(): Promise<
  { configurado: false; sitio: string }
  | { configurado: true; sitio: string; portada: PortadaWeb | null; revistas: { slug: string; titulo: string }[]; error?: string }
> {
  await requirePermiso("revistas");
  const sitio = sitioPublico();
  if (!cpanelConfigurado()) return { configurado: false, sitio };
  try {
    const [portada, revistas] = await Promise.all([leerPortada(), revistasPublicadas()]);
    return { configurado: true, sitio, portada, revistas };
  } catch (e) {
    return { configurado: true, sitio, portada: null, revistas: [], error: fallo(e).error };
  }
}

/** Para "elegir un artículo por su código": su foto (solo artículos activos con foto) */
export async function fotoDeArticulo(codigo: string): Promise<Res<{ descripcion: string; foto: string }>> {
  await requirePermiso("revistas");
  const { supabase } = await getSesion();
  const c = String(codigo ?? "").trim().toUpperCase();
  if (!c) return { ok: false, error: "Escribe el código del artículo" };
  const { data } = await supabase.from("articulos").select("descripcion, foto_url, activo").eq("codigo", c).maybeSingle();
  if (!data) return { ok: false, error: `No existe el artículo ${c}` };
  if (!data.activo) return { ok: false, error: `El artículo ${c} está inactivo` };
  // La web solo acepta https:// (en pruebas locales, http://localhost)
  if (!data.foto_url || !(/^https:\/\//.test(data.foto_url) || /^http:\/\/localhost/.test(data.foto_url))) return { ok: false, error: `El artículo ${c} no tiene foto` };
  return { ok: true, descripcion: data.descripcion, foto: data.foto_url };
}

/**
 * Guarda la portada. Por cada casillero n (1 a 5) llega `modo<n>`:
 *   "igual" deja lo que tenía, "siempre" usa la imagen de siempre de la web,
 *   "subir" trae `archivo<n>` (JPG ya preparado en el navegador), "articulo" trae `codigo<n>`.
 * Etiqueta: titulo, texto y enlace ("" | "revista:<slug>" | "categoria:<slug>").
 */
export async function guardarPortada(fd: FormData): Promise<Res> {
  await requirePermiso("revistas");
  if (!cpanelConfigurado()) return { ok: false, error: SIN_CPANEL };
  const titulo = String(fd.get("titulo") ?? "").trim();
  const texto = String(fd.get("texto") ?? "").trim();
  if (titulo.length > MAX_ETIQUETA_TITULO) return { ok: false, error: `El texto grande puede tener hasta ${MAX_ETIQUETA_TITULO} letras` };
  if (texto.length > MAX_ETIQUETA_TEXTO) return { ok: false, error: `El texto pequeño puede tener hasta ${MAX_ETIQUETA_TEXTO} letras` };
  try {
    const actual = await leerPortada();
    // Enlace: solo una revista publicada o una categoría del catálogo (nada escrito a mano)
    const e = String(fd.get("enlace") ?? "");
    let enlace: string | null = null;
    if (e.startsWith("revista:")) {
      const slug = e.slice(8);
      if (!(await revistasPublicadas()).some((r) => r.slug === slug)) return { ok: false, error: "Esa revista ya no está publicada" };
      enlace = `/revistas/${slug}/`;
    } else if (e.startsWith("categoria:")) {
      const slug = e.slice(10);
      if (!CATEGORIAS_WEB.some((c) => c.slug === slug)) return { ok: false, error: "Categoría no válida" };
      enlace = `/productos/${slug}/`;
    } else if (e) return { ok: false, error: "Enlace no válido" };

    const version = Date.now().toString(36);
    const imagenes: PortadaWeb["imagenes"] = [];
    const subidas: { n: number; blob: Blob }[] = [];
    for (let n = 1; n <= CASILLEROS.length; n++) {
      const modo = String(fd.get(`modo${n}`) ?? "igual");
      if (modo === "igual") { imagenes.push(actual?.imagenes?.[n - 1] ?? { foto: null }); continue; }
      if (modo === "siempre") { imagenes.push({ foto: null }); continue; }
      if (modo === "articulo") {
        const r = await fotoDeArticulo(String(fd.get(`codigo${n}`) ?? ""));
        if (!r.ok) return { ok: false, error: `Imagen ${n}: ${r.error}` };
        imagenes.push({ foto: r.foto, codigo: String(fd.get(`codigo${n}`)).trim().toUpperCase() });
        continue;
      }
      if (modo === "subir") {
        const b = fd.get(`archivo${n}`);
        if (!(b instanceof Blob) || b.size > 1024 * 1024) return { ok: false, error: `Imagen ${n}: debe llegar como JPG de hasta 1 MB` };
        if (!esJpg(new Uint8Array(await b.slice(0, 3).arrayBuffer()))) return { ok: false, error: `Imagen ${n}: debe llegar como JPG` };
        subidas.push({ n, blob: b });
        imagenes.push({ foto: rutaPortada(n, version) });
        continue;
      }
      return { ok: false, error: `Imagen ${n}: opción no válida` };
    }

    await crearCarpeta("public_html", "datos");
    const hay = await listar(CARPETA_DATOS);
    if (!hay.some((f) => f.file === ".htaccess")) await guardarTexto(CARPETA_DATOS, ".htaccess", HTACCESS);
    if (subidas.length) {
      if (!hay.some((f) => f.file === "portada" && f.type === "dir")) await crearCarpeta(CARPETA_DATOS, "portada");
      for (const s of subidas) await subirArchivo(CARPETA_PORTADA, archivoPortada(s.n, version), s.blob);
    }
    const portada: PortadaWeb = {
      actualizado: new Date().toISOString(),
      imagenes,
      etiqueta: titulo || texto ? { titulo, texto, enlace } : null,
    };
    const previo = await leer(CARPETA_DATOS, INDICE_PORTADA);
    if (previo && previo.trim()) await guardarTexto(CARPETA_DATOS, RESPALDO_PORTADA, previo);
    await guardarTexto(CARPETA_DATOS, INDICE_PORTADA, JSON.stringify(portada, null, 2));
    await limpiarImagenes(imagenes.map((i) => i.foto));
    revalidatePath("/portada-web");
    return { ok: true };
  } catch (err) {
    return fallo(err);
  }
}

/** Borra las imágenes subidas que ya no usa ningún casillero */
async function limpiarImagenes(enUso: (string | null)[]) {
  const archivos = await listarSiExiste(CARPETA_PORTADA).catch(() => null);
  if (!archivos) return;
  const usados = new Set(enUso.filter(Boolean).map((f) => String(f).split("/").pop()));
  const sobran = archivos.filter((f) => f.type !== "dir" && /^\d-[a-z0-9]+\.jpg$/.test(f.file) && !usados.has(f.file));
  await borrar(sobran.map((f) => `${CARPETA_PORTADA}/${f.file}`)).catch(() => {});
}

/** "Volver a la de siempre": borra portada.json y las imágenes subidas; la web usa las suyas y "Eco / Línea nature" */
export async function volverPortadaDeSiempre(): Promise<Res> {
  await requirePermiso("revistas");
  if (!cpanelConfigurado()) return { ok: false, error: SIN_CPANEL };
  try {
    const previo = await leer(CARPETA_DATOS, INDICE_PORTADA);
    if (previo !== null) {
      if (previo.trim()) await guardarTexto(CARPETA_DATOS, RESPALDO_PORTADA, previo);
      await borrar([`${CARPETA_DATOS}/${INDICE_PORTADA}`]);
    }
    await limpiarImagenes([]);
    revalidatePath("/portada-web");
    return { ok: true };
  } catch (err) {
    return fallo(err);
  }
}
