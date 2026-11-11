import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, FileText, GitBranch, Info } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EstadoBadge } from "@/components/ui/Badge";
import { getSesion, puede } from "@/lib/sesion";
import { ESTADOS, type EstadoCotizacion } from "@/lib/estados";
import { fecha, fechaHora, money, num, pu } from "@/lib/format";
import { Acciones } from "./Acciones";
import ui from "@/components/ui/ui.module.css";
import s from "./detalle.module.css";
import { textoImpresion } from "@/lib/impresion";

export default async function CotizacionPage({ params }: PageProps<"/cotizaciones/[id]">) {
  const { id } = await params;
  const { supabase, permisos } = await getSesion();
  const { data: c } = await supabase.from("v_cotizaciones").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();

  const [{ data: items }, { data: hist }, { data: versiones }, { data: usuarios }] = await Promise.all([
    supabase.from("cotizacion_items").select("*, proveedor:proveedores(razon_social)").eq("cotizacion_id", id).order("orden"),
    supabase.from("cotizacion_historial").select("*").eq("cotizacion_id", id).order("created_at", { ascending: false }),
    supabase.from("v_cotizaciones").select("id, codigo, version, estado, total, moneda")
      .eq("empresa_id", c.empresa_id).eq("serie", c.serie).eq("numero", c.numero).order("version"),
    supabase.from("perfiles").select("id, nombre"),
  ]);
  const nombreUsuario = new Map((usuarios ?? []).map((u) => [u.id, u.nombre]));
  const costo = (items ?? []).reduce((a, i) => a + Number(i.cantidad) * Number(i.precio_costo), 0);
  // Cotizaciones antiguas con descuento: la columna solo aparece si algún ítem lo tiene
  const hayDescuento = (items ?? []).some((i) => Number(i.descuento_pct));
  const margen = costo > 0 ? ((Number(c.subtotal) - costo) / costo) * 100 : null;

  return (
    <>
      <PageHeader
        back={{ href: "/cotizaciones", label: "Cotizaciones" }}
        title={<span className={s.titulo}><span className={ui.mono}>{c.codigo}</span> <EstadoBadge estado={c.estado} /></span>}
        subtitle={`${c.cliente_nombre} · ${fecha(c.fecha_emision)}`}
        actions={null}
      />
      <Acciones
        id={c.id}
        estado={c.estado as EstadoCotizacion}
        esAdmin={puede(permisos, "aprobar")}
        limite={permisos.limite_venta}
        superaLimite={
          !puede(permisos, "aprobar") && permisos.limite_venta !== null &&
          (c.moneda === "USD" ? Number(c.total) * Number(c.tipo_cambio ?? 1) : Number(c.total)) > permisos.limite_venta
        }
      />

      {c.estado === "anulada" && c.motivo_anulacion && (
        <div className={ui.alert} style={{ marginBottom: 18 }}><Info /> Anulada: {c.motivo_anulacion}</div>
      )}

      <div className={s.layout}>
        <div className={ui.stack}>
          <div className={ui.card}>
            <div className={ui.cardHead}><span className={ui.cardTitle}><FileText /> Datos de la cotización</span></div>
            <div className={`${ui.cardBody} ${s.info}`}>
              <dl className={ui.dl}>
                <dt>Cliente</dt>
                <dd><Link href={`/clientes/${c.cliente_id}`} className={s.link}>{c.cliente_nombre}</Link> <span className={ui.muted}>{c.cliente_doc}</span></dd>
                <dt>Empresa</dt><dd>{c.empresa_nombre}</dd>
                <dt>Agente</dt><dd>{c.agente_nombre ?? "No asignado"}</dd>
                <dt>Forma de pago</dt><dd>{c.forma_pago_nombre ?? "No especificada"}</dd>
              </dl>
              <dl className={ui.dl}>
                <dt>Lugar y fecha</dt><dd>{c.lugar}, {fecha(c.fecha_emision)}</dd>
                <dt>Validez</dt><dd>{c.validez_dias} días (hasta {fecha(c.fecha_vencimiento)})</dd>
                <dt>Moneda</dt><dd>{c.moneda === "PEN" ? "Soles" : "Dólares"}{c.tipo_cambio ? ` · T.C. ${num(c.tipo_cambio, 3)}` : ""}</dd>
                <dt>Entrega</dt><dd>{c.tiempo_entrega ?? "No especificado"}</dd>
              </dl>
            </div>
          </div>

          <div className={ui.card}>
            <div className={ui.cardHead}>
              <span className={ui.cardTitle}>Ítems</span>
              <span className={ui.muted}>{c.precios_incluyen_igv ? "Precios incluyen IGV" : "Precios sin IGV"}</span>
            </div>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>#</th><th>Descripción</th><th>Proveedor</th><th>Und.</th>
                    <th className={ui.num}>Cant.</th><th className={ui.num}>P. unit.</th>
                    {hayDescuento && <th className={ui.num}>Dsct.</th>}<th className={ui.num}>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {(items ?? []).map((i, n) => (
                    <tr key={i.id}>
                      <td className={ui.muted}>{n + 1}</td>
                      <td>
                        <div className={ui.strong}>{i.descripcion}</div>
                        {i.color && <div className={s.det}>Color: {i.color}</div>}
                        {Number(i.impresion_colores) > 0 && <div className={s.det}>{textoImpresion(i.cantidad, i.impresion_colores)}</div>}
                  {i.detalle && <div className={s.det}>{i.detalle}</div>}
                      </td>
                      <td className={ui.muted}>{i.proveedor?.razon_social}</td>
                      <td>{i.unidad}</td>
                      <td className={ui.num}>{num(i.cantidad)}</td>
                      <td className={ui.num}>{pu(i.precio_unitario)}</td>
                      {hayDescuento && <td className={ui.num}>{Number(i.descuento_pct) ? `${num(i.descuento_pct, 1)}%` : ""}</td>}
                      <td className={`${ui.num} ${ui.strong}`}>{num(i.importe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={s.totales}>
              {margen !== null && (
                <span className={s.margen}>Costo {money(costo, c.moneda)} · margen {num(margen, 1)}% (interno)</span>
              )}
              <dl>
                <dt>Subtotal</dt><dd>{money(c.subtotal, c.moneda)}</dd>
                <dt>IGV ({num(c.igv_pct, 0)}%)</dt><dd>{money(c.igv, c.moneda)}</dd>
                <dt className={s.total}>Total</dt><dd className={s.total}>{money(c.total, c.moneda)}</dd>
              </dl>
            </div>
          </div>

          {c.observaciones && (
            <div className={ui.card}>
              <div className={ui.cardHead}><span className={ui.cardTitle}>Observaciones</span></div>
              <div className={ui.cardBody} style={{ whiteSpace: "pre-line" }}>{c.observaciones}</div>
            </div>
          )}
        </div>

        <div className={ui.stack}>
          <div className={ui.card}>
            <div className={ui.cardHead}><span className={ui.cardTitle}><Clock /> Seguimiento</span></div>
            <ol className={s.timeline}>
              {(hist ?? []).map((h) => (
                <li key={h.id}>
                  <span className={`${s.dot} ${s["d_" + (ESTADOS[h.estado_nuevo as EstadoCotizacion]?.tono ?? "muted")]}`} />
                  <div>
                    <div className={ui.strong}>{ESTADOS[h.estado_nuevo as EstadoCotizacion]?.label ?? h.estado_nuevo}</div>
                    {h.nota && <div className={s.nota}>{h.nota}</div>}
                    <div className={ui.muted}>
                      {fechaHora(h.created_at)}{h.usuario_id && nombreUsuario.get(h.usuario_id) ? ` · ${nombreUsuario.get(h.usuario_id)}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {(versiones?.length ?? 0) > 1 && (
            <div className={ui.card}>
              <div className={ui.cardHead}><span className={ui.cardTitle}><GitBranch /> Versiones</span></div>
              <ul className={s.versiones}>
                {versiones!.map((v) => (
                  <li key={v.id} className={v.id === c.id ? s.actual : undefined}>
                    <Link href={`/cotizaciones/${v.id}`}>
                      <span className={ui.mono}>{v.codigo}</span>
                      <EstadoBadge estado={v.estado} />
                      <span className={s.vTotal}>{money(v.total, v.moneda)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
