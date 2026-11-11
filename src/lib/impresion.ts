/**
 * Impresión del logo por ítem (11/11/2026).
 * El vendedor escribe cuántos colores o impresiones lleva el logo en cada producto (0, 1, 2...).
 * Impresiones totales = cantidad del ítem × colores (2,000 und × 1 color = 2,000 impresiones).
 * Cada impresión cuesta lo que diga la empresa (por defecto S/ 0.50) y ese costo se suma
 * al costo del producto ANTES del factor: precio = (costo + colores × 0.50) ÷ factor.
 * Se usa en el navegador y en el servidor: solo funciones puras.
 */
export const COSTO_IMPRESION_DEFECTO = 0.5;
export const MAX_COLORES = 20;

/** Impresiones totales del ítem: 2,000 und × 1 color → 2,000 */
export function totalImpresiones(cantidad: number | null | undefined, colores: number | null | undefined) {
  return Math.max(0, Number(cantidad) || 0) * Math.max(0, Number(colores) || 0);
}

/**
 * Costo de impresión de cada producto, en la moneda de la cotización.
 * costoImpresion está en soles; en dólares se divide entre el tipo de cambio.
 */
export function impresionPorUnidad(colores: number | null | undefined, costoImpresion: number, moneda: string, tipoCambio: number) {
  const c = Math.max(0, Number(colores) || 0);
  if (!c || !(costoImpresion > 0)) return 0;
  let v = c * costoImpresion;
  if (moneda === "USD") v = tipoCambio > 0 ? v / tipoCambio : 0;
  return Math.round(v * 10000) / 10000;
}

/**
 * Texto para la cotización. Neutro porque el número puede ser colores o logos
 * ("logo a un color" = 1, "3 logos a un color" = 3, "logo y frase" = 2):
 * "Incluye 1 impresión de logo por unidad (2,000 impresiones)"
 */
export function textoImpresion(cantidad: number | null | undefined, colores: number | null | undefined) {
  const c = Number(colores) || 0;
  if (!c) return "";
  const total = totalImpresiones(cantidad, c).toLocaleString("es-PE", { maximumFractionDigits: 0 });
  return `Incluye ${c} ${c === 1 ? "impresión" : "impresiones"} de logo por unidad (${total} impresiones)`;
}
