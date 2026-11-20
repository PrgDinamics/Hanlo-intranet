import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePermiso } from "@/lib/sesion";
import { estadoPortada } from "@/lib/acciones-portada-web";
import { PortadaAdmin } from "./PortadaAdmin";
import ui from "@/components/ui/ui.module.css";

export const metadata: Metadata = { title: "Portada de la web" };
export const maxDuration = 60;

export default async function PortadaPage() {
  await requirePermiso("revistas");
  const estado = await estadoPortada();
  const dominio = estado.sitio.replace(/^https?:\/\//, "");
  return (
    <>
      <PageHeader title="Portada de la web" subtitle={`Las 5 imágenes y la etiqueta del lado derecho de la portada de ${dominio}`} />
      {!estado.configurado ? (
        <div className={`${ui.card} ${ui.cardBody}`}>
          Falta conectar el cPanel de {dominio}: es la misma configuración de Revistas virtuales (CPANEL_URL, CPANEL_USUARIO y CPANEL_TOKEN en Vercel).
        </div>
      ) : (
        <PortadaAdmin sitio={estado.sitio} portada={estado.portada} revistas={estado.revistas} errorInicial={estado.error ?? null} />
      )}
    </>
  );
}
