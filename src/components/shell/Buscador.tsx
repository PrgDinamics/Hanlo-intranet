"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, BarChart3, CornerDownLeft, FileText, Package, Plus, Search, Truck, User, Users,
} from "lucide-react";
import { buscarGlobal, type ResultadoBusqueda } from "@/lib/acciones-busqueda";
import type { Permiso } from "@/lib/permisos";
import { EstadoBadge } from "@/components/ui/Badge";
import s from "./buscador.module.css";

type Item = { permiso?: Permiso; key: string; titulo: string; sub?: string; href: string; icon: React.ElementType; estado?: string; grupo: string };

const ACCIONES: Item[] = [
  { key: "a1", titulo: "Nueva cotización", href: "/cotizaciones/nueva", icon: Plus, grupo: "Acciones" },
  { key: "a2", titulo: "Ver cotizaciones", href: "/cotizaciones", icon: FileText, grupo: "Acciones" },
  { key: "a3", titulo: "Clientes", href: "/clientes", icon: Users, grupo: "Acciones" },
  { key: "a4", titulo: "Catálogo de artículos", href: "/articulos", icon: Package, grupo: "Acciones" },
  { key: "a5", titulo: "Reportes", href: "/reportes", icon: BarChart3, grupo: "Acciones", permiso: "reportes" },
];
const ICONOS = { cotizacion: FileText, cliente: User, articulo: Package, proveedor: Truck };
const GRUPOS = { cotizacion: "Cotizaciones", cliente: "Clientes", articulo: "Artículos", proveedor: "Proveedores" };

/** Paleta de búsqueda global (Ctrl+K / ⌘K) */
export function Buscador({ acciones: permisosRol = [] }: { acciones?: Permiso[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<ResultadoBusqueda[]>([]);
  const [hi, setHi] = useState(0);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  const buscar = (texto: string) => {
    setQ(texto);
    setHi(0);
    const id = ++reqId.current;
    if (texto.trim().length < 2) return setRes([]);
    start(async () => {
      const r = await buscarGlobal(texto);
      if (id === reqId.current) setRes(r);
    });
  };

  const items: Item[] = useMemo(() => {
    const t = q.trim().toLowerCase();
    const permitidas = ACCIONES.filter((a) => !a.permiso || permisosRol.includes(a.permiso));
    const acciones = t ? permitidas.filter((a) => a.titulo.toLowerCase().includes(t)) : permitidas;
    return [
      ...res.map((r) => ({ key: r.tipo + r.id, titulo: r.titulo, sub: r.sub, href: r.href, icon: ICONOS[r.tipo], estado: r.estado, grupo: GRUPOS[r.tipo] })),
      ...acciones,
    ];
  }, [res, q, permisosRol]);

  const ir = (it: Item) => {
    setOpen(false);
    setQ("");
    setRes([]);
    router.push(it.href);
  };

  return (
    <>
      <button className={s.trigger} onClick={() => setOpen(true)}>
        <Search />
        <span>Buscar cotización, cliente, artículo...</span>
        <kbd>Ctrl K</kbd>
      </button>
      {open && (
        <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className={s.panel} role="dialog" aria-label="Búsqueda">
            <div className={s.inputRow}>
              <Search />
              <input
                ref={inputRef}
                value={q}
                placeholder="Escribe un cliente, RUC, código de artículo o número de cotización"
                onChange={(e) => buscar(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, items.length - 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
                  if (e.key === "Enter" && items[hi]) { e.preventDefault(); ir(items[hi]); }
                }}
              />
              {pending && <span className={s.cargando} />}
            </div>
            <ul className={s.lista}>
              {q.trim().length >= 2 && !pending && res.length === 0 && (
                <li className={s.vacio}>Sin resultados para “{q}”</li>
              )}
              {items.map((it, i) => {
                const Icon = it.icon;
                const nuevoGrupo = i === 0 || items[i - 1].grupo !== it.grupo;
                return (
                  <li key={it.key}>
                    {nuevoGrupo && <div className={s.grupo}>{it.grupo}</div>}
                    <button
                      className={`${s.item} ${i === hi ? s.itemHi : ""}`}
                      onMouseEnter={() => setHi(i)}
                      onClick={() => ir(it)}
                    >
                      <Icon className={s.icon} />
                      <span className={s.texto}>
                        <strong>{it.titulo}</strong>
                        {it.sub && <small>{it.sub}</small>}
                      </span>
                      {it.estado && <EstadoBadge estado={it.estado} />}
                      {i === hi ? <CornerDownLeft className={s.enter} /> : <ArrowRight className={s.enter} style={{ opacity: 0 }} />}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className={s.pie}>
              <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
              <span><kbd>Enter</kbd> abrir</span>
              <span><kbd>Esc</kbd> cerrar</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
