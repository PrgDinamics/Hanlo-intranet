/**
 * Conexión con el cPanel de hanloinnova.com (solo servidor).
 * Se usa para guardar las revistas virtuales en public_html/revistas.
 *
 * Variables de entorno (en Vercel > Settings > Environment Variables):
 *   CPANEL_URL      https://hanloinnova.com:2083   (la dirección con la que entras al cPanel)
 *   CPANEL_USUARIO  usuario del cPanel
 *   CPANEL_TOKEN    token creado en cPanel > Seguridad > Manage API Tokens
 *   REVISTAS_SITIO  https://hanloinnova.com        (opcional, la web pública)
 */

import "server-only";

const cfg = () => ({
  url: (process.env.CPANEL_URL ?? "").replace(/\/+$/, ""),
  usuario: process.env.CPANEL_USUARIO ?? "",
  token: process.env.CPANEL_TOKEN ?? "",
});

export const sitioPublico = () => (process.env.REVISTAS_SITIO || "https://hanloinnova.com").replace(/\/+$/, "");
export const cpanelConfigurado = () => { const c = cfg(); return !!(c.url && c.usuario && c.token); };

export class ErrorCpanel extends Error {}

function cabecera() {
  const c = cfg();
  return { Authorization: `cpanel ${c.usuario}:${c.token}` };
}

async function pedir(url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...cabecera(), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new ErrorCpanel(`No se pudo conectar con el cPanel (${m}). Revisa CPANEL_URL.`);
  }
  if (res.status === 401 || res.status === 403) throw new ErrorCpanel("El cPanel rechazó el acceso: revisa CPANEL_USUARIO y CPANEL_TOKEN.");
  const texto = await res.text();
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorCpanel(`Respuesta inesperada del cPanel (HTTP ${res.status}). Revisa CPANEL_URL.`);
  }
}

/** UAPI: /execute/Modulo/funcion */
async function uapi(modulo: string, funcion: string, cuerpo: FormData | URLSearchParams) {
  const j = await pedir(`${cfg().url}/execute/${modulo}/${funcion}`, { method: "POST", body: cuerpo });
  if (!j?.status) throw new ErrorCpanel((j?.errors ?? []).join(" ") || `Falló ${modulo}::${funcion}`);
  return j.data;
}

/** API 2 (para crear carpetas y borrar, que la UAPI no trae) */
async function api2(modulo: string, funcion: string, params: Record<string, string>) {
  const q = new URLSearchParams({
    cpanel_jsonapi_user: cfg().usuario, cpanel_jsonapi_apiversion: "2",
    cpanel_jsonapi_module: modulo, cpanel_jsonapi_func: funcion, ...params,
  });
  const j = await pedir(`${cfg().url}/json-api/cpanel?${q}`, { method: "GET" });
  const r = j?.cpanelresult;
  if (!r) throw new ErrorCpanel(`Falló ${modulo}::${funcion}`);
  if (r.error) throw new ErrorCpanel(String(r.error));
  const d = Array.isArray(r.data) ? r.data[0] : r.data;
  if (d && d.result === 0) throw new ErrorCpanel(String(d.reason ?? d.err ?? `Falló ${modulo}::${funcion}`));
  return r.data;
}

/** Archivos y carpetas de una carpeta: [{ file, type }] ("dir" o "file") */
export async function listar(dir: string): Promise<{ file: string; type: string }[]> {
  try {
    return (await uapi("Fileman", "list_files", new URLSearchParams({ dir, include_mime: "0", show_hidden: "1" }))) ?? [];
  } catch (e) {
    if (e instanceof ErrorCpanel && /no such file|does not exist|not exist|no existe/i.test(e.message)) return [];
    throw e;
  }
}

/**
 * Contenido de un archivo de texto, o null si no existe.
 * Primero se confirma en el listado que el archivo exista: así un error pasajero del cPanel
 * nunca se confunde con "no existe" (y la lista de revistas no se reescribe vacía).
 */
export async function leer(dir: string, archivo: string): Promise<string | null> {
  const hay = await listarSiExiste(dir);
  if (!hay || !hay.some((f) => f.file === archivo && f.type !== "dir")) return null;
  const d = await uapi("Fileman", "get_file_content", new URLSearchParams({ dir, file: archivo, from_charset: "UTF-8", to_charset: "UTF-8" }));
  return typeof d?.content === "string" ? d.content : "";
}

/** Lista una carpeta solo si existe (se revisa desde public_html hacia adentro); null si no existe */
export async function listarSiExiste(dir: string) {
  const partes = dir.split("/").filter(Boolean);
  for (let i = 1; i < partes.length; i++) {
    const padre = await listar(partes.slice(0, i).join("/"));
    if (!padre.some((f) => f.file === partes[i] && f.type === "dir")) return null;
  }
  return listar(dir);
}

export async function guardarTexto(dir: string, archivo: string, contenido: string) {
  await uapi("Fileman", "save_file_content", new URLSearchParams({ dir, file: archivo, content: contenido, from_charset: "UTF-8", to_charset: "UTF-8" }));
}

export async function subirArchivo(dir: string, nombre: string, datos: Blob) {
  const fd = new FormData();
  fd.append("dir", dir);
  fd.append("overwrite", "1");
  fd.append("file-1", datos, nombre);
  const d = await uapi("Fileman", "upload_files", fd);
  if (d && d.failed > 0) {
    const motivo = (d.uploads ?? []).map((u: { reason?: string }) => u.reason).filter(Boolean).join(" ");
    throw new ErrorCpanel(motivo || "El cPanel no aceptó la imagen");
  }
}

/** Carpeta del usuario en el servidor (ej. /home/hanlo): la API 2 trabaja mejor con rutas completas */
let home: string | null = null;
async function carpetaUsuario() {
  if (home) return home;
  try {
    const d = await uapi("Variables", "get_user_information", new URLSearchParams({ name: "home" }));
    home = String(d?.home ?? "").replace(/\/+$/, "") || null;
  } catch {
    home = null;
  }
  return home ?? `/home/${cfg().usuario}`;
}
const completa = async (ruta: string) => (ruta.startsWith("/") ? ruta : `${await carpetaUsuario()}/${ruta}`);

/** Crea la carpeta si no existe (dentro de "padre") */
export async function crearCarpeta(padre: string, nombre: string) {
  const hay = await listar(padre);
  if (hay.some((f) => f.file === nombre && f.type === "dir")) return;
  await api2("Fileman", "mkdir", { path: await completa(padre), name: nombre, permissions: "0755" });
}

/** Borra archivos o carpetas completas (rutas relativas a la carpeta del usuario) */
export async function borrar(rutas: string[]) {
  if (!rutas.length) return;
  // De a pocos para no armar URLs demasiado largas
  const todas = await Promise.all(rutas.map(completa));
  for (let i = 0; i < todas.length; i += 40) {
    await api2("Fileman", "fileop", { op: "unlink", sourcefiles: todas.slice(i, i + 40).join(","), doubledecode: "0" });
  }
}
