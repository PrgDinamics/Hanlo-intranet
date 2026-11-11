import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSesion } from "@/lib/sesion";
import { fecha, fechaLarga, money, num, pu } from "@/lib/format";
import { ImprimirBoton } from "./ImprimirBoton";
import { Logo } from "@/components/ui/Logo";
import s from "./imprimir.module.css";
import { textoImpresion } from "@/lib/impresion";

export async function generateMetadata({ params }: PageProps<"/imprimir/cotizacion/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { supabase } = await getSesion();
  const { data } = await supabase.from("v_cotizaciones").select("codigo, cliente_nombre").eq("id", id).maybeSingle();
  return { title: data ? `${data.codigo} ${data.cliente_nombre}` : "Cotización" };
}

export default async function ImprimirPage({ params }: PageProps<"/imprimir/cotizacion/[id]">) {
  const { id } = await params;
  const { supabase } = await getSesion();
  const { data: c } = await supabase.from("v_cotizaciones").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: emp }, { data: cli }, { data: items }, { data: agente }] = await Promise.all([
    supabase.from("empresas").select("*").eq("id", c.empresa_id).single(),
    supabase.from("clientes").select("*").eq("id", c.cliente_id).single(),
    supabase.from("cotizacion_items").select("*").eq("cotizacion_id", id).order("orden"),
    c.agente_id
      ? supabase.from("agentes").select("nombre, email, telefono").eq("id", c.agente_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const hayDescuento = (items ?? []).some((i) => Number(i.descuento_pct) > 0);
  // Fotos del catálogo para cada ítem
  const artIds = [...new Set((items ?? []).map((i) => i.articulo_id).filter(Boolean))] as string[];
  const { data: arts } = artIds.length
    ? await supabase.from("articulos").select("id, foto_url").in("id", artIds)
    : { data: [] as { id: string; foto_url: string | null }[] };
  const foto = new Map((arts ?? []).map((a) => [a.id, a.foto_url as string | null]));
  const hayFotos = (items ?? []).some((i) => i.articulo_id && foto.get(i.articulo_id));
  // Marca de agua en lo que no es una cotización válida para el cliente (por aprobar: aún sin aprobación)
  const marca = c.estado === "por_aprobar" ? "POR APROBAR"
    : ["anulada", "borrador", "reemplazada"].includes(c.estado) ? c.estado.toUpperCase() : null;

  return (
    <div className={s.page}>
      <ImprimirBoton />
      <article className={s.hoja}>
        {marca && <div className={s.marca}>{marca}</div>}
        <header className={s.head}>
          <div className={s.emisor}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {emp?.logo_url ? <img src={emp.logo_url} alt="" className={s.logo} /> : <Logo fondo="claro" tam={22} />}
            <div>
              <h1 className={s.razon}>{emp?.razon_social}</h1>
              <p>RUC {emp?.ruc}</p>
              {emp?.direccion && <p>{emp.direccion}</p>}
              <p>{[emp?.telefono, emp?.email, emp?.web].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className={s.caja}>
            <span>COTIZACIÓN</span>
            <strong>{c.codigo}</strong>
            <small>{fecha(c.fecha_emision)}</small>
          </div>
        </header>

        <section className={s.datos}>
          <div>
            <h3>Cliente</h3>
            <p className={s.fuerte}>{cli?.nombre}</p>
            <p>{cli?.tipo_doc} {cli?.num_doc}</p>
            {cli?.direccion && <p>{cli.direccion}</p>}
            {cli?.contacto_nombre && <p>Atención: {cli.contacto_nombre}{cli.contacto_cargo ? `, ${cli.contacto_cargo}` : ""}</p>}
          </div>
          <div>
            <h3>Condiciones</h3>
            <table className={s.cond}>
              <tbody>
                <tr><td>Moneda</td><td>{c.moneda === "PEN" ? "Soles (S/)" : "Dólares (US$)"}</td></tr>
                <tr><td>Forma de pago</td><td>{c.forma_pago_nombre ?? "A convenir"}</td></tr>
                <tr><td>Validez</td><td>{c.validez_dias} días (hasta {fecha(c.fecha_vencimiento)})</td></tr>
                {c.tiempo_entrega && <tr><td>Entrega</td><td>{c.tiempo_entrega}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <p className={s.intro}>
          {c.lugar}, {fechaLarga(c.fecha_emision)}. Por medio de la presente le hacemos llegar nuestra propuesta:
        </p>

        <table className={s.items}>
          <thead>
            <tr>
              <th>#</th>{hayFotos && <th className={s.fotoCol}>Foto</th>}<th>Descripción</th><th>Und.</th><th className={s.n}>Cant.</th>
              <th className={s.n}>P. unit.</th>{hayDescuento && <th className={s.n}>Dsct.</th>}<th className={s.n}>Importe</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((i, n) => (
              <tr key={i.id}>
                <td>{n + 1}</td>
                {hayFotos && (
                  <td className={s.fotoCol}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {i.articulo_id && foto.get(i.articulo_id) ? <img src={foto.get(i.articulo_id)!} alt="" className={s.foto} /> : null}
                  </td>
                )}
                <td>
                  <div className={s.fuerte}>{i.descripcion}</div>
                  {i.color && <div className={s.det}>Color: {i.color}</div>}
                  {Number(i.impresion_colores) > 0 && <div className={s.det}>{textoImpresion(i.cantidad, i.impresion_colores)}</div>}
                  {i.detalle && <div className={s.det}>{i.detalle}</div>}
                </td>
                <td>{i.unidad}</td>
                <td className={s.n}>{num(i.cantidad)}</td>
                <td className={s.n}>{pu(i.precio_unitario)}</td>
                {hayDescuento && <td className={s.n}>{Number(i.descuento_pct) ? `${num(i.descuento_pct, 1)}%` : ""}</td>}
                <td className={s.n}>{num(i.importe)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={s.pie}>
          <div className={s.obs}>
            {c.observaciones && (<><h3>Observaciones</h3><p>{c.observaciones}</p></>)}
            <p className={s.pago}><strong>Forma de pago:</strong> {c.forma_pago_nombre ?? "A convenir"}</p>
            <p className={s.nota}>{c.precios_incluyen_igv ? "Los precios unitarios incluyen IGV." : "Precios unitarios sin IGV. El total incluye IGV."}</p>
          </div>
          <table className={s.totales}>
            <tbody>
              <tr><td>Subtotal</td><td>{money(c.subtotal, c.moneda)}</td></tr>
              <tr><td>IGV {num(c.igv_pct, 0)}%</td><td>{money(c.igv, c.moneda)}</td></tr>
              <tr className={s.total}><td>Total (inc. IGV)</td><td>{money(c.total, c.moneda)}</td></tr>
            </tbody>
          </table>
        </div>

        {emp?.pie_cotizacion && <div className={s.condiciones}>{emp.pie_cotizacion}</div>}

        <footer className={s.firma}>
          <div>
            <p>Atentamente,</p>
            <p className={s.fuerte}>{agente?.nombre ?? emp?.razon_social}</p>
            {agente && <p>{[agente.telefono, agente.email].filter(Boolean).join(" · ")}</p>}
          </div>
        </footer>
      </article>
    </div>
  );
}
