import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { FilterSelect, SearchBox } from "@/components/ui/SearchBox";
import { Pager, pageRange } from "@/components/ui/Pager";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { requirePermiso } from "@/lib/sesion";
import { ACCION, DIAS_ACTIVIDAD, ETIQUETAS, TABLAS, fechaHora, valor } from "@/lib/actividad";
import { FileSpreadsheet } from "lucide-react";
import { haceDias } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";
import s from "./actividad.module.css";

export const metadata: Metadata = { title: "Registro de actividad" };

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
        subtitle={`Quién creó, editó o eliminó clientes, artículos, precios y configuración. Se guarda ${DIAS_ACTIVIDAD} días: para conservar algo más tiempo, descárgalo en Excel.`}
        actions={
          <a className={ui.btn} title="Descarga el registro con los filtros actuales"
            href={`/api/actividad/excel?${new URLSearchParams(Object.entries({ q, tabla, accion, periodo }).filter(([, v]) => v) as [string, string][])}`}>
            <FileSpreadsheet /> Exportar Excel
          </a>
        }
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
