"use server";

import { getSesion } from "@/lib/sesion";
import { filtroNumero } from "@/lib/consultas";

export type ResultadoBusqueda = {
  tipo: "cotizacion" | "cliente" | "articulo" | "proveedor";
  id: string;
  titulo: string;
  sub: string;
  href: string;
  estado?: string;
};

/** Búsqueda global para la paleta Ctrl+K */
export async function buscarGlobal(q: string): Promise<ResultadoBusqueda[]> {
  const { supabase } = await getSesion();
  const t = q.trim().replace(/[%,()]/g, " ");
  if (t.length < 2) return [];
  const like = `%${t}%`;

  const [cot, cli, art, prov] = await Promise.all([
    supabase
      .from("v_cotizaciones")
      .select("id, codigo, cliente_nombre, total, moneda, estado, fecha_emision")
      .or([`cliente_nombre.ilike.${like}`, filtroNumero(t)].filter(Boolean).join(","))
      .neq("estado", "reemplazada")
      .order("fecha_emision", { ascending: false })
      .limit(5),
    supabase.from("clientes").select("id, nombre, num_doc, tipo_doc").or(`nombre.ilike.${like},num_doc.ilike.${like}`).limit(5),
    supabase.from("articulos").select("id, codigo, descripcion").or(`descripcion.ilike.${like},codigo.ilike.${like}`).limit(5),
    supabase.from("proveedores").select("id, razon_social, ruc").or(`razon_social.ilike.${like},ruc.ilike.${like}`).limit(4),
  ]);

  // Si un grupo falla se registra en el servidor y se muestran los demás
  for (const [grupo, r] of [["cotizaciones", cot], ["clientes", cli], ["artículos", art], ["proveedores", prov]] as const) {
    if (r.error) console.error(`buscarGlobal (${grupo}):`, r.error.message);
  }

  const money = (v: number, m: string) => `${m === "USD" ? "US$" : "S/"} ${Number(v).toLocaleString("es-PE", { minimumFractionDigits: 2 })}`;
  return [
    ...(cot.data ?? []).map((c) => ({
      tipo: "cotizacion" as const, id: c.id, titulo: c.codigo, sub: `${c.cliente_nombre} · ${money(c.total, c.moneda)}`,
      href: `/cotizaciones/${c.id}`, estado: c.estado,
    })),
    ...(cli.data ?? []).map((c) => ({ tipo: "cliente" as const, id: c.id, titulo: c.nombre, sub: `${c.tipo_doc} ${c.num_doc}`, href: `/clientes/${c.id}` })),
    ...(art.data ?? []).map((a) => ({ tipo: "articulo" as const, id: a.id, titulo: a.descripcion, sub: a.codigo, href: `/articulos/${a.id}` })),
    ...(prov.data ?? []).map((p) => ({ tipo: "proveedor" as const, id: p.id, titulo: p.razon_social, sub: `RUC ${p.ruc}`, href: `/proveedores/${p.id}` })),
  ];
}

export type UltimoPrecio = { precio: number; moneda: "PEN" | "USD"; fecha: string; codigo: string; estado: string };

/** Último precio cotizado a un cliente por cada artículo */
export async function ultimosPreciosCliente(clienteId: string): Promise<Record<string, UltimoPrecio>> {
  const { supabase } = await getSesion();
  if (!clienteId) return {};
  const { data } = await supabase.rpc("ultimos_precios_cliente", { p_cliente: clienteId });
  const out: Record<string, UltimoPrecio> = {};
  for (const r of (data ?? []) as { articulo_id: string; precio_unitario: number; moneda: "PEN" | "USD"; fecha: string; codigo: string; estado: string }[]) {
    out[r.articulo_id] = { precio: Number(r.precio_unitario), moneda: r.moneda, fecha: r.fecha, codigo: r.codigo, estado: r.estado };
  }
  return out;
}
