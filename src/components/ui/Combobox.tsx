"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import ui from "./ui.module.css";
import s from "./Combobox.module.css";

export type ComboOpcion = { value: string; label: string; sub?: string };

/** Select con búsqueda para listas largas (clientes, artículos) */
export function Combobox({
  options, value, onChange, placeholder = "Buscar...", invalid,
}: {
  options: ComboOpcion[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const sel = options.find((o) => o.value === value);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = t ? options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(t)) : options;
    return base.slice(0, 60);
  }, [q, options]);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const elegir = (o: ComboOpcion) => {
    onChange(o.value);
    setOpen(false);
    setQ("");
  };

  return (
    <div className={s.wrap} ref={ref}>
      <input
        className={`${ui.input} ${s.input}`}
        style={invalid ? { borderColor: "var(--danger)" } : undefined}
        value={open ? q : sel ? `${sel.label}${sel.sub ? ` · ${sel.sub}` : ""}` : ""}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setHi(0); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, filtradas.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === "Enter" && open && filtradas[hi]) { e.preventDefault(); elegir(filtradas[hi]); }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <ChevronsUpDown className={s.chev} />
      {open && (
        <ul className={s.list}>
          {filtradas.length === 0 && <li className={s.none}>Sin resultados</li>}
          {filtradas.map((o, i) => (
            <li
              key={o.value}
              className={`${s.opt} ${i === hi ? s.hi : ""} ${o.value === value ? s.sel : ""}`}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => { e.preventDefault(); elegir(o); }}
            >
              <span>{o.label}</span>
              {o.sub && <small>{o.sub}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
