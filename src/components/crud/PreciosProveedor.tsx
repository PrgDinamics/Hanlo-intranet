"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Pencil, Plus, Star, Tags, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Empty } from "@/components/ui/Empty";
import { Badge } from "@/components/ui/Badge";
import { guardarPrecio, eliminarPrecio, type PrecioInput } from "@/lib/acciones-precios";
import { fecha, money, num } from "@/lib/format";
import type { Opcion } from "@/lib/modulos";
import ui from "@/components/ui/ui.module.css";

export type PrecioRow = {
  id: string;
  articulo_id: string;
  proveedor_id: string;
  precio_compra: number;
  precio_venta: number;
  precio_ciento: number | null;
  precio_millar: number | null;
  desde_ciento: number;
  desde_millar: number;
  stock: number | null;
  stock_al: string | null;
  colores?: { color: string; stock: number }[];
  moneda: "PEN" | "USD";
  preferido: boolean;
  nombre: string; // proveedor o artículo, según el modo
  codigo?: string;
};

/**
 * modo "articulo": estamos en un artículo, se listan sus proveedores.
 * modo "proveedor": estamos en un proveedor, se listan los artículos que provee.
 */
export function PreciosProveedor({
  modo, fijoId, rows, opciones, editable = true,
}: { modo: "articulo" | "proveedor"; fijoId: string; rows: PrecioRow[]; opciones: Opcion[]; editable?: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<PrecioInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const otro = modo === "articulo" ? "Proveedor" : "Artículo";

  const nuevo = () => {
    setError(null);
    setForm({
      id: null,
      articulo_id: modo === "articulo" ? fijoId : "",
      proveedor_id: modo === "proveedor" ? fijoId : "",
      precio_compra: 0,
      precio_venta: 0,
      precio_ciento: null,
      precio_millar: null,
      desde_ciento: 50,
      desde_millar: 500,
      moneda: "PEN",
      preferido: rows.length === 0,
    });
  };

  const guardar = () => {
    if (!form) return;
    start(async () => {
      const r = await guardarPrecio(form);
      if (!r.ok) return setError(r.error);
      setForm(null);
      router.refresh();
    });
  };

  const borrar = (id: string) => {
    if (!confirm("¿Quitar este precio?")) return;
    start(async () => {
      const r = await eliminarPrecio(id);
      if (!r.ok) alert(r.error);
      router.refresh();
    });
  };

  const margen = (c: number, v: number) => (c > 0 ? ((v - c) / c) * 100 : null);
  const setF = (k: keyof PrecioInput, v: unknown) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className={ui.card}>
      <div className={ui.cardHead}>
        <span className={ui.cardTitle}>
          <Tags /> {modo === "articulo" ? "Proveedores y precios" : "Artículos que provee"}
        </span>
        {editable && <button className={`${ui.btn} ${ui.sm}`} onClick={nuevo}><Plus /> Agregar</button>}
      </div>
      {rows.length === 0 ? (
        <Empty>
          {modo === "articulo"
            ? "Agrega los proveedores que ofrecen este artículo y su precio de venta"
            : "Aún no se registran artículos para este proveedor"}
        </Empty>
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>{otro}</th>
                <th className={ui.num}>Muestra</th>
                <th className={ui.num}>x Ciento</th>
                <th className={ui.num}>x Millar</th>
                <th className={ui.num}>Stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = margen(Number(r.precio_compra), Number(r.precio_venta));
                const href = modo === "articulo" ? `/proveedores/${r.proveedor_id}` : `/articulos/${r.articulo_id}`;
                return (
                  <Fragment key={r.id}>
                  <tr>
                    <td>
                      <div className={ui.row} style={{ gap: 8 }}>
                        <Link href={href} className={ui.strong}>
                          {r.codigo && <span className={`${ui.mono} ${ui.muted}`}>{r.codigo} · </span>}
                          {r.nombre}
                        </Link>
                        {r.preferido && <Badge tono="warn">Preferido</Badge>}
                      </div>
                    </td>
                    <td className={`${ui.num} ${ui.strong}`}>
                      {Number(r.precio_venta) > 0 ? money(r.precio_venta, r.moneda) : ""}
                      {m !== null && <div className={ui.muted} style={{ fontWeight: 400, fontSize: 12 }}>costo {money(r.precio_compra, r.moneda)}</div>}
                    </td>
                    <td className={ui.num}>
                      {Number(r.precio_ciento) > 0 && <>{money(r.precio_ciento, r.moneda)}<div className={ui.muted} style={{ fontSize: 12 }}>desde {r.desde_ciento}</div></>}
                    </td>
                    <td className={ui.num}>
                      {Number(r.precio_millar) > 0 && <>{money(r.precio_millar, r.moneda)}<div className={ui.muted} style={{ fontSize: 12 }}>desde {r.desde_millar}</div></>}
                    </td>
                    <td className={ui.num}>
                      {r.stock != null && (
                        <>
                          <strong>{num(r.stock, 0)}</strong>
                          {r.stock_al && <div className={ui.muted} style={{ fontSize: 12 }}>al {fecha(r.stock_al.slice(0, 10))}</div>}
                        </>
                      )}
                    </td>
                    <td className={ui.num}>
                      {editable && <>
                      <button className={`${ui.btn} ${ui.ghost} ${ui.icon}`} title="Editar"
                        onClick={() => { setError(null); setForm({ id: r.id, articulo_id: r.articulo_id, proveedor_id: r.proveedor_id, precio_compra: Number(r.precio_compra), precio_venta: Number(r.precio_venta), precio_ciento: r.precio_ciento == null ? null : Number(r.precio_ciento), precio_millar: r.precio_millar == null ? null : Number(r.precio_millar), desde_ciento: r.desde_ciento ?? 50, desde_millar: r.desde_millar ?? 500, moneda: r.moneda, preferido: r.preferido }); }}>
                        <Pencil />
                      </button>
                      <button className={`${ui.btn} ${ui.ghost} ${ui.icon}`} title="Quitar" onClick={() => borrar(r.id)} disabled={pending}>
                        <Trash2 />
                      </button>
                      </>}
                    </td>
                  </tr>
                  {r.colores && r.colores.length > 0 && (
                    <tr>
                      <td colSpan={6} style={{ paddingTop: 0 }}>
                        <div className={ui.row} style={{ flexWrap: "wrap", gap: 5 }}>
                          {r.colores.map((c) => (
                            <span key={c.color} className={`${ui.badge} ${Number(c.stock) > 0 ? ui.b_muted : ui.b_danger}`} style={{ fontWeight: 400 }}>
                              {c.color} · {num(c.stock, 0)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Editar precio" : "Agregar precio"}
        width={520}
        footer={
          <>
            <button className={ui.btn} onClick={() => setForm(null)}>Cancelar</button>
            <button className={`${ui.btn} ${ui.primary}`} onClick={guardar} disabled={pending}>
              {pending ? "Guardando..." : "Guardar"}
            </button>
          </>
        }
      >
        {form && (
          <div className={ui.stack}>
            {error && <div className={ui.alert}><AlertCircle /> {error}</div>}
            <div className={ui.grid}>
              <label className={`${ui.field} ${ui.span12}`}>
                <span className={`${ui.label} ${ui.req}`}>{otro}</span>
                <select
                  className={ui.input}
                  value={modo === "articulo" ? form.proveedor_id : form.articulo_id}
                  disabled={!!form.id}
                  onChange={(e) => setF(modo === "articulo" ? "proveedor_id" : "articulo_id", e.target.value)}
                >
                  <option value="">Selecciona...</option>
                  {opciones.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className={`${ui.field} ${ui.span4}`}>
                <span className={ui.label}>Moneda</span>
                <select className={ui.input} value={form.moneda} onChange={(e) => setF("moneda", e.target.value)}>
                  <option value="PEN">Soles (S/)</option>
                  <option value="USD">Dólares (US$)</option>
                </select>
              </label>
              <label className={`${ui.field} ${ui.span4}`}>
                <span className={ui.label}>Costo unit. (opcional)</span>
                <input className={ui.input} type="number" step="0.0001" min="0" value={form.precio_compra}
                  onChange={(e) => setF("precio_compra", Number(e.target.value))} />
              </label>
              <label className={`${ui.field} ${ui.span4}`}>
                <span className={ui.label}>Precio muestra (unit.)</span>
                <input className={ui.input} type="number" step="0.0001" min="0" value={form.precio_venta}
                  onChange={(e) => setF("precio_venta", Number(e.target.value))} />
              </label>
              <label className={`${ui.field} ${ui.span4}`}>
                <span className={ui.label}>Precio x ciento</span>
                <input className={ui.input} type="number" step="0.01" min="0" value={form.precio_ciento ?? ""}
                  onChange={(e) => setF("precio_ciento", e.target.value ? Number(e.target.value) : null)} />
              </label>
              <label className={`${ui.field} ${ui.span4}`}>
                <span className={ui.label}>Desde (unid.)</span>
                <input className={ui.input} type="number" min="1" value={form.desde_ciento}
                  onChange={(e) => setF("desde_ciento", Number(e.target.value))} />
              </label>
              <label className={`${ui.field} ${ui.span4}`}>
                <span className={ui.label}>Precio x millar</span>
                <input className={ui.input} type="number" step="0.01" min="0" value={form.precio_millar ?? ""}
                  onChange={(e) => setF("precio_millar", e.target.value ? Number(e.target.value) : null)} />
              </label>
              <label className={`${ui.field} ${ui.span4}`}>
                <span className={ui.label}>Desde (unid.)</span>
                <input className={ui.input} type="number" min="1" value={form.desde_millar}
                  onChange={(e) => setF("desde_millar", Number(e.target.value))} />
              </label>
              <p className={`${ui.span12} ${ui.hint}`}>
                Precios sin IGV. El de ciento es por 100 unidades y el de millar por 1000; la cotización usa el que corresponda a la cantidad.
              </p>
              <div className={ui.span12}>
                <label className={ui.check}>
                  <input type="checkbox" checked={form.preferido} onChange={(e) => setF("preferido", e.target.checked)} />
                  <Star size={14} /> Proveedor preferido (se sugiere primero al cotizar)
                </label>
              </div>
              {form.precio_compra > 0 && (
                <div className={`${ui.span12} ${ui.hint}`}>
                  Margen: {num(margen(form.precio_compra, form.precio_venta) ?? 0, 1)}%
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
