import { notFound } from "next/navigation";
import { Package } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { DetalleForm } from "@/components/crud/DetalleForm";
import { PreciosProveedor, type PrecioRow } from "@/components/crud/PreciosProveedor";
import { cargarRefs } from "@/components/crud/ModuloPage";
import { getSesion } from "@/lib/sesion";
import ui from "@/components/ui/ui.module.css";
import d from "@/components/crud/detalle.module.css";

export default async function ArticuloPage({ params }: PageProps<"/articulos/[id]">) {
  const { id } = await params;
  const { supabase, permisos } = await getSesion();
  const editable = permisos.crea_articulo;
  const [{ data: art }, { data: precios }, { data: provs }, refs] = await Promise.all([
    supabase.from("articulos").select("*").eq("id", id).maybeSingle(),
    supabase.from("articulo_proveedor").select("*, proveedor:proveedores(razon_social), colores:articulo_proveedor_color(color, stock)").eq("articulo_id", id)
      .order("preferido", { ascending: false }).order("precio_venta"),
    supabase.from("proveedores").select("id, razon_social").eq("activo", true).order("razon_social"),
    cargarRefs("articulos"),
  ]);
  if (!art) notFound();

  const rows: PrecioRow[] = (precios ?? []).map((p) => ({
    ...p,
    nombre: p.proveedor?.razon_social ?? "",
    colores: [...(p.colores ?? [])].sort((a: { stock: number }, b: { stock: number }) => Number(b.stock) - Number(a.stock)),
  }));

  return (
    <>
      <PageHeader
        back={{ href: "/articulos", label: "Catálogo de artículos" }}
        title={art.descripcion}
        subtitle={<span className={ui.mono}>{art.codigo}</span>}
      />
      <div className={d.layout}>
        <div className={ui.card}>
          <div className={ui.cardHead}><span className={ui.cardTitle}><Package /> Datos del artículo</span></div>
          <div className={ui.cardBody}>
            <DetalleForm modKey="articulos" registro={art} refs={refs} soloLectura={!editable} />
          </div>
        </div>
        <PreciosProveedor
          editable={editable}
          modo="articulo"
          fijoId={id}
          rows={rows}
          opciones={(provs ?? []).map((p) => ({ value: p.id, label: p.razon_social }))}
        />
      </div>
    </>
  );
}
