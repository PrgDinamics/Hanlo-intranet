"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import ui from "./ui.module.css";

/** Caja de búsqueda que sincroniza ?q= en la URL (con debounce) */
export function SearchBox({ placeholder = "Buscar..." }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") === q) return;
      const next = new URLSearchParams(params);
      if (q) next.set("q", q);
      else next.delete("q");
      next.delete("p");
      router.replace(`${pathname}?${next}`);
    }, 300);
    return () => clearTimeout(t);
  }, [q, params, pathname, router]);

  return (
    <div className={ui.search}>
      <Search />
      <input className={ui.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

/** Select que sincroniza un parámetro de la URL */
export function FilterSelect({
  name, options, placeholder,
}: { name: string; options: { value: string; label: string }[]; placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      className={`${ui.input} ${ui.select}`}
      value={params.get(name) ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params);
        if (e.target.value) next.set(name, e.target.value);
        else next.delete(name);
        next.delete("p");
        router.replace(`${pathname}?${next}`);
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
