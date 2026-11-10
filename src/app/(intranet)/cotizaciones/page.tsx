import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, FileSpreadsheet, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { FilterSelect, SearchBox } from "@/components/ui/SearchBox";
import { Pager, pageRange } from "@/components/ui/Pager";
import { EstadoBadge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { RowLink } from "@/components/ui/RowLink";
import { getSesion, puede } from "@/lib/sesion";
import { ESTADOS } from "@/lib/estados";
import { fecha, haceDias, hoyLima, money } from "@/lib/format";
import { filtroNumero } from "@/lib/consultas";
import { mensajeError } from "@/lib/errores";
import ui from "@/components/ui/ui.module.css";

export const metadata: Metadata = { title: "Cotizaciones" };

export default async function CotizacionesPage({ searchParams }: PageProps<"/cotizaciones">) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = str("q")?.trim();
  const estado = str("estado");
  const agente = str("agente");
  const periodo = str("periodo");
  const { page, from, to } = pageRange(str("p"));
  const { supabase, permisos } = await getSesion();

  let query = supabase
    .from("v_cotizaciones")
    .select("id, codigo, fecha_emision, fecha_vencimiento, cliente_nombre, cliente_doc, agente_nombre, moneda, total, estado", { count: "exact" });
  if (q) {
    const t = q.replace(/[%,()]/g, " ");
    query = query.or(
      [`cliente_nombre.ilike.%${t}%`, `cliente_doc.ilike.%${t}%`, filtroNumero(t)].filter(Boolean).join(","),
    );
  }
  if (estado) query = query.eq("estado", estado);
  else query = query.neq("estado", "reemplazada");
  if (agente) query = query.eq("agente_id", agente);
  if (periodo) {
    const hoy = hoyLima();
    const desde =
      periodo === "mes" ? `${hoy.slice(0, 7)}-01`
      : periodo === "anio" ? `${hoy.slice(0, 4)}-01-01`
      : periodo === "30" ? haceDias(30)
      : null;
    if (desde) query = query.gte("fecha_emision", desde);
  }
  const [{ data, count, error }, { data: agentes }] = await Promise.all([
    query.order("fecha_emision", { ascending: false }).order("numero", { ascending: false }).range(from, to),
    supabase.from("agentes").select("id, nombre").order("nombre"),
  ]);
  const hoy = hoyLima();

  return (
    <>
      <PageHeader
        title="Cotizaciones"
        subtitle={puede(permisos, "cotizaciones_todas") ? "Emisión y seguimiento de propuestas comerciales" : "Tus cotizaciones y las asignadas a tu agente"}
        actions={
          <>
            <a className={ui.btn} title="Exporta el listado con los filtros actuales"
              href={`/api/cotizaciones/excel?${new URLSearchParams(Object.entries({ q, estado, agente, periodo }).filter(([, v]) => v) as [string, string][])}`}>
              <FileSpreadsheet /> Exportar Excel
            </a>
            <Link href="/cotizaciones/nueva" className={`${ui.btn} ${ui.primary}`}><Plus /> Nueva cotización</Link>
          </>
        }
      />
      <div className={ui.card}>
        <div className={ui.toolbar}>
          <SearchBox placeholder="Cliente, RUC/DNI o número..." />
          <FilterSelect name="estado" placeholder="Todos los estados"
            options={Object.entries(ESTADOS).map(([value, e]) => ({ value, label: e.label }))} />
          {puede(permisos, "cotizaciones_todas") && (
            <FilterSelect name="agente" placeholder="Todos los agentes"
              options={(agentes ?? []).map((a) => ({ value: a.id, label: a.nombre }))} />
          )}
          <FilterSelect name="periodo" placeholder="Cualquier fecha"
            options={[{ value: "mes", label: "Este mes" }, { value: "30", label: "Últimos 30 días" }, { value: "anio", label: "Este año" }]} />
        </div>
        {error ? (
          <div className={ui.alert}><AlertCircle /> No se pudo cargar el listado: {mensajeError(error)}</div>
        ) : !data?.length ? (
          <Empty>No hay cotizaciones con esos filtros</Empty>
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Código</th><th>Emisión</th><th>Cliente</th><th>Agente</th>
                  <th className={ui.num}>Total</th><th>Estado</th><th>Vence</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => {
                  const porVencer = ["emitida", "entregada"].includes(c.estado) && c.fecha_vencimiento < hoy;
                  return (
                    <RowLink key={c.id} href={`/cotizaciones/${c.id}`}>
                      <td className={`${ui.mono} ${ui.strong}`}>{c.codigo}</td>
                      <td>{fecha(c.fecha_emision)}</td>
                      <td>
                        <div className={ui.strong}>{c.cliente_nombre}</div>
                        <div className={`${ui.muted} ${ui.mono}`}>{c.cliente_doc}</div>
                      </td>
                      <td>{c.agente_nombre}</td>
                      <td className={`${ui.num} ${ui.strong}`}>{money(c.total, c.moneda)}</td>
                      <td><EstadoBadge estado={c.estado} /></td>
                      <td style={porVencer ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
                        {fecha(c.fecha_vencimiento)}
                      </td>
                    </RowLink>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} total={count ?? 0} params={{ q, estado, agente, periodo }} path="/cotizaciones" />
      </div>
    </>
  );
}
