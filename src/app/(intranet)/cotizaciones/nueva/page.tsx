import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Editor } from "@/components/cotizacion/Editor";
import { cargarDatosEditor } from "@/components/cotizacion/datos";
import { hoyLima } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";

export const metadata: Metadata = { title: "Nueva cotización" };

export default async function NuevaPage({ searchParams }: PageProps<"/cotizaciones/nueva">) {
  const sp = await searchParams;
  const datos = await cargarDatosEditor();
  if (!datos.empresas.length) {
    return (
      <>
        <PageHeader title="Nueva cotización" back={{ href: "/cotizaciones", label: "Cotizaciones" }} />
        <div className={`${ui.card} ${ui.cardBody}`}>
          Primero registra una empresa en <Link href="/configuracion/empresas" style={{ color: "var(--brand-ink)" }}>Configuración · Empresas</Link>.
        </div>
      </>
    );
  }
  const clienteId = typeof sp.cliente === "string" ? sp.cliente : "";
  const cliente = datos.clientes.find((c) => c.id === clienteId);

  return (
    <>
      <PageHeader title="Nueva cotización" back={{ href: "/cotizaciones", label: "Cotizaciones" }} />
      <Editor
        datos={datos}
        estado="nueva"
        itemsIniciales={[]}
        inicial={{
          id: null,
          empresa_id: datos.empresas[0].id,
          cliente_id: cliente?.id ?? "",
          agente_id: datos.agenteUsuario ?? cliente?.agente_id ?? null,
          moneda: "PEN",
          tipo_cambio: datos.tipoCambio,
          forma_pago_id: datos.formas[0]?.id ?? null,
          lugar: "Lima",
          fecha_emision: hoyLima(),
          validez_dias: 15,
          tiempo_entrega: "",
          precios_incluyen_igv: false,
          observaciones: "",
        }}
      />
    </>
  );
}
