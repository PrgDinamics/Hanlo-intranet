import type { Metadata } from "next";
import { ModuloPage } from "@/components/crud/ModuloPage";
import { TraerTcBoton } from "@/components/externo/TraerTcBoton";
import { ResumenTc } from "@/components/externo/ResumenTc";
import { consultaHabilitada } from "@/lib/decolecta";

export const metadata: Metadata = { title: "Tipos de cambio" };

export default async function Page({ searchParams }: PageProps<"/configuracion/tipos-cambio">) {
  return (
    <ModuloPage
      modKey="tipos_cambio"
      searchParams={await searchParams}
      extraActions={consultaHabilitada() ? <TraerTcBoton /> : null}
      encabezado={<ResumenTc />}
    />
  );
}
