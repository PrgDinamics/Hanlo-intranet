import type { Metadata } from "next";
import { Logo } from "@/components/ui/Logo";
import { LoginForm } from "./LoginForm";
import s from "./login.module.css";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const aviso = sp.error === "inactivo" ? "Tu usuario está desactivado. Consulta con el administrador." : undefined;
  return (
    <main className={s.wrap}>
      <section className={s.side}>
        <div className={s.brand}>
          <Logo tam={30} />
        </div>
        <div>
          <h2 className={s.claim}>Cotiza más rápido.<br /><em>Haz seguimiento</em> a cada propuesta.</h2>
          <p className={s.claimSub}>Catálogo, proveedores, clientes y cotizaciones en un solo lugar.</p>
        </div>
        <small className={s.foot}>Intranet comercial</small>
      </section>
      <section className={s.formSide}>
        <div className={s.box}>
          <h1 className={s.title}>Bienvenido</h1>
          <p className={s.sub}>Ingresa con tu cuenta para continuar</p>
          <LoginForm next={next} aviso={aviso} />
        </div>
      </section>
    </main>
  );
}
