/**
 * Precios por volumen de los proveedores.
 * precio_venta  = precio unitario de muestra (pocas unidades)
 * precio_ciento = precio por 100 unidades, aplica desde `desde_ciento` unidades
 * precio_millar = precio por 1000 unidades, aplica desde `desde_millar` unidades
 */
export type PrecioVolumen = {
  precio_venta: number | null;
  precio_ciento: number | null;
  precio_millar: number | null;
  desde_ciento: number | null;
  desde_millar: number | null;
};

export type Tramo = "muestra" | "ciento" | "millar";

export const TRAMO_LABEL: Record<Tramo, string> = {
  muestra: "precio muestra",
  ciento: "precio x ciento",
  millar: "precio x millar",
};

const pos = (n: number | null | undefined) => (n != null && Number(n) > 0 ? Number(n) : null);

/** Precio unitario del proveedor para una cantidad dada (en su moneda, sin margen) */
export function precioPorCantidad(p: PrecioVolumen, cantidad: number): { precio: number; tramo: Tramo } {
  const muestra = pos(p.precio_venta);
  const ciento = pos(p.precio_ciento);
  const millar = pos(p.precio_millar);
  const dC = Number(p.desde_ciento ?? 50) || 50;
  const dM = Number(p.desde_millar ?? 500) || 500;

  if (millar && cantidad >= dM) return { precio: millar / 1000, tramo: "millar" };
  if (ciento && cantidad >= dC) return { precio: ciento / 100, tramo: "ciento" };
  if (muestra) return { precio: muestra, tramo: "muestra" };
  // sin precio de muestra: se usa el tramo disponible más cercano
  if (ciento) return { precio: ciento / 100, tramo: "ciento" };
  if (millar) return { precio: millar / 1000, tramo: "millar" };
  return { precio: 0, tramo: "muestra" };
}

export function conMargen(precio: number, margenPct: number) {
  return precio * (1 + (Number(margenPct) || 0) / 100);
}

export type PrecioProveedor = PrecioVolumen & { moneda: string; proveedor_id?: string };

export type ContextoPrecio = {
  moneda: string;
  tipoCambio: number;
  incluyeIgv: boolean;
  igvPct: number;
  margenPct: number;
};

/** Convierte un precio del proveedor a la moneda y modalidad (IGV, margen) de la cotización. 4 decimales. */
export function aCotizacion(precio: number, monedaOrigen: string, ctx: ContextoPrecio) {
  let v = precio;
  if (monedaOrigen !== ctx.moneda && ctx.tipoCambio) {
    v = monedaOrigen === "USD" ? v * ctx.tipoCambio : v / ctx.tipoCambio;
  }
  v = conMargen(v, ctx.margenPct);
  if (ctx.incluyeIgv) v = v * (1 + ctx.igvPct / 100);
  return Math.round(v * 10000) / 10000;
}

/**
 * REGLA DEL CLIENTE: se cotiza con el precio más alto entre los proveedores del artículo,
 * según el tramo de cantidad (muestra / ciento / millar). Devuelve el precio y quién lo da.
 */
export function precioMaximo<T extends PrecioProveedor>(precios: T[], cantidad: number, ctx: ContextoPrecio) {
  let mejor: { precio: number; tramo: Tramo; proveedor: T } | null = null;
  for (const p of precios) {
    const { precio, tramo } = precioPorCantidad(p, cantidad);
    if (!precio) continue;
    const v = aCotizacion(precio, p.moneda, ctx);
    if (!mejor || v > mejor.precio) mejor = { precio: v, tramo, proveedor: p };
  }
  return mejor;
}

// ---------------------------------------------------------------------------
// Precio de venta por FACTOR (pedido del cliente, 22/10):
//   venta = costo del proveedor ÷ factor  (0.75 → costo 1.50 = venta 2.00)
// y, según la forma de pago, un recargo % (ej. factura a 60 días +5%).
// Los precios se cotizan sin IGV; el IGV se suma al total (salvo que se marque "incluyen IGV").
// ---------------------------------------------------------------------------

/** "0.60, 0.75, 0.77, 0.80" → [0.6, 0.75, 0.77, 0.8] (acepta coma decimal: "0,75") */
export function parseFactores(txt: string | null | undefined): number[] {
  const nums = (txt ?? "").match(/0[.,]\d+|1(?:[.,]0+)?(?!\d)/g) ?? [];
  const out = [...new Set(nums.map((n) => Number(n.replace(",", "."))))].filter((n) => n > 0 && n <= 1);
  return out.sort((a, b) => a - b);
}

export const FACTORES_DEFECTO = [0.6, 0.75, 0.77, 0.8];

/** Costo más alto entre proveedores para la cantidad, en la moneda de la cotización (sin margen ni IGV) */
export function costoMaximo<T extends PrecioProveedor>(precios: T[], cantidad: number, ctx: ContextoPrecio) {
  return precioMaximo(precios, cantidad, { ...ctx, incluyeIgv: false, margenPct: 0 });
}

/**
 * Precio mínimo de venta de un ítem: costo más alto del proveedor + impresión por unidad,
 * con IGV si los precios lo incluyen. Es la MISMA fórmula que el servidor y el trigger
 * item_precio_minimo de la base (redondeo a 4 decimales en los mismos pasos).
 * impresion: costo de impresión por unidad sin IGV (ya en la moneda de la cotización).
 */
export function minimoVenta<T extends PrecioProveedor>(precios: T[], cantidad: number, ctx: ContextoPrecio, impresion: number) {
  const max = precioMaximo(precios, cantidad, { ...ctx, margenPct: 0 });
  let imp = Math.round((Number(impresion) || 0) * 10000) / 10000;
  if (ctx.incluyeIgv) imp = imp * (1 + ctx.igvPct / 100);
  const minimo = Math.round(((max?.precio ?? 0) + imp) * 10000) / 10000;
  return { minimo, max, impresion: imp };
}

/** Precio unitario de venta a partir del costo, el factor y el recargo de la forma de pago */
export function ventaConFactor(costo: number, factor: number, recargoPct: number, ctx: Pick<ContextoPrecio, "incluyeIgv" | "igvPct">) {
  if (!(costo > 0) || !(factor > 0)) return 0;
  let v = costo / factor;
  v = v * (1 + (Number(recargoPct) || 0) / 100);
  if (ctx.incluyeIgv) v = v * (1 + ctx.igvPct / 100);
  return Math.round(v * 10000) / 10000;
}
