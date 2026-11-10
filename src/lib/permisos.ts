/**
 * Permisos que se asignan a los roles (Configuración > Roles).
 * Usuarios, roles y agentes comerciales los maneja solo el rol Administrador (fijo).
 * Se usa en servidor y en el navegador: solo datos.
 */
export const PERMISOS = [
  { clave: "cotizaciones_todas", grupo: "Cotizaciones", label: "Ver y editar las cotizaciones de todos", hint: "Sin este permiso solo ve las suyas y las de su agente" },
  { clave: "aprobar", grupo: "Cotizaciones", label: "Aprobar cotizaciones que superan el límite", hint: "También emite sin tope de límite" },
  { clave: "clientes", grupo: "Maestros", label: "Crear y editar clientes", hint: "Además de lo que permita su agente comercial" },
  { clave: "articulos", grupo: "Maestros", label: "Crear y editar artículos, precios, proveedores y líneas", hint: "Además de lo que permita su agente comercial" },
  { clave: "importar", grupo: "Maestros", label: "Subir Excel (listas de stock y carga inicial)" },
  { clave: "tipos_cambio", grupo: "Configuración", label: "Tipo de cambio" },
  { clave: "formas_pago", grupo: "Configuración", label: "Formas de pago" },
  { clave: "empresas", grupo: "Configuración", label: "Empresas (factores, pie de cotización, logo)" },
  { clave: "reportes", grupo: "Gerencia", label: "Reportes" },
  { clave: "actividad", grupo: "Gerencia", label: "Registro de actividad" },
] as const;

export type Permiso = (typeof PERMISOS)[number]["clave"];
export const TODOS_LOS_PERMISOS = PERMISOS.map((p) => p.clave) as Permiso[];
export const esPermiso = (v: string): v is Permiso => (TODOS_LOS_PERMISOS as string[]).includes(v);
