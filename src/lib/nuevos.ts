/**
 * Artículos nuevos (18/11/2026): los que llegan al subir un Excel y nadie revisó todavía.
 * Llevan la etiqueta "Nuevo" durante 15 días desde que se crearon. Los que ya existían nunca la llevan
 * (revisado_at marcado: los de antes de esta función, la carga inicial y los creados a mano).
 * Se usa en el navegador y en el servidor: solo funciones puras.
 */
export const DIAS_NUEVO = 15;

/** Fecha desde la que un artículo creado sigue siendo nuevo (ISO) */
export function desdeNuevo(ahora = Date.now()) {
  return new Date(ahora - DIAS_NUEVO * 86_400_000).toISOString();
}

export function esNuevo(createdAt: unknown, revisadoAt: unknown, ahora = Date.now()) {
  if (revisadoAt || !createdAt) return false;
  const t = new Date(String(createdAt)).getTime();
  return Number.isFinite(t) && t >= ahora - DIAS_NUEVO * 86_400_000;
}
