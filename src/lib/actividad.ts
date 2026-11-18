import { MODULOS } from "@/lib/modulos";

/**
 * Registro de actividad: textos compartidos por la pantalla y su Excel.
 * Se guarda 45 días: la tarea diaria /api/keepalive borra lo más antiguo.
 * Se usa en servidor y en el navegador: solo datos y funciones puras.
 */
export const DIAS_ACTIVIDAD = 45;

export const TABLAS: Record<string, { label: string; ruta?: string }> = {
  clientes: { label: "Clientes", ruta: "/clientes" },
  articulos: { label: "Artículos", ruta: "/articulos" },
  articulo_proveedor: { label: "Precios de proveedor" },
  proveedores: { label: "Proveedores", ruta: "/proveedores" },
  lineas: { label: "Líneas" },
  empresas: { label: "Empresas" },
  agentes: { label: "Agentes" },
  perfiles: { label: "Usuarios" },
  formas_pago: { label: "Formas de pago" },
  tipos_cambio: { label: "Tipos de cambio" },
  importaciones: { label: "Importaciones" },
  roles: { label: "Roles y permisos" },
};

// Nombres legibles de los campos, tomados de los formularios
export const ETIQUETAS: Record<string, string> = {
  precio_venta: "Precio muestra", precio_ciento: "Precio x ciento", precio_millar: "Precio x millar",
  precio_compra: "Precio de compra", desde_ciento: "Ciento desde", desde_millar: "Millar desde",
  codigo_proveedor: "Código del proveedor", preferido: "Preferido", rol: "Rol", rol_id: "Rol", permisos: "Permisos",
};
for (const m of Object.values(MODULOS)) for (const c of m.campos) ETIQUETAS[c.name] ??= c.label;

export const ACCION = { crear: { label: "Creó", tono: "ok" }, editar: { label: "Editó", tono: "info" }, eliminar: { label: "Eliminó", tono: "danger" }, importar: { label: "Importó", tono: "brand" } } as const;

export function valor(v: unknown) {
  if (v === null || v === undefined || v === "") return "(vacío)";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  const t = String(v);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(t)) return "(otro registro)";
  if (/^https?:\/\//.test(t)) return "(imagen)";
  return t.length > 70 ? t.slice(0, 70) + "…" : t;
}

export const fechaHora = (iso: string) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

/** Cambios en una línea de texto (para el Excel) */
export function cambiosEnTexto(accion: string, cambios: unknown) {
  if (accion === "importar") return (((cambios as { resumen?: string[] } | null)?.resumen) ?? []).join("; ");
  const lista = Object.entries((cambios ?? {}) as Record<string, [unknown, unknown]>);
  if (!lista.length) return accion === "crear" ? "Registro nuevo" : accion === "eliminar" ? "Registro eliminado" : "";
  return lista.map(([k, [antes, despues]]) => `${ETIQUETAS[k] ?? k}: ${valor(antes)} → ${valor(despues)}`).join("; ");
}
