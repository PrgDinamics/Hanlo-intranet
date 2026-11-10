"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, AlignLeft, FileCheck2, History, UserPlus, PackagePlus, Plus, Save, Search, Star, Trash2, Truck,
} from "lucide-react";
import { Combobox } from "@/components/ui/Combobox";
import { Modal } from "@/components/ui/Modal";
import { Empty } from "@/components/ui/Empty";
import { cambiarEstado, guardarCotizacion, type CabeceraInput, type Faltante, type ItemInput } from "@/lib/acciones-cotizaciones";
import { AvisoStock } from "./AvisoStock";
import { ultimosPreciosCliente, type UltimoPrecio } from "@/lib/acciones-busqueda";
import { buscarCatalogo } from "@/lib/acciones-catalogo";
import { RegistroForm } from "@/components/crud/RegistroForm";
import { convertir, fecha, money, num, round, SIMBOLO, type Moneda } from "@/lib/format";
import {
  aCotizacion, costoMaximo, FACTORES_DEFECTO, parseFactores, precioPorCantidad, TRAMO_LABEL, ventaConFactor,
  type ContextoPrecio,
} from "@/lib/precios";
import { UNIDADES } from "@/lib/modulos";
import type { ArticuloCat, DatosEditor, PrecioCat } from "./datos";
import { FotoZoom } from "@/components/ui/FotoZoom";
import ui from "@/components/ui/ui.module.css";
import s from "./editor.module.css";

export type ItemState = ItemInput & { key: string; verDetalle?: boolean };

let seq = 0;
const nuevaKey = () => `i${Date.now()}${seq++}`;

export function Editor({
  datos, inicial, itemsIniciales, estado,
}: {
  datos: DatosEditor;
  inicial: CabeceraInput;
  itemsIniciales: ItemInput[];
  estado: string; // "nueva" | borrador | emitida
}) {
  const router = useRouter();
  const [cab, setCab] = useState<CabeceraInput>(inicial);
  const [items, setItems] = useState<ItemState[]>(() => itemsIniciales.map((i) => ({ ...i, key: nuevaKey() })));
  const [catalogo, setCatalogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intentado, setIntentado] = useState(false);
  const [pending, start] = useTransition();
  // Evita guardar dos veces con un doble clic (antes de que el botón alcance a deshabilitarse)
  const enviando = useRef(false);

  const [nuevoCliente, setNuevoCliente] = useState(false);
  // Stock insuficiente al emitir: la cotización ya quedó guardada como borrador
  const [stockAviso, setStockAviso] = useState<{ id: string; faltantes: Faltante[] } | null>(null);
  const [ultimos, setUltimos] = useState<Record<string, UltimoPrecio>>({});

  // Historial: último precio cotizado a este cliente por artículo
  useEffect(() => {
    let vivo = true;
    const id = cab.cliente_id;
    (id ? ultimosPreciosCliente(id) : Promise.resolve({})).then((r) => vivo && setUltimos(r));
    return () => { vivo = false; };
  }, [cab.cliente_id]);

  // Artículos de la cotización + los que se van agregando desde el catálogo (el catálogo se busca a pedido)
  const [agregadosCat, setAgregadosCat] = useState<ArticuloCat[]>([]);
  const artPorId = useMemo(
    () => new Map([...datos.articulos, ...agregadosCat].map((a) => [a.id, a])),
    [datos.articulos, agregadosCat],
  );
  const empresa = datos.empresas.find((e) => e.id === cab.empresa_id);
  const igvPct = Number(empresa?.igv_pct ?? 18);
  const tc = Number(cab.tipo_cambio) || 0;
  const moneda = cab.moneda as Moneda;

  // Factores de venta (venta = costo ÷ factor) y recargo según forma de pago
  const factoresDe = (empresaId: string) => {
    const f = parseFactores(datos.empresas.find((e) => e.id === empresaId)?.factores);
    return f.length ? f : FACTORES_DEFECTO;
  };
  const opcionesFactor = factoresDe(cab.empresa_id);
  const factorInicial = opcionesFactor.includes(0.75) ? 0.75 : opcionesFactor[0];
  const recargoDe = (formaId: string | null) => Number(datos.formas.find((f) => f.id === formaId)?.recargo_pct ?? 0);
  const recargo = recargoDe(cab.forma_pago_id);

  const setC = <K extends keyof CabeceraInput>(k: K, v: CabeceraInput[K]) => setCab((c) => ({ ...c, [k]: v }));
  const setI = (key: string, cambios: Partial<ItemState>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...cambios } : i)));

  const ctxDe = (c: CabeceraInput): ContextoPrecio => {
    const emp = datos.empresas.find((e) => e.id === c.empresa_id);
    return {
      // El margen ahora lo da el factor de cada ítem; el IGV se suma al total
      moneda: c.moneda, tipoCambio: Number(c.tipo_cambio) || 0, incluyeIgv: c.precios_incluyen_igv,
      igvPct: Number(emp?.igv_pct ?? 18), margenPct: 0,
    };
  };
  const ctx = ctxDe(cab);

  /** Precio del proveedor expresado como precio de cotización (moneda, margen, IGV) */
  const precioCotizado = (p: { precio: number; moneda: Moneda }) => aCotizacion(p.precio, p.moneda, ctx);

  /** Costo interno del proveedor elegido: precio de compra si existe; si no, su precio de lista para la cantidad */
  const costoDe = (p: PrecioCat, cantidad: number, c: ContextoPrecio = ctx) => {
    if (Number(p.precio_compra) > 0) return round(convertir(Number(p.precio_compra), p.moneda, c.moneda as Moneda, c.tipoCambio), 4);
    return round(convertir(precioPorCantidad(p, cantidad).precio, p.moneda, c.moneda as Moneda, c.tipoCambio), 4);
  };

  /**
   * REGLA DEL CLIENTE: siempre se cotiza con el precio MÁS ALTO entre los proveedores del artículo
   * para la cantidad pedida (muestra, ciento o millar). Elegir otro proveedor solo cambia el costo.
   */
  const maxDe = (a: ArticuloCat | undefined, cantidad: number, c: ContextoPrecio = ctx) =>
    a && a.precios.length ? costoMaximo(a.precios, cantidad, c) : null;

  /** Precio de venta: costo más alto ÷ factor + recargo de la forma de pago */
  const ventaDe = (base: number, factor: number | null, formaId: string | null, c: ContextoPrecio = ctx) =>
    factor ? ventaConFactor(base, factor, recargoDe(formaId), c) : base;

  const agregar = (a: ArticuloCat, p?: PrecioCat) => {
    setAgregadosCat((l) => (l.some((x) => x.id === a.id) ? l.map((x) => (x.id === a.id ? a : x)) : [...l, a]));
    const max = maxDe(a, 1);
    const prov = p ?? max?.proveedor;
    setItems((list) => [
      ...list,
      {
        key: nuevaKey(),
        articulo_id: a.id,
        proveedor_id: prov?.proveedor_id ?? null,
        descripcion: a.descripcion,
        detalle: a.detalle ?? "",
        unidad: a.unidad,
        cantidad: 1,
        precio_costo: prov ? costoDe(prov, 1) : 0,
        precio_unitario: max ? ventaDe(max.precio, factorInicial, cab.forma_pago_id) : 0,
        descuento_pct: 0,
        color: "",
        factor: max ? factorInicial : null,
      },
    ]);
  };

  const libre = () =>
    setItems((list) => [
      ...list,
      {
        key: nuevaKey(), articulo_id: null, proveedor_id: null, descripcion: "", detalle: "", unidad: "Unidad",
        cantidad: 1, precio_costo: 0, precio_unitario: 0, descuento_pct: 0, color: "", factor: null,
      },
    ]);

  /** Recalcula precio (tramo por cantidad) y costo de un ítem de catálogo */
  const repreciar = (
    it: ItemState, cambios: Partial<ItemState>, c: ContextoPrecio = ctx, formaId: string | null = cab.forma_pago_id,
  ): ItemState => {
    const n = { ...it, ...cambios };
    const art = artPorId.get(n.articulo_id ?? "");
    if (!art) return n;
    const max = maxDe(art, n.cantidad || 1, c);
    const prov = art.precios.find((x) => x.proveedor_id === n.proveedor_id);
    // Con factor: costo más alto ÷ factor (+ recargo). Manual: se respeta el precio escrito, nunca bajo el costo.
    const precio = !max ? n.precio_unitario
      : n.factor ? ventaDe(max.precio, n.factor, formaId, c)
      : Math.max(n.precio_unitario, max.precio);
    return {
      ...n,
      precio_unitario: precio,
      precio_costo: prov ? costoDe(prov, n.cantidad || 1, c) : n.precio_costo,
    };
  };

  const cambiarFactor = (it: ItemState, factor: number | null) =>
    setItems((list) => list.map((i) => (i.key === it.key ? repreciar(i, { factor }) : i)));

  /** La forma de pago puede tener recargo (ej. 60 o 90 días +5%): se recalculan los ítems con factor */
  const cambiarFormaPago = (formaId: string | null) => {
    setItems((list) => list.map((i) => (i.articulo_id && i.factor ? repreciar(i, {}, ctx, formaId) : i)));
    setC("forma_pago_id", formaId);
  };

  const cambiarCantidad = (it: ItemState, cantidad: number) =>
    setItems((list) => list.map((i) => (i.key === it.key ? repreciar(i, { cantidad }) : i)));

  const cambiarProveedor = (it: ItemState, proveedorId: string) => {
    const art = artPorId.get(it.articulo_id ?? "");
    const p = art?.precios.find((x) => x.proveedor_id === proveedorId);
    const color = p && it.color && !p.colores.some((c) => c.color === it.color) ? "" : it.color;
    setItems((list) => list.map((i) => (i.key === it.key ? repreciar(i, { proveedor_id: proveedorId || null, color }) : i)));
  };

  /** Al cambiar moneda se convierten todos los precios con el tipo de cambio */
  const cambiarMoneda = (nueva: Moneda) => {
    if (nueva === moneda) return;
    if (items.length && !tc) {
      setError("Registra un tipo de cambio antes de cambiar la moneda");
      return;
    }
    const c2 = ctxDe({ ...cab, moneda: nueva });
    setItems((list) =>
      list.map((i) =>
        i.articulo_id
          ? repreciar(i, {}, c2)
          : {
              ...i,
              precio_unitario: round(convertir(i.precio_unitario, moneda, nueva, tc), 4),
              precio_costo: round(convertir(i.precio_costo, moneda, nueva, tc), 4),
            },
      ),
    );
    setC("moneda", nueva);
  };

  // Totales (misma fórmula que recalcular_cotizacion en la BD)
  const importe = (i: ItemInput) => round(i.cantidad * i.precio_unitario * (1 - i.descuento_pct / 100), 2);
  const suma = items.reduce((a, i) => a + importe(i), 0);
  const subtotal = cab.precios_incluyen_igv ? round(suma / (1 + igvPct / 100), 2) : round(suma, 2);
  const igv = cab.precios_incluyen_igv ? round(suma - subtotal, 2) : round(subtotal * (igvPct / 100), 2);
  const total = round(subtotal + igv, 2);
  const costoTotal = items.reduce((a, i) => a + i.cantidad * i.precio_costo, 0);
  const totalSoles = moneda === "USD" ? total * (tc || 0) : total;
  const superaLimite = datos.limite !== null && totalSoles > datos.limite;
  const margenTotal = costoTotal > 0 ? ((subtotal - costoTotal) / costoTotal) * 100 : null;

  const bajoMaximo = (it: ItemInput) => {
    const max = maxDe(artPorId.get(it.articulo_id ?? ""), it.cantidad || 1);
    return max && it.precio_unitario < max.precio - 0.00005 ? max : null;
  };

  const guardar = (emitir: boolean) => {
    setIntentado(true);
    setError(null);
    // T.C.: obligatorio en dólares y entre 1 y 10 (mismas reglas que el servidor y la base)
    const tcCab = cab.tipo_cambio === null || String(cab.tipo_cambio) === "" ? null : Number(cab.tipo_cambio);
    const errorTc = tcCab === null
      ? (cab.moneda === "USD" ? "Registra el tipo de cambio: es obligatorio en cotizaciones en dólares" : null)
      : !(tcCab >= 1 && tcCab <= 10) ? "El tipo de cambio debe estar entre 1 y 10 (ej. 3.75)" : null;
    if (errorTc) {
      setError(errorTc);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const n = items.findIndex((it) => bajoMaximo(it));
    if (n >= 0) {
      const max = bajoMaximo(items[n])!;
      setError(`Ítem ${n + 1}: el precio no puede ser menor al más alto de sus proveedores (${money(max.precio, moneda)}). Si quieres rebajar, usa la columna de descuento.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (enviando.current) return;
    enviando.current = true;
    start(async () => {
      try {
      const r = await guardarCotizacion(
        cab,
        items.map((it) => {
          const { key, verDetalle, ...i } = it;
          void key; void verDetalle;
          return i;
        }),
        emitir,
      );
      if (!r.ok && "faltantes" in r) {
        setStockAviso({ id: r.id, faltantes: r.faltantes });
        return;
      }
      if (!r.ok) {
        setError(r.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      router.push(`/cotizaciones/${r.id}`);
      router.refresh();
      } finally {
        enviando.current = false;
      }
    });
  };

  const clienteOpts = useMemo(
    () => datos.clientes.map((c) => ({ value: c.id, label: c.nombre, sub: c.num_doc })),
    [datos.clientes],
  );

  return (
    <div className={s.layout}>
      <div className={ui.stack}>
        {error && <div className={ui.alert}><AlertCircle /> {error}</div>}

        <div className={ui.card}>
          <div className={ui.cardHead}><span className={ui.cardTitle}>Datos generales</span></div>
          <div className={`${ui.cardBody} ${ui.grid}`}>
            <label className={`${ui.field} ${ui.span6}`}>
              <span className={`${ui.label} ${ui.req}`}>Empresa que cotiza</span>
              <select className={ui.input} value={cab.empresa_id} onChange={(e) => setC("empresa_id", e.target.value)}
                disabled={!!cab.id}>
                {datos.empresas.map((e) => <option key={e.id} value={e.id}>{e.razon_social}</option>)}
              </select>
            </label>
            <div className={`${ui.field} ${ui.span6}`}>
              <span className={`${ui.label} ${ui.req}`}>Cliente</span>
              <div className={s.clienteRow}>
              <Combobox
                options={clienteOpts}
                value={cab.cliente_id}
                invalid={intentado && !cab.cliente_id}
                placeholder="Buscar empresa por razón social o RUC..."
                onChange={(v) => {
                  const cli = datos.clientes.find((c) => c.id === v);
                  setCab((c) => ({ ...c, cliente_id: v, agente_id: c.agente_id || cli?.agente_id || null }));
                }}
              />
              {datos.creaCliente && (
                <button type="button" className={`${ui.btn} ${s.addCli}`} title="Registrar cliente nuevo" onClick={() => setNuevoCliente(true)}>
                  <UserPlus />
                </button>
              )}
              </div>
            </div>
            <label className={`${ui.field} ${ui.span4}`}>
              <span className={ui.label}>Agente comercial</span>
              <select className={ui.input} value={cab.agente_id ?? ""} onChange={(e) => setC("agente_id", e.target.value || null)}>
                <option value="">(ninguno)</option>
                {datos.agentes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </label>
            <label className={`${ui.field} ${ui.span4}`}>
              <span className={ui.label}>Forma de pago</span>
              <select className={ui.input} value={cab.forma_pago_id ?? ""} onChange={(e) => cambiarFormaPago(e.target.value || null)}>
                <option value="">(sin especificar)</option>
                {datos.formas.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nombre}{Number(f.recargo_pct) > 0 ? ` (+${num(Number(f.recargo_pct), 0)}%)` : ""}
                  </option>
                ))}
              </select>
              {recargo > 0 && <span className={ui.hint}>Los precios con factor llevan +{num(recargo, 0)}% por esta forma de pago</span>}
            </label>
            <div className={`${ui.field} ${ui.span4}`}>
              <span className={ui.label}>Moneda y tipo de cambio</span>
              <div className={s.monedaRow}>
                <select className={ui.input} value={cab.moneda} onChange={(e) => cambiarMoneda(e.target.value as Moneda)}>
                  <option value="PEN">Soles</option>
                  <option value="USD">Dólares</option>
                </select>
                <input className={ui.input} type="number" step="0.0001" min="1" max="10" title="Tipo de cambio (venta), entre 1 y 10"
                  value={cab.tipo_cambio ?? ""} onChange={(e) => setC("tipo_cambio", e.target.value ? Number(e.target.value) : null)} />
              </div>
            </div>
            <label className={`${ui.field} ${ui.span3}`}>
              <span className={`${ui.label} ${ui.req}`}>Fecha de emisión</span>
              <input className={ui.input} type="date" value={cab.fecha_emision} onChange={(e) => setC("fecha_emision", e.target.value)} />
            </label>
            <label className={`${ui.field} ${ui.span3}`}>
              <span className={ui.label}>Lugar</span>
              <input className={ui.input} value={cab.lugar} onChange={(e) => setC("lugar", e.target.value)} />
            </label>
            <label className={`${ui.field} ${ui.span3}`}>
              <span className={ui.label}>Validez (días)</span>
              <input className={ui.input} type="number" min="0" value={cab.validez_dias}
                onChange={(e) => setC("validez_dias", Number(e.target.value))} />
            </label>
            <label className={`${ui.field} ${ui.span3}`}>
              <span className={ui.label}>Tiempo de entrega</span>
              <input className={ui.input} value={cab.tiempo_entrega} placeholder="Ej. 3 días hábiles"
                onChange={(e) => setC("tiempo_entrega", e.target.value)} />
            </label>
          </div>
        </div>

        <div className={ui.card}>
          <div className={ui.cardHead}>
            <span className={ui.cardTitle}>Ítems ({items.length})</span>
            <div className={ui.actions}>
              <span className={ui.hint}>Precios sin IGV · el IGV se suma al total</span>
              <button className={`${ui.btn} ${ui.sm}`} onClick={libre}><Plus /> Ítem libre</button>
              <button className={`${ui.btn} ${ui.sm} ${ui.primary}`} onClick={() => setCatalogo(true)}>
                <PackagePlus /> Agregar del catálogo
              </button>
            </div>
          </div>
          {items.length === 0 ? (
            <Empty>
              Agrega artículos del catálogo para elegir proveedor y precio
            </Empty>
          ) : (
            <div className={ui.tableWrap}>
              <table className={`${ui.table} ${s.items}`} style={{ tableLayout: "fixed", minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>#</th>
                    <th>Descripción y proveedor</th>
                    <th style={{ width: 96 }}>Und.</th>
                    <th className={ui.num} style={{ width: 96 }}>Cant.</th>
                    <th className={ui.num} style={{ width: 132 }}>Factor · P. unit. {SIMBOLO[moneda]}</th>
                    <th className={ui.num} style={{ width: 84 }}>Dsct %</th>
                    <th className={ui.num} style={{ width: 104 }}>Importe</th>
                    <th style={{ width: 44 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, n) => {
                    const art = it.articulo_id ? artPorId.get(it.articulo_id) : undefined;
                    const sinIgv = cab.precios_incluyen_igv ? it.precio_unitario / (1 + igvPct / 100) : it.precio_unitario;
                    const neto = sinIgv * (1 - it.descuento_pct / 100);
                    const margen = it.precio_costo > 0 ? ((neto - it.precio_costo) / it.precio_costo) * 100 : null;
                    const q = it.cantidad || 1;
                    const maxItem = maxDe(art, q);
                    const bajo = bajoMaximo(it);
                    const precioProv = (p: PrecioCat) => aCotizacion(precioPorCantidad(p, q).precio, p.moneda, ctx);
                    const opciones = art ? [...art.precios].sort((x, y) => precioProv(y) - precioProv(x)) : [];
                    const prov = art?.precios.find((p) => p.proveedor_id === it.proveedor_id);
                    // colores del proveedor elegido (o de todos si no hay proveedor)
                    const colores = prov
                      ? prov.colores
                      : Object.values(
                          (art?.precios ?? []).flatMap((p) => p.colores).reduce<Record<string, { color: string; stock: number }>>(
                            (acc, c) => ({ ...acc, [c.color]: { color: c.color, stock: (acc[c.color]?.stock ?? 0) + Number(c.stock) } }),
                            {},
                          ),
                        );
                    const stockColor = it.color ? colores.find((c) => c.color === it.color)?.stock : undefined;
                    const stockDisp = it.color ? stockColor : prov?.stock ?? undefined;
                    const sinStock = stockDisp != null && q > Number(stockDisp);
                    return (
                      <tr key={it.key}>
                        <td className={ui.muted}>{n + 1}</td>
                        <td>
                          <div className={s.descCell}>
                            {art?.foto_url && <FotoZoom src={art.foto_url} titulo={art.descripcion} tam={32} />}
                            <input className={`${ui.input} ${s.cellInput}`} value={it.descripcion} placeholder="Descripción del ítem"
                              style={intentado && !it.descripcion.trim() ? { borderColor: "var(--danger)" } : undefined}
                              onChange={(e) => setI(it.key, { descripcion: e.target.value })} />
                            <button className={`${ui.btn} ${ui.ghost} ${ui.icon} ${it.detalle ? s.on : ""}`} title="Detalle adicional"
                              onClick={() => setI(it.key, { verDetalle: !it.verDetalle })}>
                              <AlignLeft />
                            </button>
                          </div>
                          {it.verDetalle && (
                            <textarea className={`${ui.input} ${s.detalle}`} value={it.detalle} placeholder="Detalle que se imprime debajo"
                              onChange={(e) => setI(it.key, { detalle: e.target.value })} />
                          )}
                          <div className={s.provRow}>
                            {art && art.precios.length > 0 ? (
                              <select className={`${ui.input} ${s.cellInput} ${s.provSelect}`} value={it.proveedor_id ?? ""}
                                onChange={(e) => cambiarProveedor(it, e.target.value)} title="Proveedor">
                                <option value="">(sin proveedor)</option>
                                {opciones.map((p) => (
                                  <option key={p.id} value={p.proveedor_id}>
                                    {p.proveedor} · {money(precioProv(p), moneda)}
                                    {p.stock != null ? ` · stock ${num(p.stock, 0)}` : ""}
                                    {p.proveedor_id === maxItem?.proveedor.proveedor_id ? " (más alto)" : ""}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className={s.meta}>{art ? "Sin proveedores registrados" : "Ítem libre"}</span>
                            )}
                            {(colores.length > 0 || !art) && (
                              <>
                                <input className={`${ui.input} ${s.cellInput} ${s.colorSelect}`} list={`colores-${it.key}`}
                                  placeholder="Color" value={it.color} maxLength={40}
                                  onChange={(e) => setI(it.key, { color: e.target.value.toUpperCase() })} title="Color" />
                                <datalist id={`colores-${it.key}`}>
                                  {colores.map((c) => (
                                    <option key={c.color} value={c.color}>{`stock ${num(c.stock, 0)}`}</option>
                                  ))}
                                </datalist>
                              </>
                            )}
                          </div>
                          {colores.length > 0 && !it.color && (
                            <div className={s.chipsColor}>
                              {colores.filter((c) => Number(c.stock) > 0).slice(0, 8).map((c) => (
                                <button key={c.color} type="button" className={s.chipColor} onClick={() => setI(it.key, { color: c.color })}
                                  title={`Stock ${num(c.stock, 0)}`}>
                                  {c.color} <small>{num(c.stock, 0)}</small>
                                </button>
                              ))}
                            </div>
                          )}
                          {stockDisp != null && (
                            <div className={sinStock ? s.stockMal : s.stockOk}>
                              {sinStock ? "Stock insuficiente: " : "Stock: "}{num(Number(stockDisp), 0)}
                              {it.color ? ` en ${it.color}` : prov ? ` en ${prov.proveedor}` : ""}
                            </div>
                          )}
                          {it.articulo_id && ultimos[it.articulo_id] && (
                            <div className={s.historial} title="Último precio cotizado a este cliente">
                              <History /> Último a este cliente: {money(ultimos[it.articulo_id].precio, ultimos[it.articulo_id].moneda)}
                              {" · "}{ultimos[it.articulo_id].codigo} ({fecha(ultimos[it.articulo_id].fecha)})
                            </div>
                          )}
                          <div className={s.meta}>
                            {art && <>{art.codigo}{art.linea ? ` · ${art.linea}` : ""}</>}
                            {it.precio_costo > 0 && <>{art ? " · " : ""}Costo {money(it.precio_costo, moneda)}</>}
                            {margen !== null && (
                              <span className={margen < 0 ? s.neg : s.pos}> · margen {num(margen, 1)}%</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <input className={`${ui.input} ${s.cellInput}`} list="unidades-sugeridas" maxLength={20}
                            value={it.unidad} onChange={(e) => setI(it.key, { unidad: e.target.value })} />
                        </td>
                        <td>
                          <input className={`${ui.input} ${s.cellInput} ${s.right}`} type="number" min="0" step="0.01" value={it.cantidad}
                            onChange={(e) => cambiarCantidad(it, Number(e.target.value))} />
                        </td>
                        <td>
                          {maxItem && (
                            <select className={`${ui.input} ${s.cellInput} ${s.factorSel}`} value={it.factor ?? ""}
                              title="Factor: precio de venta = costo ÷ factor"
                              onChange={(e) => cambiarFactor(it, e.target.value ? Number(e.target.value) : null)}>
                              {opcionesFactor.map((f) => <option key={f} value={f}>÷ {f.toFixed(2)}</option>)}
                              <option value="">Manual</option>
                            </select>
                          )}
                          <input className={`${ui.input} ${s.cellInput} ${s.right}`} type="number" min={maxItem?.precio ?? 0} step="0.0001"
                            value={it.precio_unitario}
                            style={bajo ? { borderColor: "var(--danger)" } : undefined}
                            onChange={(e) => setI(it.key, { precio_unitario: Number(e.target.value), factor: null })} />
                          {bajo ? (
                            <button className={s.minFix} title="Usar el costo más alto"
                              onClick={() => setI(it.key, { precio_unitario: bajo.precio })}>
                              Mín. {bajo.precio}
                            </button>
                          ) : maxItem ? (
                            <div className={s.maxTag}>
                              Costo {num(maxItem.precio, 2)}{it.factor ? ` ÷ ${it.factor.toFixed(2)}` : ""}
                              {it.factor && recargo > 0 ? ` +${num(recargo, 0)}%` : ""}
                              <br />{TRAMO_LABEL[maxItem.tramo]}{art && art.precios.length > 1 ? " · más alto" : ""}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <input className={`${ui.input} ${s.cellInput} ${s.right}`} type="number" min="0" max="100" step="0.5" value={it.descuento_pct}
                            onChange={(e) => setI(it.key, { descuento_pct: Number(e.target.value) })} />
                        </td>
                        <td className={`${ui.num} ${ui.strong}`}>{num(importe(it))}</td>
                        <td>
                          <button className={`${ui.btn} ${ui.ghost} ${ui.icon}`} title="Quitar ítem"
                            onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}>
                            <Trash2 />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={ui.card}>
          <div className={ui.cardBody}>
            <label className={ui.field}>
              <span className={ui.label}>Observaciones</span>
              <textarea className={ui.input} value={cab.observaciones} placeholder="Condiciones especiales, garantía, etc."
                onChange={(e) => setC("observaciones", e.target.value)} />
            </label>
          </div>
        </div>
      </div>

      <aside className={s.side}>
        <div className={`${ui.card} ${s.totales}`}>
          <div className={s.tRow}><span>Subtotal</span><span>{money(subtotal, moneda)}</span></div>
          <div className={s.tRow}><span>IGV ({num(igvPct, 0)}%)</span><span>{money(igv, moneda)}</span></div>
          <div className={`${s.tRow} ${s.tTotal}`}><span>Total</span><span>{money(total, moneda)}</span></div>
          {costoTotal > 0 && (
            <div className={s.margen}>
              <span>Costo {money(costoTotal, moneda)}</span>
              <span className={margenTotal !== null && margenTotal < 0 ? s.neg : s.pos}>
                Margen {margenTotal === null ? "" : `${num(margenTotal, 1)}%`}
              </span>
            </div>
          )}
          <div className={s.botones}>
            {(estado === "nueva" || estado === "borrador") && (
              <button className={`${ui.btn} ${ui.primary}`} onClick={() => guardar(true)} disabled={pending}>
                <FileCheck2 /> {superaLimite ? "Guardar y pedir aprobación" : "Guardar y emitir"}
              </button>
            )}
            <button className={ui.btn} onClick={() => guardar(false)} disabled={pending}>
              <Save /> {pending ? "Guardando..." : estado === "emitida" ? "Guardar cambios" : "Guardar borrador"}
            </button>
          </div>
          {superaLimite && datos.limite !== null && (
            <div className={s.limite}>
              Supera tu límite de {money(datos.limite, "PEN")}. Al emitirla quedará <strong>por aprobar</strong> hasta que un administrador la apruebe.
            </div>
          )}
          {datos.limite !== null && !superaLimite && (
            <p className={ui.hint}>Tu límite de venta: {money(datos.limite, "PEN")}</p>
          )}
          <p className={ui.hint}>El costo y el margen son internos y no se imprimen.</p>
        </div>
      </aside>

      <AvisoStock
        faltantes={stockAviso?.faltantes ?? null}
        pending={pending}
        textoCancelar="Dejar en borrador"
        onCancelar={() => {
          const id = stockAviso?.id;
          setStockAviso(null);
          if (id) { router.push(`/cotizaciones/${id}`); router.refresh(); }
        }}
        onEmitir={() => {
          const id = stockAviso?.id;
          if (!id) return;
          start(async () => {
            const r = await cambiarEstado(id, "emitida", undefined, true);
            setStockAviso(null);
            if (!r.ok) setError(r.error);
            router.push(`/cotizaciones/${id}`);
            router.refresh();
          });
        }}
      />

      <datalist id="unidades-sugeridas">
        {UNIDADES.map((u) => <option key={u} value={u} />)}
      </datalist>

      <Modal open={nuevoCliente} onClose={() => setNuevoCliente(false)} title="Nuevo cliente">
        {nuevoCliente && (
          <RegistroForm
            modKey="clientes"
            refs={{ agentes: datos.agentes.map((a) => ({ value: a.id, label: a.nombre })) }}
            consulta={datos.consulta}
            compact
            onCancel={() => setNuevoCliente(false)}
            onSaved={(id) => {
              setNuevoCliente(false);
              setCab((c) => ({ ...c, cliente_id: id }));
              router.refresh();
            }}
          />
        )}
      </Modal>

      <Catalogo
        ultimos={ultimos}
        open={catalogo}
        onClose={() => setCatalogo(false)}
        moneda={moneda}
        precioCotizado={precioCotizado}
        onAgregar={agregar}
      />
    </div>
  );
}

function Catalogo({
  open, onClose, moneda, precioCotizado, onAgregar, ultimos,
}: {
  ultimos: Record<string, UltimoPrecio>;
  open: boolean;
  onClose: () => void;
  moneda: Moneda;
  precioCotizado: (p: { precio: number; moneda: Moneda }) => number;
  onAgregar: (a: ArticuloCat, p?: PrecioCat) => void;
}) {
  const [q, setQ] = useState("");
  const [agregados, setAgregados] = useState(0);
  const [lista, setLista] = useState<ArticuloCat[]>([]);
  const [buscando, setBuscando] = useState(false);
  // Búsqueda en el servidor (espera 250 ms después de la última tecla)
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    const t = setTimeout(() => {
      setBuscando(true);
      buscarCatalogo(q)
        .then((r) => { if (vivo) setLista(r); })
        .catch(() => { if (vivo) setLista([]); })
        .finally(() => { if (vivo) setBuscando(false); });
    }, q ? 250 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [q, open]);

  const add = (a: ArticuloCat, p?: PrecioCat) => {
    onAgregar(a, p);
    setAgregados((n) => n + 1);
  };

  return (
    <Modal
      open={open}
      onClose={() => { onClose(); setAgregados(0); }}
      title="Catálogo de artículos"
      width={820}
      footer={
        <>
          <span className={ui.muted} style={{ marginRight: "auto" }}>
            {agregados > 0 ? `${agregados} ítem(s) agregados` : "Siempre se cotiza con el precio más alto del artículo"}
          </span>
          <button className={`${ui.btn} ${ui.primary}`} onClick={() => { onClose(); setAgregados(0); }}>Listo</button>
        </>
      }
    >
      <div className={ui.search} style={{ maxWidth: "none", marginBottom: 14 }}>
        <Search />
        <input className={ui.input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código, descripción o línea..." />
      </div>
      {lista.length === 0 ? (
        buscando ? <Empty>Buscando...</Empty> : <Empty>No se encontraron artículos</Empty>
      ) : (
        <ul className={s.cat}>
          {lista.map((a) => (
            <li key={a.id} className={s.catItem}>
              <FotoZoom src={a.foto_url} titulo={a.descripcion} tam={52} className={s.catZoom} />
              <div className={s.catInfo}>
                <div className={s.catTitle}>{a.descripcion}</div>
                <div className={s.meta}>
                  {a.codigo} · {a.unidad}{a.linea ? ` · ${a.linea}` : ""}
                  {a.stock_ref !== null ? ` · stock ${num(a.stock_ref, 0)}` : ""}
                  {a.empaque ? ` · ${a.empaque}` : ""}
                </div>
                {ultimos[a.id] && (
                  <div className={s.historial}>
                    <History /> Último a este cliente: {money(ultimos[a.id].precio, ultimos[a.id].moneda)} · {ultimos[a.id].codigo} ({fecha(ultimos[a.id].fecha)})
                  </div>
                )}
                {a.precios.length > 1 && (
                  <div className={s.meta}>
                    Se cotiza con el precio más alto entre proveedores según la cantidad. El proveedor elegido solo define el costo.
                  </div>
                )}
                <div className={s.chips}>
                  {[...a.precios]
                    .sort((x, y) => precioCotizado({ precio: Number(y.precio_venta), moneda: y.moneda }) - precioCotizado({ precio: Number(x.precio_venta), moneda: x.moneda }))
                    .map((p) => (
                    <button key={p.id} className={s.chip} onClick={() => add(a, p)} title="Agregar con este proveedor">
                      <Truck />
                      <span>{p.proveedor}</span>
                      {p.preferido && <Star className={s.star} />}
                      <span className={s.tramos}>
                        {Number(p.precio_venta) > 0 && <strong>{money(precioCotizado({ precio: Number(p.precio_venta), moneda: p.moneda }), moneda)}</strong>}
                        {Number(p.precio_ciento) > 0 && <em>ciento {money(precioCotizado({ precio: Number(p.precio_ciento) / 100, moneda: p.moneda }), moneda)}</em>}
                        {Number(p.precio_millar) > 0 && <em>millar {money(precioCotizado({ precio: Number(p.precio_millar) / 1000, moneda: p.moneda }), moneda)}</em>}
                      </span>
                      {p.stock != null && <small className={Number(p.stock) > 0 ? s.stockOk : s.stockMal}>stock {num(p.stock, 0)}</small>}
                    </button>
                  ))}
                  {a.precios.length === 0 && (
                    <button className={s.chip} onClick={() => add(a)}>
                      <Plus /> <span>Agregar sin precio</span>
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
