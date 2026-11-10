import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { FilterSelect, SearchBox } from "@/components/ui/SearchBox";
import { Pager, pageRange } from "@/components/ui/Pager";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { requirePermiso } from "@/lib/sesion";
import { MODULOS } from "@/lib/modulos";
import { haceDias } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";
import s from "./actividad.module.css";

export const metadata: Metadata = { title: "Registro de actividad" };

const TABLAS: Record<string, { label: string; ruta?: string }> = {
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
const ETIQUETAS: Record<string, string> = {
  precio_venta: "Precio muestra", precio_ciento: "Precio x ciento", precio_millar: "Precio x millar",
  precio_compra: "Precio de compra", desde_ciento: "Ciento desde", desde_millar: "Millar desde",
  codigo_proveedor: "Código del proveedor", preferido: "Preferido", rol: "Rol", rol_id: "Rol", permisos: "Permisos",
};
for (const m of Object.values(MODULOS)) for (const c of m.campos) ETIQUETAS[c.name] ??= c.label;

const ACCION = { crear: { label: "Creó", tono: "ok" }, editar: { label: "Editó", tono: "info" }, eliminar: { label: "Eliminó", tono: "danger" }, importar: { label: "Importó", tono: "brand" } } as const;

function valor(v: unknown) {
  if (v === null || v === undefined || v === "") return "(vacío)";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  const t = String(v);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(t)) return "(otro registro)";
  if (/^https?:\/\//.test(t)) return "(imagen)";
  return t.length > 70 ? t.slice(0, 70) + "…" : t;
}

const fechaHora = (iso: string) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

export default async function ActividadPage({ searchParams }: PageProps<"/configuracion/actividad">) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = str("q")?.trim();
  // Solo valores conocidos: un filtro inventado en la URL no debe romper la página
  const tabla = str("tabla") && str("tabla")! in TABLAS ? str("tabla") : undefined;
  const accion = str("accion") && str("accion")! in ACCION ? str("accion") : undefined;
  const periodo = /^\d{1,4}$/.test(str("periodo") ?? "") ? str("periodo") : undefined;
  const { page, from, to } = pageRange(str("p"));
  const { supabase } = await requirePermiso("actividad");

  let query = supabase
    .from("actividad")
    .select("id, created_at, usuario, tabla, registro_id, registro, accion, cambios", { count: "exact" });
  if (q) {
    const t = q.replace(/[%,()]/g, " ");
    query = query.or(`registro.ilike.%${t}%,usuario.ilike.%${t}%`);
  }
  if (tabla) query = query.eq("tabla", tabla);
  if (accion) query = query.eq("accion", accion);
  if (periodo) query = query.gte("created_at", haceDias(Number(periodo)));
  const { data, count } = await query.order("created_at", { ascending: false }).range(from, to);

  return (
    <>
      <PageHeader
        title="Registro de actividad"
        subtitle="Quién creó, editó o eliminó clientes, artículos, precios y configuración. Se guarda 12 meses."
      />
      <div className={ui.card}>
        <div className={ui.toolbar}>
          <SearchBox placeholder="Registro o usuario..." />
          <FilterSelect name="tabla" placeholder="Todos los módulos"
            options={Object.entries(TABLAS).map(([value, t]) => ({ value, label: t.label }))} />
          <FilterSelect name="accion" placeholder="Toda acción"
            options={Object.entries(ACCION).map(([value, a]) => ({ value, label: a.label }))} />
          <FilterSelect name="periodo" placeholder="Cualquier fecha"
            options={[{ value: "1", label: "Hoy y ayer" }, { value: "7", label: "Últimos 7 días" }, { value: "30", label: "Últimos 30 días" }]} />
        </div>
        {!data?.length ? (
          <Empty>No hay actividad registrada con esos filtros</Empty>
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr><th style={{ width: 130 }}>Fecha</th><th style={{ width: 170 }}>Usuario</th><th style={{ width: 90 }}>Acción</th><th>Registro</th><th>Cambios</th></tr>
              </thead>
              <tbody>
                {data.map((a) => {
                  const t = TABLAS[a.tabla];
                  const resumen = a.accion === "importar" ? ((a.cambios?.resumen ?? []) as string[]) : null;
                  const cambios = resumen ? [] : Object.entries((a.cambios ?? {}) as Record<string, [unknown, unknown]>);
                  const acc = ACCION[a.accion as keyof typeof ACCION];
                  return (
                    <tr key={a.id}>
                      <td className={ui.muted}>{fechaHora(a.created_at)}</td>
                      <td>{a.usuario ?? "Sistema"}</td>
                      <td><Badge tono={acc.tono}>{acc.label}</Badge></td>
                      <td>
                        <div className={ui.muted} style={{ fontSize: 12 }}>{t?.label ?? a.tabla}</div>
                        {t?.ruta && a.registro_id && a.accion !== "eliminar"
                          ? <Link href={`${t.ruta}/${a.registro_id}`} className={s.link}>{a.registro}</Link>
                          : <span>{a.registro}</span>}
                      </td>
                      <td>
                        {resumen ? (
                          <ul className={s.cambios}>{resumen.map((l) => <li key={l}>{l}</li>)}</ul>
                        ) : cambios.length ? (
                          <ul className={s.cambios}>
                            {cambios.map(([k, [antes, despues]]) => (
                              <li key={k}>
                                <span className={s.campo}>{ETIQUETAS[k] ?? k}:</span>{" "}
                                <span className={s.antes}>{valor(antes)}</span> → <span className={s.despues}>{valor(despues)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : <span className={ui.muted}>{a.accion === "crear" ? "Registro nuevo" : "Registro eliminado"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} total={count ?? 0} params={{ q, tabla, accion, periodo }} path="/configuracion/actividad" />
      </div>
    </>
  );
}
