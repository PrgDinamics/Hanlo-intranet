import { notFound } from "next/navigation";
import { Truck } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { DetalleForm } from "@/components/crud/DetalleForm";
import { PreciosProveedor, type PrecioRow } from "@/components/crud/PreciosProveedor";
import { getSesion } from "@/lib/sesion";
import { consultaHabilitada } from "@/lib/decolecta";
import ui from "@/components/ui/ui.module.css";
import d from "@/components/crud/detalle.module.css";

export default async function ProveedorPage({ params }: PageProps<"/proveedores/[id]">) {
  const { id } = await params;
  const { supabase, permisos } = await getSesion();
  const editable = permisos.crea_articulo;
  const [{ data: prov }, { data: precios }, { data: arts }] = await Promise.all([
    supabase.from("proveedores").select("*").eq("id", id).maybeSingle(),
    supabase.from("articulo_proveedor").select("*, articulo:articulos(codigo, descripcion)").eq("proveedor_id", id),
    supabase.from("articulos").select("id, codigo, descripcion").eq("activo", true).order("descripcion"),
  ]);
  if (!prov) notFound();

  const rows: PrecioRow[] = (precios ?? [])
    .map((p) => ({ ...p, nombre: p.articulo?.descripcion ?? "", codigo: p.articulo?.codigo }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return (
    <>
      <PageHeader
        back={{ href: "/proveedores", label: "Proveedores" }}
        title={prov.razon_social}
        subtitle={<>RUC <span className={ui.mono}>{prov.ruc}</span></>}
      />
      <div className={d.layout}>
        <div className={ui.card}>
          <div className={ui.cardHead}><span className={ui.cardTitle}><Truck /> Datos del proveedor</span></div>
          <div className={ui.cardBody}>
            <DetalleForm modKey="proveedores" registro={prov} refs={{}} consulta={consultaHabilitada()} soloLectura={!editable} />
          </div>
        </div>
        <PreciosProveedor
          editable={editable}
          modo="proveedor"
          fijoId={id}
          rows={rows}
          opciones={(arts ?? []).map((a) => ({ value: a.id, label: `${a.codigo} · ${a.descripcion}` }))}
        />
      </div>
    </>
  );
}
