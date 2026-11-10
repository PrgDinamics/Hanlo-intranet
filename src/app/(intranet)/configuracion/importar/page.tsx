import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePermiso } from "@/lib/sesion";
import { consultaHabilitada } from "@/lib/decolecta";
import { Importador } from "./Importador";
import { ListaProveedor } from "./ListaProveedor";
import { Pestanas } from "@/components/reportes/Pestanas";
import ui from "@/components/ui/ui.module.css";

export const metadata: Metadata = { title: "Importar datos" };
// Las listas de proveedores traen cientos de fotos: se da más tiempo al servidor
export const maxDuration = 300;

export default async function ImportarPage() {
  const { supabase } = await requirePermiso("importar");
  const primera = await supabase
    .from("proveedores").select("id, razon_social, ruc, precios_incluyen_igv").eq("activo", true).order("razon_social");
  let proveedores = primera.data;
  const error = primera.error;
  // Si falta la migración del IGV por proveedor, igual se listan los proveedores
  const faltaMigracion = !!error;
  if (error) {
    ({ data: proveedores } = await supabase
      .from("proveedores").select("id, razon_social, ruc").eq("activo", true).order("razon_social") as unknown as { data: typeof proveedores });
  }
  return (
    <>
      <PageHeader
        title="Importar datos desde Excel"
        subtitle="Listas de stock de proveedores (precios y stock por color) y carga inicial de clientes, proveedores y artículos"
      />
      {faltaMigracion && (
        <div className={ui.alert} style={{ marginBottom: 14 }}>
          Falta correr en Supabase la migración 20261030000000_igv_por_proveedor.sql: no se podrá recordar el IGV de cada proveedor.
        </div>
      )}
      <div className={ui.card}>
        <Pestanas
          tabs={[
            {
              id: "lista",
              label: "Lista de stock de proveedor",
              contenido: (
                <div className={ui.cardBody}>
                  <ListaProveedor
                    proveedores={(proveedores ?? []).map((p) => ({ value: p.id, label: p.razon_social, sub: p.ruc }))}
                    consulta={consultaHabilitada()}
                    igvProveedor={Object.fromEntries((proveedores ?? []).map((p) => [p.id, (p as { precios_incluyen_igv?: boolean | null }).precios_incluyen_igv ?? null]))}
                  />
                </div>
              ),
            },
            {
              id: "inicial",
              label: "Carga inicial (formato de la empresa)",
              contenido: <div className={ui.cardBody}><Importador /></div>,
            },
          ]}
        />
      </div>
    </>
  );
}
