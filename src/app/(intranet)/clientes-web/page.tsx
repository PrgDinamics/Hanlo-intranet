import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePermiso } from "@/lib/sesion";
import { listarClientesWeb } from "@/lib/acciones-clientes-web";
import { ClientesWebAdmin } from "./ClientesWebAdmin";
import ui from "@/components/ui/ui.module.css";

export const metadata: Metadata = { title: "Clientes en la web" };
export const maxDuration = 60;

export default async function ClientesWebPage() {
  await requirePermiso("revistas");
  const estado = await listarClientesWeb();
  const dominio = estado.sitio.replace(/^https?:\/\//, "");
  return (
    <>
      <PageHeader
        title="Clientes en la web"
        subtitle={`Logos de la cinta "Empresas que confían en nosotros" de ${dominio}`}
      />
      {!estado.configurado ? (
        <div className={`${ui.card} ${ui.cardBody}`}>
          Falta conectar el cPanel de {dominio}: es la misma configuración de Revistas virtuales (CPANEL_URL, CPANEL_USUARIO y CPANEL_TOKEN en Vercel).
        </div>
      ) : (
        <ClientesWebAdmin sitio={estado.sitio} clientes={estado.clientes} errorInicial={estado.error ?? null} />
      )}
    </>
  );
}
