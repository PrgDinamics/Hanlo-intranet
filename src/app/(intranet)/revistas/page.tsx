import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePermiso } from "@/lib/sesion";
import { listarRevistas } from "@/lib/acciones-revistas";
import { RevistasAdmin } from "./RevistasAdmin";
import ui from "@/components/ui/ui.module.css";
import s from "./revistas.module.css";

export const metadata: Metadata = { title: "Revistas" };
export const maxDuration = 60;

export default async function RevistasPage() {
  await requirePermiso("revistas");
  const estado = await listarRevistas();
  const dominio = estado.sitio.replace(/^https?:\/\//, "");
  return (
    <>
      <PageHeader
        title="Revistas virtuales"
        subtitle={`Sube el PDF de la campaña y queda publicado en ${dominio}/revistas/nombre, listo para compartir`}
      />
      {!estado.configurado ? (
        <div className={ui.card}>
          <div className={ui.cardBody}>
            <h3 className={s.h3}>Falta conectar el cPanel de la web</h3>
            <p className={s.p}>Las revistas se guardan en el cPanel de {dominio}. Se configura una sola vez:</p>
            <ol className={s.pasos}>
              <li>En el cPanel, entra a <b>Seguridad &gt; Manage API Tokens</b>, crea un token (ej. &quot;intranet-revistas&quot;) y copia el código.</li>
              <li>En Vercel, en <b>Settings &gt; Environment Variables</b>, agrega <code>CPANEL_URL</code> (ej. https://{dominio}:2083), <code>CPANEL_USUARIO</code> y <code>CPANEL_TOKEN</code>. Luego haz Redeploy.</li>
            </ol>
          </div>
        </div>
      ) : (
        <RevistasAdmin sitio={estado.sitio} revistas={estado.revistas} errorInicial={estado.error ?? null} />
      )}
    </>
  );
}
