"use server";

import { revalidatePath } from "next/cache";
import { requirePermiso } from "@/lib/sesion";
import {
  borrar, crearCarpeta, cpanelConfigurado, ErrorCpanel, guardarTexto, leer, listar, sitioPublico, subirArchivo,
} from "@/lib/cpanel";
import {
  archivoPagina, CARPETA_REVISTAS, carpetaRevista, HTACCESS_CARPETA, HTACCESS_REVISTA, rutaRevista, htmlNoDisponible, htmlRevista, INDICE_REVISTAS,
  MAX_PAGINAS, validarSlug, type IndiceRevistas, type Revista,
} from "@/lib/revistas";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fallo = (e: unknown): { ok: false; error: string } => ({
  ok: false,
  error: e instanceof ErrorCpanel ? e.message : `Error inesperado: ${e instanceof Error ? e.message : String(e)}`,
});

/** Lista de revistas. Si existe pero no se puede leer, se detiene todo: nunca se reescribe vacía */
async function leerIndice(): Promise<IndiceRevistas> {
  const txt = await leer(CARPETA_REVISTAS, INDICE_REVISTAS);
  if (txt === null || !txt.trim()) return { revistas: [] };
  let j: unknown;
  try {
    j = JSON.parse(txt);
  } catch {
    throw new ErrorCpanel(`La lista ${CARPETA_REVISTAS}/${INDICE_REVISTAS} está dañada. Restáurala desde ${INDICE_RESPALDO} en el cPanel antes de seguir.`);
  }
  const lista = (j as IndiceRevistas)?.revistas;
  if (!Array.isArray(lista)) throw new ErrorCpanel(`La lista ${CARPETA_REVISTAS}/${INDICE_REVISTAS} no tiene el formato esperado.`);
  return { revistas: lista };
}

const INDICE_RESPALDO = "index.bak.json";

/** Guarda la lista dejando antes una copia de la anterior (index.bak.json) */
async function guardarIndice(ind: IndiceRevistas) {
  ind.revistas.sort((a, b) => b.actualizado.localeCompare(a.actualizado));
  const previo = await leer(CARPETA_REVISTAS, INDICE_REVISTAS);
  if (previo && previo.trim()) await guardarTexto(CARPETA_REVISTAS, INDICE_RESPALDO, previo);
  await guardarTexto(CARPETA_REVISTAS, INDICE_REVISTAS, JSON.stringify(ind, null, 2));
}

/** Título: texto de 1 a 120 letras */
function validarTitulo(titulo: unknown): string | null {
  if (typeof titulo !== "string" || !titulo.trim()) return "Escribe el título de la revista";
  if (titulo.trim().length > 120) return "El título puede tener hasta 120 letras";
  return null;
}

/** Estado para la pantalla: si el cPanel está conectado y las revistas publicadas */
export async function listarRevistas(): Promise<
  { configurado: false; sitio: string } | { configurado: true; sitio: string; revistas: Revista[]; error?: string }
> {
  await requirePermiso("revistas");
  const sitio = sitioPublico();
  if (!cpanelConfigurado()) return { configurado: false, sitio };
  try {
    return { configurado: true, sitio, revistas: (await leerIndice()).revistas };
  } catch (e) {
    return { configurado: true, sitio, revistas: [], error: fallo(e).error };
  }
}

/**
 * Paso 1: revisa el nombre y deja lista la carpeta.
 * Devuelve la versión con la que se nombran las imágenes (así una revista reemplazada no queda en caché).
 */
export async function prepararRevista(slug: string, titulo: string, paginas: number): Promise<Res<{ version: string; existe: boolean }>> {
  await requirePermiso("revistas");
  if (!cpanelConfigurado()) return { ok: false, error: "Falta conectar el cPanel (variables CPANEL_URL, CPANEL_USUARIO y CPANEL_TOKEN en Vercel)" };
  const e = validarSlug(slug) ?? validarTitulo(titulo);
  if (e) return { ok: false, error: e };
  if (!Number.isInteger(paginas) || paginas < 1 || paginas > MAX_PAGINAS) return { ok: false, error: `La revista debe tener entre 1 y ${MAX_PAGINAS} páginas` };
  try {
    await crearCarpeta("public_html", "revistas");
    // El nombre no puede chocar con otra carpeta o archivo que ya exista en public_html/revistas
    const raiz = await listar(CARPETA_REVISTAS);
    const nombres = new Set(raiz.map((f) => f.file.toLowerCase().replace(/\.(html?|php)$/, "")));
    const ind = await leerIndice();
    const existe = ind.revistas.some((r) => r.slug === slug);
    if (!existe && nombres.has(slug)) {
      // Si es una carpeta que quedó a medias (una subida que falló: solo imágenes p01-xxx.jpg, sin página),
      // se reutiliza. Si tiene cualquier otra cosa, no es de la intranet y no se toca.
      const dentro = raiz.some((f) => f.file === slug && f.type === "dir") ? await listar(carpetaRevista(slug)) : null;
      const esPagina = (f: { file: string }) => /^p\d+-[a-z0-9]+\.jpg$/.test(f.file);
      const aMedias = dentro !== null && dentro.some(esPagina) && dentro.every((f) => esPagina(f) || f.file === ".htaccess");
      if (!aMedias) return { ok: false, error: `En la carpeta revistas ya existe "${slug}". Elige otro nombre` };
    }
    if (!raiz.some((f) => f.file === ".htaccess")) await guardarTexto(CARPETA_REVISTAS, ".htaccess", HTACCESS_CARPETA);
    await crearCarpeta(CARPETA_REVISTAS, slug);
    return { ok: true, version: Date.now().toString(36), existe };
  } catch (err) {
    return fallo(err);
  }
}

/** Paso 2: sube una página (imagen JPG ya convertida en el navegador) */
export async function subirPaginaRevista(fd: FormData): Promise<Res> {
  await requirePermiso("revistas");
  const slug = String(fd.get("slug") ?? "");
  const version = String(fd.get("version") ?? "");
  const n = Number(fd.get("n"));
  const img = fd.get("imagen");
  if (validarSlug(slug) || !/^[a-z0-9]{4,16}$/.test(version) || !(n >= 1 && n <= MAX_PAGINAS)) return { ok: false, error: "Datos de página inválidos" };
  if (!(img instanceof Blob) || img.type !== "image/jpeg") return { ok: false, error: "La página debe ser una imagen JPG" };
  if (img.size > 3.5 * 1024 * 1024) return { ok: false, error: `La página ${n} quedó muy pesada` };
  try {
    await subirArchivo(carpetaRevista(slug), archivoPagina(n, version), img);
    return { ok: true };
  } catch (e) {
    return fallo(e);
  }
}

/** Paso 3: escribe la página de la revista, el visor y la lista; borra las imágenes de la versión anterior */
export async function publicarRevista(datos: {
  slug: string; titulo: string; paginas: number; ancho: number; alto: number; version: string;
}): Promise<Res<{ url: string }>> {
  await requirePermiso("revistas");
  const { slug, version } = datos ?? {};
  const entero = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  if (typeof slug !== "string" || validarSlug(slug) || typeof version !== "string" || !/^[a-z0-9]{4,16}$/.test(version)
      || !entero(datos.paginas, 1, MAX_PAGINAS) || !entero(datos.ancho, 1, 10_000) || !entero(datos.alto, 1, 10_000)) {
    return { ok: false, error: "Datos inválidos" };
  }
  const eTit = validarTitulo(datos.titulo);
  if (eTit) return { ok: false, error: eTit };
  const sitio = sitioPublico();
  try {
    // Todas las páginas deben haber llegado antes de publicar
    const carpeta = carpetaRevista(slug);
    const hay = new Set((await listar(carpeta)).map((f) => f.file));
    const faltan = Array.from({ length: datos.paginas }, (_, i) => archivoPagina(i + 1, version)).filter((f) => !hay.has(f));
    if (faltan.length) return { ok: false, error: `No llegaron ${faltan.length} página(s) al cPanel. Vuelve a intentar` };

    const ind = await leerIndice();
    const ahora = new Date().toISOString();
    const previa = ind.revistas.find((r) => r.slug === slug);
    const r: Revista = {
      slug, titulo: datos.titulo.trim().slice(0, 120), paginas: datos.paginas,
      ancho: Math.round(datos.ancho) || 1000, alto: Math.round(datos.alto) || 1414,
      version, activo: true, creado: previa?.creado ?? ahora, actualizado: ahora,
    };
    await guardarTexto(carpeta, ".htaccess", HTACCESS_REVISTA);
    await guardarTexto(carpeta, "index.html", htmlRevista(r, sitio));
    ind.revistas = [r, ...ind.revistas.filter((x) => x.slug !== slug)];
    await guardarIndice(ind);

    // Imágenes de versiones anteriores de esta revista
    const viejas = [...hay].filter((f) => /^p\d+-[a-z0-9]+\.jpg$/.test(f) && !f.endsWith(`-${version}.jpg`));
    await borrar(viejas.map((f) => `${carpeta}/${f}`)).catch(() => {});
    revalidatePath("/revistas");
    return { ok: true, url: `${sitio}${rutaRevista(slug)}/` };
  } catch (e) {
    return fallo(e);
  }
}

/** Cambia solo el título (la ruta no se cambia: si está mal, se elimina y se publica de nuevo) */
export async function editarTituloRevista(slug: string, titulo: string): Promise<Res> {
  await requirePermiso("revistas");
  const e = (typeof slug === "string" ? validarSlug(slug) : "Nombre inválido") ?? validarTitulo(titulo);
  if (e) return { ok: false, error: e };
  const t = titulo.trim();
  try {
    const ind = await leerIndice();
    const r = ind.revistas.find((x) => x.slug === slug);
    if (!r) return { ok: false, error: "Revista no encontrada" };
    r.titulo = t;
    r.actualizado = new Date().toISOString();
    const sitio = sitioPublico();
    // Se rehace la página para que el título nuevo salga en la pestaña y en la vista previa de WhatsApp
    await guardarTexto(carpetaRevista(slug), "index.html", r.activo ? htmlRevista(r, sitio) : htmlNoDisponible(r.titulo, sitio));
    await guardarIndice(ind);
    revalidatePath("/revistas");
    return { ok: true };
  } catch (e) {
    return fallo(e);
  }
}

/** Ocultar (muestra "ya no está disponible") o volver a mostrar */
export async function cambiarVisibilidadRevista(slug: string, activo: boolean): Promise<Res> {
  await requirePermiso("revistas");
  if (typeof slug !== "string" || validarSlug(slug)) return { ok: false, error: "Nombre inválido" };
  try {
    const ind = await leerIndice();
    const r = ind.revistas.find((x) => x.slug === slug);
    if (!r) return { ok: false, error: "Revista no encontrada" };
    const sitio = sitioPublico();
    await guardarTexto(carpetaRevista(slug), "index.html", activo ? htmlRevista(r, sitio) : htmlNoDisponible(r.titulo, sitio));
    r.activo = activo;
    r.actualizado = new Date().toISOString();
    await guardarIndice(ind);
    revalidatePath("/revistas");
    return { ok: true };
  } catch (e) {
    return fallo(e);
  }
}

/** Borra la revista y sus imágenes del cPanel */
export async function eliminarRevista(slug: string): Promise<Res> {
  await requirePermiso("revistas");
  if (validarSlug(slug)) return { ok: false, error: "Nombre inválido" };
  try {
    const ind = await leerIndice();
    if (!ind.revistas.some((x) => x.slug === slug)) return { ok: false, error: "Revista no encontrada" };
    // Solo se borran carpetas que creó la intranet (están en su lista)
    await borrar([carpetaRevista(slug)]);
    ind.revistas = ind.revistas.filter((x) => x.slug !== slug);
    await guardarIndice(ind);
    revalidatePath("/revistas");
    return { ok: true };
  } catch (e) {
    return fallo(e);
  }
}
