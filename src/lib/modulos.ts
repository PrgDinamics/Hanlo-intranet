/**
 * Configuración declarativa de los maestros.
 * Un mismo motor (lista + formulario + server actions) atiende a todos.
 * Solo datos serializables: se usa tanto en el servidor como en el cliente.
 */

export type Opcion = { value: string; label: string };

export type Campo = {
  name: string;
  label: string;
  type: "text" | "email" | "number" | "textarea" | "select" | "checkbox" | "date" | "image";
  required?: boolean;
  span?: 3 | 4 | 6 | 8 | 12;
  options?: Opcion[];
  /** Opciones cargadas desde otra tabla: { tabla, label } */
  ref?: { tabla: string; label: string };
  placeholder?: string;
  hint?: string;
  default?: string | number | boolean;
  upper?: boolean;
  step?: string;
  /** Sugerencias para un campo de texto libre (datalist) */
  sugerencias?: string[];
};

export type Columna = {
  name: string; // admite rutas "linea.nombre"
  label: string;
  type?: "text" | "mono" | "money" | "number" | "bool" | "sino" | "date" | "badge" | "image";
  /** Para type badge: valor → tono */
  tonos?: Record<string, string>;
  labels?: Record<string, string>;
  monedaCol?: string;
  /** Decimales fijos para type number (ej. 3 en tipos de cambio) */
  decimales?: number;
};

export type Modulo = {
  key: string;
  tabla: string;
  titulo: string;
  singular: string;
  descripcion: string;
  ruta: string;
  select: string;
  campos: Campo[];
  columnas: Columna[];
  busqueda: string[];
  orden: { col: string; asc: boolean };
  filtros?: { name: string; label: string; options: Opcion[] }[];
  admin?: boolean;
  /** Permiso de rol que habilita este módulo de configuración (si no, solo el Administrador) */
  permisoRol?: "empresas" | "formas_pago" | "tipos_cambio";
  detalle?: boolean;
  /** Permiso del agente necesario para crear o editar */
  permiso?: "crea_cliente" | "crea_articulo";
  /** Autocompletar desde SUNAT/RENIEC: campo del documento, campo del tipo (si aplica) y destino de los datos */
  consulta?: { doc: string; tipo?: string; nombre: string; direccion: string };
};

const ACTIVO: Campo = { name: "activo", label: "Activo", type: "checkbox", default: true, span: 12 };
const FILTRO_ACTIVO = {
  name: "activo",
  label: "Todos los estados",
  options: [
    { value: "true", label: "Activos" },
    { value: "false", label: "Inactivos" },
  ],
};
const MONEDAS: Opcion[] = [
  { value: "PEN", label: "Soles (S/)" },
  { value: "USD", label: "Dólares (US$)" },
];
/** Unidades sugeridas: el campo es libre (el cliente usa "Juego", "Unidad", etc.) */
export const UNIDADES = [
  "Unidad", "Juego", "Caja", "Paquete", "Docena", "Ciento", "Millar", "Par", "Set", "Kit",
  "Kilo", "Litro", "Galón", "Metro", "Metro²", "Rollo", "Pliego", "Servicio",
];

export const MODULOS: Record<string, Modulo> = {
  clientes: {
    key: "clientes",
    tabla: "clientes",
    titulo: "Clientes",
    singular: "cliente",
    descripcion: "Empresas (con RUC) a las que se cotiza: regulares y potenciales",
    ruta: "/clientes",
    permiso: "crea_cliente",
    select: "*, agente:agentes(nombre)",
    // Solo se cotiza a empresas: el documento siempre es RUC
    consulta: { doc: "num_doc", nombre: "nombre", direccion: "direccion" },
    detalle: true,
    busqueda: ["nombre", "num_doc", "contacto_nombre", "email"],
    orden: { col: "nombre", asc: true },
    filtros: [
      {
        name: "categoria",
        label: "Todas las categorías",
        options: [
          { value: "regular", label: "Regular" },
          { value: "potencial", label: "Potencial" },
          { value: "inactivo", label: "Inactivo" },
        ],
      },
    ],
    campos: [
      { name: "num_doc", label: "RUC", type: "text", required: true, span: 6, placeholder: "11 dígitos" },
      { name: "nombre", label: "Razón social", type: "text", required: true, span: 6 },
      { name: "direccion", label: "Dirección", type: "text", span: 12 },
      { name: "telefono", label: "Teléfono", type: "text", span: 6 },
      { name: "email", label: "Correo", type: "email", span: 6 },
      { name: "contacto_nombre", label: "Contacto: nombres y apellidos", type: "text", span: 8 },
      { name: "contacto_doc", label: "Contacto: N° doc. ID", type: "text", span: 4 },
      { name: "contacto_cargo", label: "Contacto: cargo", type: "text", span: 4 },
      { name: "contacto_telefono", label: "Contacto: teléfono", type: "text", span: 4 },
      { name: "contacto_email", label: "Contacto: correo", type: "email", span: 4 },
      {
        name: "categoria", label: "Categoría", type: "select", required: true, span: 6, default: "potencial",
        options: [
          { value: "regular", label: "Regular" }, { value: "potencial", label: "Potencial" },
          { value: "inactivo", label: "Inactivo" },
        ],
      },
      { name: "agente_id", label: "Agente asignado", type: "select", span: 6, ref: { tabla: "agentes", label: "nombre" } },
      { name: "notas", label: "Notas", type: "textarea", span: 12 },
      ACTIVO,
    ],
    columnas: [
      { name: "num_doc", label: "RUC", type: "mono" },
      { name: "nombre", label: "Cliente" },
      { name: "contacto_nombre", label: "Contacto" },
      { name: "telefono", label: "Teléfono" },
      {
        name: "categoria", label: "Categoría", type: "badge",
        tonos: { regular: "ok", potencial: "brand", inactivo: "muted" },
        labels: { regular: "Regular", potencial: "Potencial", inactivo: "Inactivo" },
      },
      { name: "agente.nombre", label: "Agente" },
    ],
  },

  proveedores: {
    key: "proveedores",
    tabla: "proveedores",
    titulo: "Proveedores",
    singular: "proveedor",
    descripcion: "Empresas que nos proveen los artículos que comercializamos",
    ruta: "/proveedores",
    permiso: "crea_articulo",
    select: "*",
    consulta: { doc: "ruc", nombre: "razon_social", direccion: "direccion" },
    detalle: true,
    busqueda: ["razon_social", "ruc", "contacto_nombre"],
    orden: { col: "razon_social", asc: true },
    filtros: [FILTRO_ACTIVO],
    campos: [
      { name: "ruc", label: "RUC", type: "text", required: true, span: 6, placeholder: "11 dígitos" },
      { name: "razon_social", label: "Razón social", type: "text", required: true, span: 6 },
      { name: "direccion", label: "Dirección", type: "text", span: 12 },
      { name: "telefono", label: "Teléfono", type: "text", span: 6 },
      { name: "email", label: "Correo", type: "email", span: 6 },
      { name: "contacto_nombre", label: "Contacto: nombres y apellidos", type: "text", span: 8 },
      { name: "contacto_doc", label: "Contacto: N° doc. ID", type: "text", span: 4 },
      { name: "contacto_cargo", label: "Contacto: cargo", type: "text", span: 4 },
      { name: "contacto_telefono", label: "Contacto: teléfono", type: "text", span: 4 },
      { name: "contacto_email", label: "Contacto: correo", type: "email", span: 4 },
      { name: "linea_credito", label: "Línea de crédito disponible", type: "number", span: 6, step: "0.01", default: 0 },
      { name: "moneda_credito", label: "Moneda de la línea", type: "select", span: 6, options: MONEDAS, default: "PEN" },
      { name: "notas", label: "Notas", type: "textarea", span: 12 },
      ACTIVO,
    ],
    columnas: [
      { name: "ruc", label: "RUC", type: "mono" },
      { name: "razon_social", label: "Razón social" },
      { name: "contacto_nombre", label: "Contacto" },
      { name: "telefono", label: "Teléfono" },
      { name: "linea_credito", label: "Línea de crédito", type: "money", monedaCol: "moneda_credito" },
      { name: "activo", label: "Estado", type: "bool" },
    ],
  },

  articulos: {
    key: "articulos",
    tabla: "articulos",
    titulo: "Catálogo de artículos",
    singular: "artículo",
    descripcion: "Oferta comercial de ítems que se cotizan a los clientes",
    ruta: "/articulos",
    permiso: "crea_articulo",
    select: "*, linea:lineas(nombre), precios:articulo_proveedor(precio_venta, moneda, preferido)",
    detalle: true,
    busqueda: ["descripcion", "codigo"],
    orden: { col: "descripcion", asc: true },
    filtros: [FILTRO_ACTIVO],
    campos: [
      { name: "codigo", label: "Id artículo (código)", type: "text", required: true, span: 4, upper: true },
      { name: "descripcion", label: "Descripción", type: "text", required: true, span: 8 },
      { name: "detalle", label: "Detalle / características", type: "textarea", span: 12, hint: "Se imprime debajo de la descripción en la cotización" },
      { name: "linea_id", label: "Línea", type: "select", span: 4, ref: { tabla: "lineas", label: "nombre" } },
      { name: "unidad", label: "Unidad de medida", type: "text", span: 4, sugerencias: UNIDADES, default: "Unidad", required: true },
      { name: "stock_ref", label: "Stock", type: "number", span: 4, step: "0.01", hint: "Se actualiza solo con las listas de proveedores" },
      { name: "empaque", label: "Empaque / presentación", type: "text", span: 12, placeholder: "Ej. 1000 UNID X CAJA" },
      { name: "foto_url", label: "Foto del artículo", type: "image", span: 12 },
      ACTIVO,
    ],
    columnas: [
      { name: "foto_url", label: "", type: "image" },
      { name: "codigo", label: "Código", type: "mono" },
      { name: "descripcion", label: "Descripción" },
      { name: "linea.nombre", label: "Línea" },
      { name: "unidad", label: "Und." },
      { name: "stock_ref", label: "Stock", type: "number" },
      { name: "activo", label: "Estado", type: "bool" },
    ],
  },

  lineas: {
    key: "lineas",
    tabla: "lineas",
    titulo: "Líneas de artículos",
    singular: "línea",
    descripcion: "Agrupa los artículos por afinidad de uso",
    ruta: "/lineas",
    permiso: "crea_articulo",
    select: "*",
    busqueda: ["nombre"],
    orden: { col: "nombre", asc: true },
    campos: [
      { name: "nombre", label: "Nombre", type: "text", required: true, span: 12 },
      { name: "descripcion", label: "Descripción", type: "textarea", span: 12 },
      ACTIVO,
    ],
    columnas: [
      { name: "nombre", label: "Nombre" },
      { name: "descripcion", label: "Descripción" },
      { name: "activo", label: "Estado", type: "bool" },
    ],
  },

  empresas: {
    key: "empresas",
    tabla: "empresas",
    titulo: "Empresas",
    singular: "empresa",
    descripcion: "Razones sociales que emiten cotizaciones",
    ruta: "/configuracion/empresas",
    select: "*",
    consulta: { doc: "ruc", nombre: "razon_social", direccion: "direccion" },
    admin: true,
    permisoRol: "empresas",
    busqueda: ["razon_social", "ruc"],
    orden: { col: "razon_social", asc: true },
    campos: [
      { name: "ruc", label: "RUC", type: "text", required: true, span: 6, placeholder: "11 dígitos" },
      { name: "razon_social", label: "Razón social", type: "text", required: true, span: 6 },
      { name: "nombre_comercial", label: "Nombre comercial", type: "text", span: 6 },
      { name: "web", label: "Página web", type: "text", span: 6 },
      { name: "direccion", label: "Dirección", type: "text", span: 12 },
      { name: "telefono", label: "Teléfono", type: "text", span: 6 },
      { name: "email", label: "Correo", type: "email", span: 6 },
      { name: "serie", label: "Serie de cotización", type: "text", required: true, span: 3, default: "COT", upper: true, hint: "Ej. COT → COT-000001" },
      { name: "igv_pct", label: "IGV %", type: "number", required: true, span: 3, default: 18, step: "0.01" },
      { name: "correlativo_inicial", label: "Último número usado", type: "number", span: 3, default: 0, hint: "La próxima cotización usa este número + 1" },
      {
        name: "factores", label: "Factores para cotizar", type: "text", span: 12, default: "0.60, 0.75, 0.77, 0.80",
        hint: "Separados por coma. Precio de venta = costo del proveedor ÷ factor (0.75 → costo 1.50 = venta 2.00)",
      },
      {
        name: "costo_impresion", label: "Costo por impresión de logo (S/)", type: "number", span: 6, default: 0.5, step: "0.01",
        hint: "Se suma al costo del producto antes del factor. Ej. 2,000 und a 1 color = 2,000 impresiones × S/ 0.50",
      },
      { name: "pie_cotizacion", label: "Pie de cotización", type: "textarea", span: 12, hint: "Condiciones, cuentas bancarias, etc. Se imprime al final" },
      { name: "logo_url", label: "Logo", type: "image", span: 12 },
      ACTIVO,
    ],
    columnas: [
      { name: "logo_url", label: "", type: "image" },
      { name: "ruc", label: "RUC", type: "mono" },
      { name: "razon_social", label: "Razón social" },
      { name: "serie", label: "Serie", type: "mono" },
      { name: "igv_pct", label: "IGV %", type: "number" },
      { name: "activo", label: "Estado", type: "bool" },
    ],
  },

  agentes: {
    key: "agentes",
    tabla: "agentes",
    titulo: "Agentes comerciales",
    singular: "agente",
    descripcion: "Vendedores: sus datos para la firma de la cotización y su límite de venta. Los permisos se dan en Roles y permisos. Vincula cada agente a su usuario en Usuarios",
    ruta: "/configuracion/agentes",
    select: "*",
    admin: true,
    busqueda: ["nombre", "email"],
    orden: { col: "nombre", asc: true },
    campos: [
      { name: "nombre", label: "Nombres y apellidos", type: "text", required: true, span: 8 },
      { name: "num_doc", label: "ID vendedor (DNI)", type: "text", span: 4 },
      { name: "email", label: "Correo", type: "email", span: 6 },
      { name: "telefono", label: "Teléfono", type: "text", span: 6 },
      { name: "limite_venta", label: "Límite S/ de venta", type: "number", span: 6, step: "0.01", hint: "Cotizaciones por encima pasan a aprobación. Vacío = sin límite" },
      ACTIVO,
    ],
    columnas: [
      { name: "num_doc", label: "ID", type: "mono" },
      { name: "nombre", label: "Nombres y apellidos" },
      { name: "limite_venta", label: "Límite S/ venta", type: "money" },
      { name: "activo", label: "Estado", type: "bool" },
    ],
  },

  formas_pago: {
    key: "formas_pago",
    tabla: "formas_pago",
    titulo: "Formas de pago",
    singular: "forma de pago",
    descripcion: "Condiciones de pago que se ofrecen en las cotizaciones",
    ruta: "/configuracion/formas-pago",
    select: "*",
    admin: true,
    permisoRol: "formas_pago",
    busqueda: ["nombre"],
    orden: { col: "dias_credito", asc: true },
    campos: [
      { name: "nombre", label: "Nombre", type: "text", required: true, span: 6, placeholder: "Ej. Factura a 60 días" },
      { name: "dias_credito", label: "Días de crédito", type: "number", required: true, span: 3, default: 0 },
      {
        name: "recargo_pct", label: "Recargo %", type: "number", span: 3, default: 0, step: "0.01",
        hint: "Se suma al precio de venta al elegir esta forma de pago",
      },
      ACTIVO,
    ],
    columnas: [
      { name: "nombre", label: "Nombre" },
      { name: "dias_credito", label: "Días de crédito", type: "number" },
      { name: "recargo_pct", label: "Recargo %", type: "number" },
      { name: "activo", label: "Estado", type: "bool" },
    ],
  },

  tipos_cambio: {
    key: "tipos_cambio",
    tabla: "tipos_cambio",
    titulo: "Tipos de cambio",
    singular: "tipo de cambio",
    descripcion: "Historial diario del dólar. Las cotizaciones toman el último vigente (venta)",
    ruta: "/configuracion/tipos-cambio",
    select: "*",
    admin: true,
    permisoRol: "tipos_cambio",
    busqueda: [],
    orden: { col: "fecha", asc: false },
    campos: [
      { name: "fecha", label: "Fecha", type: "date", required: true, span: 4 },
      { name: "compra", label: "Compra", type: "number", required: true, span: 4, step: "0.0001" },
      { name: "venta", label: "Venta", type: "number", required: true, span: 4, step: "0.0001" },
    ],
    columnas: [
      { name: "fecha", label: "Fecha", type: "date" },
      { name: "compra", label: "Compra", type: "number", decimales: 3 },
      { name: "venta", label: "Venta", type: "number", decimales: 3 },
      {
        name: "fuente", label: "Origen", type: "badge",
        tonos: { sunat: "brand", manual: "muted" }, labels: { sunat: "SUNAT", manual: "Manual" },
      },
    ],
  },
};

/** Obtiene el valor de una ruta "a.b" en un objeto */
export function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}
