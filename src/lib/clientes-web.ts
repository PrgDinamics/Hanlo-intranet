/**
 * Logos de "Empresas que confían en nosotros" en la portada de hanloinnova.com (20/11/2026).
 * No tiene relación con los clientes de las cotizaciones: son logos públicos de empresas que autorizaron aparecer.
 * Se guardan en el cPanel, como las revistas:
 *   public_html/datos/clientes/<slug>-<version>.png   un archivo por logo (la versión evita la caché al reemplazarlo)
 *   public_html/datos/clientes.json                   la lista que lee la web (y clientes.bak.json, copia de la anterior)
 * Se usa en el navegador y en el servidor: solo datos y funciones puras.
 */
export const CARPETA_DATOS = "public_html/datos";
export const CARPETA_LOGOS = "public_html/datos/clientes";
export const INDICE_CLIENTES = "clientes.json";
export const RESPALDO_CLIENTES = "clientes.bak.json";
/** Alto con el que se guarda cada logo (la web los muestra a 52 px como máximo) */
export const ALTO_LOGO = 120;
export const MAX_BYTES_ORIGINAL = 1024 * 1024;
export const MAX_CLIENTES = 60;

export type ClienteWeb = {
  /** Identificador interno: no cambia aunque se renombre */
  slug: string;
  nombre: string;
  /** Ruta pública del logo, ej. /datos/clientes/bago-k3f9a.png */
  logo: string;
  activo: boolean;
  orden: number;
  version: string;
};
export type IndiceClientesWeb = { actualizado: string; clientes: ClienteWeb[] };

export const archivoLogo = (slug: string, version: string) => `${slug}-${version}.png`;
export const rutaLogo = (slug: string, version: string) => `/datos/clientes/${archivoLogo(slug, version)}`;

export function validarNombre(nombre: unknown): string | null {
  if (typeof nombre !== "string" || !nombre.trim()) return "Escribe el nombre de la empresa";
  if (nombre.trim().length > 80) return "El nombre puede tener hasta 80 letras";
  return null;
}

/**
 * Los 12 logos que la web traía fijos (hanlo-web/public/img/clientes). La primera vez que se abre
 * Clientes en la web (si todavía no existe clientes.json) se copian solos, para no perderlos.
 */
export const LOGOS_INICIALES: { nombre: string; archivo: string }[] = [
  { nombre: "Compañía Minera Lincuna", archivo: "lincuna.png" },
  { nombre: "Bagó", archivo: "bago.png" },
  { nombre: "Megalabs", archivo: "megalabs.png" },
  { nombre: "Precision", archivo: "precision.png" },
  { nombre: "Lexus", archivo: "lexus.png" },
  { nombre: "Prima AFP", archivo: "prima-afp.png" },
  { nombre: "Perumotor", archivo: "perumotor.png" },
  { nombre: "Sandvik", archivo: "sandvik.png" },
  { nombre: "Hudbay", archivo: "hudbay.png" },
  { nombre: "Minera Aurífera Retamas (MARSA)", archivo: "marsa.png" },
  { nombre: "Kia", archivo: "kia.png" },
  { nombre: "Pacífico Seguros", archivo: "pacifico.png" },
];

