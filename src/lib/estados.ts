export type EstadoCotizacion =
  | "borrador"
  | "por_aprobar"
  | "emitida"
  | "entregada"
  | "aceptada"
  | "rechazada"
  | "vencida"
  | "anulada"
  | "reemplazada";

export const ESTADOS: Record<EstadoCotizacion, { label: string; tono: string }> = {
  borrador: { label: "Borrador", tono: "muted" },
  por_aprobar: { label: "Por aprobar", tono: "warn" },
  emitida: { label: "Emitida", tono: "brand" },
  entregada: { label: "Entregada", tono: "info" },
  aceptada: { label: "Aceptada", tono: "ok" },
  rechazada: { label: "Rechazada", tono: "danger" },
  vencida: { label: "Vencida", tono: "muted" },
  anulada: { label: "Anulada", tono: "danger" },
  reemplazada: { label: "Reemplazada", tono: "muted" },
};

/** Debe coincidir con cotizacion_estado_guard() en la base de datos */
export const TRANSICIONES: Record<EstadoCotizacion, EstadoCotizacion[]> = {
  borrador: ["emitida", "anulada"],
  por_aprobar: ["emitida", "borrador", "anulada"],
  emitida: ["entregada", "aceptada", "rechazada", "vencida", "anulada", "borrador"],
  entregada: ["aceptada", "rechazada", "vencida", "anulada"],
  aceptada: ["anulada"],
  rechazada: [],
  vencida: [],
  anulada: [],
  reemplazada: [],
};

export const EDITABLE: EstadoCotizacion[] = ["borrador", "emitida"];
export const VERSIONABLE: EstadoCotizacion[] = ["emitida", "entregada", "rechazada", "vencida"];
