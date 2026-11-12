"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeftRight, BarChart3, BookOpen, BriefcaseBusiness, Building2, CreditCard, FileText, Layers, LayoutDashboard,
  FileUp, History, Menu, Package, ShieldCheck, Truck, UserCog, Users, X,
} from "lucide-react";
import s from "./shell.module.css";
import { Logo } from "@/components/ui/Logo";
import type { Permiso } from "@/lib/permisos";

type ItemNav = { href: string; label: string; icon: React.ElementType; permiso?: Permiso; admin?: boolean };

const NAV: { grupo: string; items: ItemNav[] }[] = [
  {
    grupo: "Principal",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/cotizaciones", label: "Cotizaciones", icon: FileText },
      { href: "/reportes", label: "Reportes", icon: BarChart3, permiso: "reportes" },
    ],
  },
  {
    grupo: "Maestros",
    items: [
      { href: "/clientes", label: "Clientes", icon: Users },
      { href: "/articulos", label: "Artículos", icon: Package },
      { href: "/proveedores", label: "Proveedores", icon: Truck },
      { href: "/lineas", label: "Líneas de artículos", icon: Layers },
    ],
  },
  {
    grupo: "Web",
    items: [
      { href: "/revistas", label: "Revistas virtuales", icon: BookOpen, permiso: "revistas" },
    ],
  },
  {
    grupo: "Configuración",
    items: [
      { href: "/configuracion/empresas", label: "Empresas", icon: Building2, permiso: "empresas" },
      { href: "/configuracion/usuarios", label: "Usuarios", icon: UserCog, admin: true },
      { href: "/configuracion/roles", label: "Roles y permisos", icon: ShieldCheck, admin: true },
      { href: "/configuracion/agentes", label: "Agentes comerciales", icon: BriefcaseBusiness, admin: true },
      { href: "/configuracion/tipos-cambio", label: "Tipos de cambio", icon: ArrowLeftRight, permiso: "tipos_cambio" },
      { href: "/configuracion/formas-pago", label: "Formas de pago", icon: CreditCard, permiso: "formas_pago" },
      { href: "/configuracion/importar", label: "Importar desde Excel", icon: FileUp, permiso: "importar" },
      { href: "/configuracion/actividad", label: "Registro de actividad", icon: History, permiso: "actividad" },
    ],
  },
];

export function Sidebar({ esAdmin, acciones }: { esAdmin: boolean; acciones: Permiso[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Cada opción se muestra según el rol: las de "admin" solo al Administrador
  const visible = (i: ItemNav) => esAdmin || (!i.admin && (!i.permiso || acciones.includes(i.permiso)));
  const grupos = NAV.map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length);
  const activo = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      <button className={s.burger} onClick={() => setOpen(true)} aria-label="Abrir menú">
        <Menu />
      </button>
      {open && <div className={s.scrim} onClick={() => setOpen(false)} />}
      <aside className={`${s.sidebar} ${open ? s.sidebarOpen : ""}`}>
        <div className={s.brand}>
          <Logo tam={19} />
          <div className={s.brandText}>
            <small>Intranet</small>
            <strong>Comercial</strong>
          </div>
          <button className={s.close} onClick={() => setOpen(false)} aria-label="Cerrar menú"><X /></button>
        </div>
        <nav className={s.nav}>
          {grupos.map((g) => (
            <div key={g.grupo} className={s.group}>
              <div className={s.groupLabel}>{g.grupo}</div>
              {g.items.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`${s.link} ${activo(href) ? s.linkActive : ""}`}
                >
                  <Icon /> {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
