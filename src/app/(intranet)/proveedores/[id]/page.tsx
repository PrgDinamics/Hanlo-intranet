import { notFound } from "next/navigation";
import { Truck } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { DetalleForm } from "@/components/crud/DetalleForm";
import { PreciosProveedor, type PrecioRow } from "@/components/crud/PreciosProveedor";
import { getSesion } from "@/lib/sesion";
import { consultaHabilitada } from "@/lib/decolecta";
import { todasLasFilas } from "@/lib/consultas";
import ui from "@/components/ui/ui.module.css";
import d from "@/components/crud/detalle.module.css";

export default async function ProveedorPage({ params }: PageProps<"/proveedores/[id]">) {
  const { id } = await params;
  const { supabase, permisos } = await getSesion();
  const editable = permisos.crea_articulo;
  // La base entrega de a 1,000 filas: un proveedor puede tener más artículos, se traen todos por páginas
  const [{ data: prov }, precios, arts] = await Promise.all([
    supabase.from("proveedores").select("*").eq("id", id).maybeSingle(),
    todasLasFilas((a, b) => supabase.from("articulo_proveedor").select("*, articulo:articulos(codigo, descripcion)")
      .eq("proveedor_id", id).order("id").range(a, b)),
    todasLasFilas((a, b) => supabase.from("articulos").select("id, codigo, descripcion").eq("activo", true)
      .order("descripcion").order("id").range(a, b)),
  ]);
  if (!prov) notFound();

  const rows: PrecioRow[] = (precios as (PrecioRow & { articulo?: { codigo: string; descripcion: string } | null })[])
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
          opciones={(arts as { id: string; codigo: string; descripcion: string }[]).map((a) => ({ value: a.id, label: `${a.codigo} · ${a.descripcion}` }))}
        />
      </div>
    </>
  );
}
