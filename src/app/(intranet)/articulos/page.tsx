import type { Metadata } from "next";
import { ModuloPage } from "@/components/crud/ModuloPage";
import { getSesion } from "@/lib/sesion";
import { cpanelConfigurado } from "@/lib/cpanel";
import { PublicarWeb } from "./PublicarWeb";

export const metadata: Metadata = { title: "Artículos" };

export default async function Page({ searchParams }: PageProps<"/articulos">) {
  const { permisos } = await getSesion();
  return (
    <ModuloPage modKey="articulos" searchParams={await searchParams}
      extraActions={permisos.crea_articulo && cpanelConfigurado() ? <PublicarWeb /> : null} />
  );
}
