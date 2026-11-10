import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, FileText, Percent, Plus, ShieldAlert, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EstadoBadge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { getSesion, puede } from "@/lib/sesion";
import { ESTADOS, type EstadoCotizacion } from "@/lib/estados";
import { fecha, haceDias, hoyLima, money } from "@/lib/format";
import { Seguimiento, type FilaSeguimiento } from "@/components/dashboard/Seguimiento";
import ui from "@/components/ui/ui.module.css";
import s from "./dashboard.module.css";

type Resumen = {
  mes_cantidad: number;
  mes_total_pen: number;
  pendientes: number;
  por_aprobar: number;
  aceptadas_mes: number;
  tasa_cierre: number;
  por_estado: Record<string, number>;
  por_mes: { mes: string; cantidad: number; aceptado_pen: number }[];
  clientes: number;
  articulos: number;
  proveedores: number;
};

/** Días sin respuesta para pedir seguimiento, y días antes del vencimiento para avisar */
const DIAS_SIN_RESPUESTA = 5;
const DIAS_POR_VENCER = 7;

const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export default async function Dashboard() {
  const { supabase, perfil, permisos } = await getSesion();
  const hoy = hoyLima();
  const enN = new Date(Date.parse(hoy) + DIAS_POR_VENCER * 86_400_000).toISOString().slice(0, 10);
  const [{ data: r }, { data: recientes }, { data: abiertas }] = await Promise.all([
    supabase.rpc("dashboard_resumen"),
    supabase
      .from("v_cotizaciones")
      .select("id, codigo, cliente_nombre, fecha_emision, total, moneda, estado")
      .order("created_at", { ascending: false })
      .limit(8),
    // Abiertas (emitidas o entregadas) que ya piden seguimiento
    supabase
      .from("v_cotizaciones")
      .select("id, codigo, cliente_nombre, agente_nombre, fecha_emision, fecha_vencimiento, total, moneda, estado")
      .in("estado", ["emitida", "entregada"])
      .or(`fecha_emision.lte.${haceDias(DIAS_SIN_RESPUESTA)},fecha_vencimiento.lte.${enN}`)
      .order("fecha_vencimiento")
      .limit(15),
  ]);
  const orden = { vencida: 0, por_vencer: 1, sin_respuesta: 2 } as const;
  const seguimiento: FilaSeguimiento[] = (abiertas ?? [])
    .map((c) => {
      const v = String(c.fecha_vencimiento);
      const motivo: FilaSeguimiento["motivo"] = v < hoy ? "vencida" : v <= enN ? "por_vencer" : "sin_respuesta";
      const dias = motivo === "vencida" ? diasEntre(v, hoy) : motivo === "por_vencer" ? diasEntre(hoy, v) : diasEntre(String(c.fecha_emision), hoy);
      return { ...c, total: Number(c.total), motivo, dias } as FilaSeguimiento;
    })
    .sort((a, b) => orden[a.motivo] - orden[b.motivo] || b.dias - a.dias);
  const res = (r ?? {}) as Resumen;
  const porMes = res.por_mes ?? [];
  const maxMes = Math.max(1, ...porMes.map((m) => m.cantidad));
  const estados = Object.entries(res.por_estado ?? {}).sort((a, b) => b[1] - a[1]);
  const totalEstados = Math.max(1, estados.reduce((a, [, n]) => a + n, 0));
  const nombre = perfil.nombre.split(" ")[0];

  const kpis = [
    { label: "Cotizaciones del mes", value: String(res.mes_cantidad ?? 0), icon: FileText, nota: "sin anuladas" },
    { label: "Monto cotizado del mes", value: money(res.mes_total_pen ?? 0, "PEN"), icon: TrendingUp, nota: "emitidas en adelante, en soles" },
    { label: "Pendientes de respuesta", value: String(res.pendientes ?? 0), icon: Clock, nota: "emitidas o entregadas" },
    { label: "Tasa de cierre", value: `${res.tasa_cierre ?? 0}%`, icon: Percent, nota: "aceptadas sobre cerradas" },
  ];

  return (
    <>
      <PageHeader
        title={`Hola, ${nombre}`}
        subtitle="Resumen de la actividad comercial"
        actions={
          <Link href="/cotizaciones/nueva" className={`${ui.btn} ${ui.primary}`}>
            <Plus /> Nueva cotización
          </Link>
        }
      />

      {res.por_aprobar > 0 && (
        <Link href="/cotizaciones?estado=por_aprobar" className={s.aviso}>
          <ShieldAlert />
          <span>
            <strong>{res.por_aprobar} cotización{res.por_aprobar === 1 ? "" : "es"} por aprobar</strong>
            {puede(permisos, "aprobar") ? " · superan el límite de su vendedor y esperan tu aprobación" : " · esperando aprobación"}
          </span>
          <ArrowRight />
        </Link>
      )}

      <section className={s.kpis}>
        {kpis.map(({ label, value, icon: Icon, nota }) => (
          <div key={label} className={`${ui.card} ${s.kpi}`}>
            <div className={s.kpiHead}>
              <span>{label}</span>
              <span className={s.kpiIcon}><Icon /></span>
            </div>
            <div className={s.kpiValue}>{value}</div>
            <div className={s.kpiNote}>{nota}</div>
          </div>
        ))}
      </section>

      <section className={s.seguimiento}>
        <Seguimiento filas={seguimiento} verAgente={puede(permisos, "cotizaciones_todas")} />
      </section>

      <section className={s.grid2}>
        <div className={ui.card}>
          <div className={ui.cardHead}>
            <span className={ui.cardTitle}>Cotizaciones por mes</span>
            <span className={ui.muted}>últimos 6 meses</span>
          </div>
          <div className={s.bars} role="img" aria-label="Cantidad de cotizaciones por mes">
            {porMes.map((m) => {
              const [y, mm] = m.mes.split("-").map(Number);
              return (
                <div key={m.mes} className={s.barCol} tabIndex={0}>
                  <div className={s.tip}>
                    <strong>{MESES[mm - 1]} {y}</strong>
                    <span>{m.cantidad} cotizaciones</span>
                    <span>Aceptado: {money(m.aceptado_pen, "PEN")}</span>
                  </div>
                  <span className={s.barVal}>{m.cantidad || ""}</span>
                  <div className={s.bar} style={{ height: `${(m.cantidad / maxMes) * 100}%` }} />
                  <span className={s.barLabel}>{MESES[mm - 1]}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className={ui.card}>
          <div className={ui.cardHead}>
            <span className={ui.cardTitle}>Por estado</span>
            <span className={ui.muted}>histórico</span>
          </div>
          <div className={ui.cardBody}>
            {estados.length === 0 ? (
              <Empty>Aún no hay cotizaciones</Empty>
            ) : (
              <ul className={s.estados}>
                {estados.map(([estado, n]) => (
                  <li key={estado}>
                    <div className={s.estadoRow}>
                      <EstadoBadge estado={estado} />
                      <span className={s.estadoN}>{n}</span>
                    </div>
                    <div className={s.track}>
                      <div
                        className={`${s.fill} ${s["t_" + (ESTADOS[estado as EstadoCotizacion]?.tono ?? "muted")]}`}
                        style={{ width: `${(n / totalEstados) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className={s.grid2b}>
        <div className={ui.card}>
          <div className={ui.cardHead}>
            <span className={ui.cardTitle}>Últimas cotizaciones</span>
            <Link href="/cotizaciones" className={`${ui.btn} ${ui.sm} ${ui.ghost}`}>
              Ver todas <ArrowRight />
            </Link>
          </div>
          {recientes?.length ? (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr><th>Código</th><th>Cliente</th><th>Fecha</th><th className={ui.num}>Total</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {recientes.map((c) => (
                    <tr key={c.id}>
                      <td><Link href={`/cotizaciones/${c.id}`} className={`${ui.mono} ${s.link}`}>{c.codigo}</Link></td>
                      <td>{c.cliente_nombre}</td>
                      <td>{fecha(c.fecha_emision)}</td>
                      <td className={ui.num}>{money(c.total, c.moneda)}</td>
                      <td><EstadoBadge estado={c.estado} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Crea tu primera cotización</Empty>
          )}
        </div>

        <div className={ui.card}>
          <div className={ui.cardHead}>
            <span className={ui.cardTitle}><CheckCircle2 /> Base comercial</span>
          </div>
          <div className={s.counts}>
            <Link href="/clientes"><strong>{res.clientes ?? 0}</strong><span>Clientes activos</span></Link>
            <Link href="/articulos"><strong>{res.articulos ?? 0}</strong><span>Artículos en catálogo</span></Link>
            <Link href="/proveedores"><strong>{res.proveedores ?? 0}</strong><span>Proveedores</span></Link>
            <Link href="/cotizaciones?estado=aceptada"><strong>{res.aceptadas_mes ?? 0}</strong><span>Aceptadas este mes</span></Link>
          </div>
        </div>
      </section>
    </>
  );
}
