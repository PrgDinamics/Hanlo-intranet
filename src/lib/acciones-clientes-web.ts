"use server";

import { revalidatePath } from "next/cache";
import { requirePermiso } from "@/lib/sesion";
import { borrar, cpanelConfigurado, crearCarpeta, ErrorCpanel, guardarTexto, leer, listar, sitioPublico, subirArchivo } from "@/lib/cpanel";
import { slugDe } from "@/lib/revistas";
import {
  archivoLogo, CARPETA_DATOS, CARPETA_LOGOS, INDICE_CLIENTES, LOGOS_INICIALES, MAX_CLIENTES, RESPALDO_CLIENTES, rutaLogo, validarNombre,
  type ClienteWeb, type IndiceClientesWeb,
} from "@/lib/clientes-web";

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

/** La lista. Si existe pero no se puede leer, se detiene todo: nunca se reescribe vacía */
async function leerIndice(): Promise<IndiceClientesWeb> {
  const txt = await leer(CARPETA_DATOS, INDICE_CLIENTES);
  if (txt === null || !txt.trim()) return { actualizado: new Date().toISOString(), clientes: [] };
  let j: unknown;
  try { j = JSON.parse(txt); } catch {
    throw new ErrorCpanel(`La lista ${CARPETA_DATOS}/${INDICE_CLIENTES} está dañada. Restáurala desde ${RESPALDO_CLIENTES} en el cPanel antes de seguir.`);
  }
  const lista = (j as IndiceClientesWeb)?.clientes;
  if (!Array.isArray(lista)) throw new ErrorCpanel(`La lista ${CARPETA_DATOS}/${INDICE_CLIENTES} no tiene el formato esperado.`);
  return { actualizado: (j as IndiceClientesWeb).actualizado, clientes: lista };
}

/** Guarda la lista ordenada (orden 1, 2, 3...) dejando antes una copia de la anterior */
async function guardarIndice(clientes: ClienteWeb[], revalidar = true) {
  const ordenados = [...clientes].sort((a, b) => a.orden - b.orden).map((c, i) => ({ ...c, orden: i + 1 }));
  const previo = await leer(CARPETA_DATOS, INDICE_CLIENTES);
  if (previo && previo.trim()) await guardarTexto(CARPETA_DATOS, RESPALDO_CLIENTES, previo);
  await guardarTexto(CARPETA_DATOS, INDICE_CLIENTES, JSON.stringify({ actualizado: new Date().toISOString(), clientes: ordenados }, null, 2));
  if (revalidar) revalidatePath("/clientes-web");
}

async function asegurarCarpetas() {
  await crearCarpeta("public_html", "datos");
  const hay = await listar(CARPETA_DATOS);
  if (!hay.some((f) => f.file === ".htaccess")) await guardarTexto(CARPETA_DATOS, ".htaccess", HTACCESS);
  if (!hay.some((f) => f.file === "clientes" && f.type === "dir")) await crearCarpeta(CARPETA_DATOS, "clientes");
}

/** El logo ya viene preparado del navegador: PNG recortado de 120 px de alto */
const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const esPng = (b: Uint8Array) => FIRMA_PNG.every((x, k) => b[k] === x);

async function revisarLogo(img: FormDataEntryValue | null): Promise<string | null> {
  if (!(img instanceof Blob)) return "El logo debe llegar como imagen PNG";
  if (img.size > 600 * 1024) return "El logo quedó muy pesado. Prueba con una imagen más simple";
  if (!esPng(new Uint8Array(await img.slice(0, 8).arrayBuffer()))) return "El logo debe llegar como imagen PNG";
  return null;
}

export async function listarClientesWeb(): Promise<
  { configurado: false; sitio: string } | { configurado: true; sitio: string; clientes: ClienteWeb[]; error?: string }
> {
  await requirePermiso("revistas");
  const sitio = sitioPublico();
  if (!cpanelConfigurado()) return { configurado: false, sitio };
  try {
    // La primera vez (todavía no existe clientes.json) se copian solos los logos que la web traía fijos
    if ((await leer(CARPETA_DATOS, INDICE_CLIENTES)) === null) await cargaInicial(sitio);
    return { configurado: true, sitio, clientes: (await leerIndice()).clientes.sort((a, b) => a.orden - b.orden) };
  } catch (e) {
    return { configurado: true, sitio, clientes: [], error: fallo(e).error };
  }
}

/** Agrega un cliente (nombre + logo); queda al final de la cinta */
export async function agregarClienteWeb(fd: FormData): Promise<Res> {
  await requirePermiso("revistas");
  if (!cpanelConfigurado()) return { ok: false, error: SIN_CPANEL };
  const nombre = String(fd.get("nombre") ?? "").trim();
  const e = validarNombre(nombre) ?? (await revisarLogo(fd.get("logo")));
  if (e) return { ok: false, error: e };
  try {
    await asegurarCarpetas();
    const ind = await leerIndice();
    if (ind.clientes.length >= MAX_CLIENTES) return { ok: false, error: `Se pueden mostrar hasta ${MAX_CLIENTES} clientes` };
    if (ind.clientes.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) return { ok: false, error: `"${nombre}" ya está en la lista` };
    const base = slugDe(nombre) || "cliente";
    let slug = base;
    for (let i = 2; ind.clientes.some((c) => c.slug === slug); i++) slug = `${base}-${i}`;
    const version = Date.now().toString(36);
    await subirArchivo(CARPETA_LOGOS, archivoLogo(slug, version), fd.get("logo") as Blob);
    const orden = Math.max(0, ...ind.clientes.map((c) => c.orden)) + 1;
    await guardarIndice([...ind.clientes, { slug, nombre, logo: rutaLogo(slug, version), activo: true, orden, version }]);
    return { ok: true };
  } catch (err) {
    return fallo(err);
  }
}

/** Cambia el nombre y, si viene, el logo (con otro nombre de archivo para que la web no muestre el viejo) */
export async function editarClienteWeb(fd: FormData): Promise<Res> {
  await requirePermiso("revistas");
  if (!cpanelConfigurado()) return { ok: false, error: SIN_CPANEL };
  const slug = String(fd.get("slug") ?? "");
  const nombre = String(fd.get("nombre") ?? "").trim();
  const logo = fd.get("logo");
  const e = validarNombre(nombre) ?? (logo ? await revisarLogo(logo) : null);
  if (e) return { ok: false, error: e };
  try {
    const ind = await leerIndice();
    const c = ind.clientes.find((x) => x.slug === slug);
    if (!c) return { ok: false, error: "Ese cliente ya no está en la lista" };
    if (ind.clientes.some((x) => x.slug !== slug && x.nombre.toLowerCase() === nombre.toLowerCase())) return { ok: false, error: `"${nombre}" ya está en la lista` };
    let viejo: string | null = null;
    if (logo) {
      await asegurarCarpetas();
      const version = Date.now().toString(36);
      await subirArchivo(CARPETA_LOGOS, archivoLogo(slug, version), logo as Blob);
      viejo = archivoLogo(slug, c.version);
      Object.assign(c, { version, logo: rutaLogo(slug, version) });
    }
    c.nombre = nombre;
    await guardarIndice(ind.clientes);
    if (viejo) await borrar([`${CARPETA_LOGOS}/${viejo}`]).catch(() => {});
    return { ok: true };
  } catch (err) {
    return fallo(err);
  }
}

/** Mostrar u ocultar en la web, sin borrar el logo */
export async function mostrarClienteWeb(slug: string, activo: boolean): Promise<Res> {
  await requirePermiso("revistas");
  if (!cpanelConfigurado()) return { ok: false, error: SIN_CPANEL };
  try {
    const ind = await leerIndice();
    const c = ind.clientes.find((x) => x.slug === slug);
    if (!c) return { ok: false, error: "Ese cliente ya no está en la lista" };
    c.activo = !!activo;
    await guardarIndice(ind.clientes);
    return { ok: true };
  } catch (err) {
    return fallo(err);
  }
}

/** Sube o baja un lugar en la cinta */
export async function moverClienteWeb(slug: string, direccion: -1 | 1): Promise<Res> {
  await requirePermiso("revistas");
  if (!cpanelConfigurado()) return { ok: false, error: SIN_CPANEL };
  try {
    const ind = await leerIndice();
    const lista = [...ind.clientes].sort((a, b) => a.orden - b.orden);
    const i = lista.findIndex((x) => x.slug === slug);
    const j = i + (direccion < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= lista.length) return { ok: true };
    [lista[i], lista[j]] = [lista[j], lista[i]];
    await guardarIndice(lista.map((c, k) => ({ ...c, orden: k + 1 })));
    return { ok: true };
  } catch (err) {
    return fallo(err);
  }
}

/** Quita el cliente de la lista y borra su logo del cPanel */
export async function quitarClienteWeb(slug: string): Promise<Res> {
  await requirePermiso("revistas");
  if (!cpanelConfigurado()) return { ok: false, error: SIN_CPANEL };
  try {
    const ind = await leerIndice();
    const c = ind.clientes.find((x) => x.slug === slug);
    if (!c) return { ok: true };
    await guardarIndice(ind.clientes.filter((x) => x.slug !== slug));
    await borrar([`${CARPETA_LOGOS}/${archivoLogo(c.slug, c.version)}`]).catch(() => {});
    return { ok: true };
  } catch (err) {
    return fallo(err);
  }
}

/** Copia los logos fijos de la web (hanloinnova.com/img/clientes) a la lista. Lo que no se pueda traer se omite */
async function cargaInicial(sitio: string) {
  await asegurarCarpetas();
  const version = Date.now().toString(36);
  const clientes: ClienteWeb[] = [];
  for (const l of LOGOS_INICIALES) {
    try {
      const r = await fetch(`${sitio}/img/clientes/${l.archivo}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!esPng(bytes) || bytes.length > 600 * 1024) continue;
      const slug = slugDe(l.archivo.replace(/\.png$/, ""));
      await subirArchivo(CARPETA_LOGOS, archivoLogo(slug, version), new Blob([bytes], { type: "image/png" }));
      clientes.push({ slug, nombre: l.nombre, logo: rutaLogo(slug, version), activo: true, orden: clientes.length + 1, version });
    } catch {
      // sigue con el siguiente
    }
  }
  // Se escribe aunque salga vacía: así solo se intenta una vez (se llama al dibujar la página: sin revalidar)
  await guardarIndice(clientes, false);
}

