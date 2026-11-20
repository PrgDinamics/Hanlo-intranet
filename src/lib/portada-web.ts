/**
 * Portada de hanloinnova.com (20/11/2026): las 5 imágenes que flotan sobre el círculo amarillo
 * y la etiqueta de abajo (hoy "Eco / Línea nature"). El título y el párrafo de la izquierda no cambian.
 * Se guarda en el cPanel:
 *   public_html/datos/portada/<n>-<version>.jpg   imagen subida para el casillero n (1 a 5)
 *   public_html/datos/portada.json                lo que lee la web (y portada.bak.json, copia del anterior)
 * Sin portada.json la web usa sus imágenes y su etiqueta de siempre.
 * Se usa en el navegador y en el servidor: solo datos y funciones puras.
 */
export const CARPETA_DATOS = "public_html/datos";
export const CARPETA_PORTADA = "public_html/datos/portada";
export const INDICE_PORTADA = "portada.json";
export const RESPALDO_PORTADA = "portada.bak.json";
export const LADO_IMAGEN = 800;
export const MAX_ETIQUETA_TITULO = 12;
export const MAX_ETIQUETA_TEXTO = 40;

/** Posición de cada casillero en la portada (en el orden del JSON) */
export const CASILLEROS = [
  "Arriba a la izquierda",
  "Arriba a la derecha",
  "Al centro (la más grande, delante)",
  "Abajo a la izquierda",
  "Abajo a la derecha",
] as const;

/** Categorías del catálogo de la web, para el enlace de la etiqueta */
export const CATEGORIAS_WEB = [
  { slug: "tecnologia", nombre: "Tecnología" },
  { slug: "drinkware", nombre: "Tomatodos y mugs" },
  { slug: "oficina", nombre: "Oficina y escritura" },
  { slug: "ecologicos", nombre: "Ecológicos" },
  { slug: "mochilas", nombre: "Mochilas y bolsos" },
  { slug: "hogar", nombre: "Hogar" },
  { slug: "otros", nombre: "Otros" },
] as const;

export type PortadaWeb = {
  actualizado: string;
  imagenes: { foto: string | null; codigo?: string | null }[];
  etiqueta: { titulo: string; texto: string; enlace: string | null } | null;
};

export const archivoPortada = (n: number, version: string) => `${n}-${version}.jpg`;
export const rutaPortada = (n: number, version: string) => `/datos/portada/${archivoPortada(n, version)}`;
