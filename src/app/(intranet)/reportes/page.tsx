import type { Metadata } from "next";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EstadoBadge } from "@/components/ui/Badge";
import { Filtros } from "@/components/reportes/Filtros";
import { GraficoMeses } from "@/components/reportes/GraficoMeses";
import { TablaOrdenable } from "@/components/reportes/TablaOrdenable";
import { Pestanas } from "@/components/reportes/Pestanas";
import { requirePermiso } from "@/lib/sesion";
import { cargarReporte, leerFiltros } from "@/lib/reportes";
import { fecha, hoyLima, money, num } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";
import s from "@/components/reportes/reportes.module.css";

export const metadata: Metadata = { title: "Reportes" };

export default async function ReportesPage({ searchParams }: PageProps<"/reportes">) {
  const sp = await searchParams;
  const f = leerFiltros(sp);
  const { supabase } = await requirePermiso("reportes"); // gerencia o quien tenga el permiso
  const [r, { data: agentes }, { data: empresas }] = await Promise.all([
    cargarReporte(supabase, f),
    supabase.from("agentes").select("id, nombre").order("nombre"),
    supabase.from("empresas").select("id, razon_social").order("razon_social"),
  ]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();

  const kpis = [
    { l: "Cotizado", v: money(r.resumen.cotizado), n: `${r.resumen.cantidad} cotizaciones` },
    { l: "Aceptado", v: money(r.resumen.aceptado), n: `${r.resumen.aceptadas} aceptadas` },
    { l: "Pendiente de respuesta", v: money(r.resumen.pendiente), n: `${r.resumen.pendientes} emitidas o entregadas` },
    { l: "Tasa de cierre", v: `${num(r.resumen.tasa, 1)}%`, n: "aceptadas sobre cerradas" },
    { l: "Ticket promedio", v: money(r.resumen.ticket), n: `${r.resumen.anuladas} anuladas en el periodo` },
  ];

  return (
    <>
      <PageHeader
        title="Reportes"
        subtitle={`Del ${fecha(f.desde)} al ${fecha(f.hasta)} · montos en soles (dólares convertidos con el T.C. de cada cotización)`}
        actions={
          <a href={`/api/reportes/excel?${qs}`} className={`${ui.btn} ${ui.primary}`}>
            <FileSpreadsheet /> Exportar a Excel
          </a>
        }
      />
      <Filtros
        desde={f.desde}
        hasta={f.hasta}
        hoy={hoyLima()}
        agentes={(agentes ?? []).map((a) => ({ value: a.id, label: a.nombre }))}
        empresas={(empresas ?? []).map((e) => ({ value: e.id, label: e.razon_social }))}
      />

      <section className={s.kpis}>
        {kpis.map((k) => (
          <div key={k.l} className={`${ui.card} ${s.kpi}`}>
            <small>{k.l}</small>
            <strong>{k.v}</strong>
            <span>{k.n}</span>
          </div>
        ))}
      </section>

      <section className={s.grid2}>
        <div className={ui.card}>
          <div className={ui.cardHead}><span className={ui.cardTitle}>Cotizado vs. aceptado por mes</span></div>
          <GraficoMeses datos={r.por_mes} />
        </div>
        <div className={ui.card}>
          <div className={ui.cardHead}><span className={ui.cardTitle}>Por estado</span></div>
          <ul className={s.estados}>
            {r.por_estado.map((e) => (
              <li key={e.estado}>
                <Link href={`/cotizaciones?estado=${e.estado}`}><EstadoBadge estado={e.estado} /></Link>
                <span>{e.cantidad} · {money(e.monto)}</span>
              </li>
            ))}
            {!r.por_estado.length && <li className={ui.muted}>Sin cotizaciones</li>}
          </ul>
        </div>
      </section>

      <div className={ui.card}>
        <Pestanas
          tabs={[
            {
              id: "agente", label: "Por agente",
              contenido: (
                <TablaOrdenable orden="cotizado" filas={r.por_agente} columnas={[
                  { key: "agente", label: "Agente" },
                  { key: "cantidad", label: "Cotizaciones", tipo: "int" },
                  { key: "cotizado", label: "Cotizado", tipo: "money", barra: true },
                  { key: "aceptadas", label: "Aceptadas", tipo: "int" },
                  { key: "aceptado", label: "Aceptado", tipo: "money" },
                  { key: "tasa", label: "Cierre", tipo: "pct" },
                ]} />
              ),
            },
            {
              id: "cliente", label: "Por cliente",
              contenido: (
                <TablaOrdenable orden="cotizado" link={{ base: "/clientes", key: "id" }} filas={r.por_cliente} columnas={[
                  { key: "cliente", label: "Cliente" },
                  { key: "documento", label: "Documento", tipo: "mono" },
                  { key: "cantidad", label: "Cotiz.", tipo: "int" },
                  { key: "cotizado", label: "Cotizado", tipo: "money", barra: true },
                  { key: "aceptado", label: "Aceptado", tipo: "money" },
                  { key: "ultima", label: "Última", tipo: "date" },
                ]} />
              ),
            },
            {
              id: "articulo", label: "Artículos más cotizados",
              contenido: (
                <TablaOrdenable orden="monto" filas={r.por_articulo} columnas={[
                  { key: "codigo", label: "Código", tipo: "mono" },
                  { key: "articulo", label: "Artículo" },
                  { key: "cotizaciones", label: "Cotiz.", tipo: "int" },
                  { key: "cantidad", label: "Cantidad", tipo: "num" },
                  { key: "monto", label: "Monto", tipo: "money", barra: true },
                  { key: "aceptado", label: "Aceptado", tipo: "money" },
                ]} />
              ),
            },
            {
              id: "proveedor", label: "Por proveedor",
              contenido: (
                <TablaOrdenable orden="costo" filas={r.por_proveedor} columnas={[
                  { key: "proveedor", label: "Proveedor" },
                  { key: "ruc", label: "RUC", tipo: "mono" },
                  { key: "items", label: "Ítems", tipo: "int" },
                  { key: "costo", label: "Costo cotizado", tipo: "money", barra: true },
                  { key: "costo_aceptado", label: "Costo aceptado", tipo: "money" },
                ]} />
              ),
            },
          ]}
        />
      </div>
    </>
  );
}
