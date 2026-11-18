import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Editor } from "@/components/cotizacion/Editor";
import { cargarDatosEditor } from "@/components/cotizacion/datos";
import { getSesion } from "@/lib/sesion";
import { EDITABLE, type EstadoCotizacion } from "@/lib/estados";
import { codigoCotizacion } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";

export default async function EditarPage({ params }: PageProps<"/cotizaciones/[id]/editar">) {
  const { id } = await params;
  const { supabase } = await getSesion();
  const [{ data: c }, { data: items }] = await Promise.all([
    supabase.from("cotizaciones").select("*").eq("id", id).maybeSingle(),
    supabase.from("cotizacion_items").select("*").eq("cotizacion_id", id).order("orden"),
  ]);
  if (!c) notFound();
  if (!EDITABLE.includes(c.estado as EstadoCotizacion)) redirect(`/cotizaciones/${id}`);
  const datos = await cargarDatosEditor((items ?? []).map((i) => i.articulo_id as string), c.empresa_id);
  if (!datos.empresas.some((e) => e.id === c.empresa_id)) {
    return (
      <>
        <PageHeader title={`Editar ${codigoCotizacion(c.serie, c.numero, c.version)}`}
          back={{ href: `/cotizaciones/${id}`, label: "Volver a la cotización" }} />
        <div className={`${ui.card} ${ui.cardBody}`}>
          Esta cotización es de una empresa que no tienes asignada. Pide al administrador que te la asigne en Configuración · Usuarios.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Editar ${codigoCotizacion(c.serie, c.numero, c.version)}`}
        back={{ href: `/cotizaciones/${id}`, label: "Volver a la cotización" }}
      />
      <Editor
        datos={datos}
        estado={c.estado}
        inicial={{
          id: c.id,
          empresa_id: c.empresa_id,
          cliente_id: c.cliente_id,
          agente_id: c.agente_id,
          moneda: c.moneda,
          tipo_cambio: c.tipo_cambio === null ? null : Number(c.tipo_cambio),
          forma_pago_id: c.forma_pago_id,
          lugar: c.lugar ?? "",
          fecha_emision: c.fecha_emision,
          validez_dias: c.validez_dias,
          tiempo_entrega: c.tiempo_entrega ?? "",
          precios_incluyen_igv: c.precios_incluyen_igv,
          observaciones: c.observaciones ?? "",
        }}
        itemsIniciales={(items ?? []).map((i) => ({
          articulo_id: i.articulo_id,
          proveedor_id: i.proveedor_id,
          descripcion: i.descripcion,
          detalle: i.detalle ?? "",
          unidad: i.unidad,
          cantidad: Number(i.cantidad),
          precio_costo: Number(i.precio_costo),
          // El descuento ya no existe: si una cotización antigua lo tenía, queda incluido en el precio
          precio_unitario: Number(i.descuento_pct)
            ? Math.round(Number(i.precio_unitario) * (1 - Number(i.descuento_pct) / 100) * 10000) / 10000
            : Number(i.precio_unitario),
          descuento_pct: 0,
          color: i.color ?? "",
          factor: i.factor === null || Number(i.descuento_pct) ? null : Number(i.factor),
          impresion_colores: Number(i.impresion_colores ?? 0),
        }))}
      />
    </>
  );
}
