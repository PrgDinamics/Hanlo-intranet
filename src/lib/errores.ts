type PgError = { code?: string; message?: string; details?: string } | null;

/** Traduce errores de Postgres/PostgREST a mensajes entendibles */
export function mensajeError(error: PgError): string {
  if (!error) return "Error desconocido";
  switch (error.code) {
    case "23505": {
      const campo = /\((.+?)\)=/.exec(error.details ?? "")?.[1];
      return `Ya existe un registro con ese ${campo ? campo.replace(/_/g, " ") : "valor"}`;
    }
    case "23503":
      return "No se puede eliminar porque está siendo usado en otros registros. Puedes desactivarlo.";
    case "23514":
      return "Algún dato no tiene el formato válido (revisa RUC de 11 dígitos, DNI de 8, montos positivos)";
    case "23502":
      return "Falta completar un campo obligatorio";
    case "42501":
      return "No tienes permisos para esta operación";
    case "P0001":
      return error.message ?? "Operación no permitida";
    case "22003":
      return "Algún monto o cantidad es demasiado grande";
    case "22P02":
      return "Algún valor no tiene el formato correcto";
    default:
      return error.message ?? "Error inesperado";
  }
}
