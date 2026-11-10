import { LogOut } from "lucide-react";
import { Sidebar } from "@/components/shell/Sidebar";
import { Buscador } from "@/components/shell/Buscador";
import { getSesion } from "@/lib/sesion";
import { cerrarSesion } from "@/app/login/actions";
import s from "@/components/shell/shell.module.css";
import ui from "@/components/ui/ui.module.css";

export default async function IntranetLayout({ children }: LayoutProps<"/">) {
  const { perfil, permisos } = await getSesion();
  const iniciales = (perfil.nombre || perfil.email || "?")
    .split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className={s.app}>
      <Sidebar esAdmin={permisos.es_admin} acciones={permisos.acciones} />
      <div className={s.main}>
        <header className={s.topbar}>
          <Buscador acciones={permisos.acciones} />
          <div className={s.user}>
            <span className={s.avatar}>{iniciales}</span>
            <span className={s.userText}>
              <strong>{perfil.nombre || perfil.email}</strong>
              <small>{perfil.rol_nombre}</small>
            </span>
          </div>
          <form action={cerrarSesion}>
            <button className={`${ui.btn} ${ui.ghost} ${ui.icon}`} title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOut />
            </button>
          </form>
        </header>
        <main className={s.content}>{children}</main>
      </div>
    </div>
  );
}
