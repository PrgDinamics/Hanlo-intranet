export type Moneda = "PEN" | "USD";

export const SIMBOLO: Record<Moneda, string> = { PEN: "S/", USD: "US$" };

export function money(value: number | string | null | undefined, moneda: Moneda | string = "PEN") {
  const n = Number(value ?? 0);
  const s = SIMBOLO[moneda as Moneda] ?? moneda;
  return `${s} ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function num(value: number | string | null | undefined, decimals = 2) {
  return Number(value ?? 0).toLocaleString("es-PE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Fecha "YYYY-MM-DD" o ISO → "01/10/2026" sin desfase de zona horaria */
export function fecha(value: string | null | undefined) {
  if (!value) return "";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function fechaHora(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fechaLarga(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
    "septiembre", "octubre", "noviembre", "diciembre"];
  return `${d} de ${meses[m - 1]} de ${y}`;
}

/** Hoy en Lima en formato YYYY-MM-DD */
export function hoyLima() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}

export function codigoCotizacion(serie: string, numero: number, version = 1) {
  return `${serie}-${String(numero).padStart(6, "0")}${version > 1 ? ` v${version}` : ""}`;
}

/** Convierte un precio entre monedas usando el tipo de cambio (venta) */
export function convertir(precio: number, de: Moneda, a: Moneda, tc: number) {
  if (de === a || !tc) return precio;
  return de === "USD" ? precio * tc : precio / tc;
}

export function round(n: number, d = 2) {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Fecha YYYY-MM-DD de hace N días (en Lima) */
export function haceDias(dias: number) {
  const [y, m, d] = hoyLima().split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d - dias));
  return f.toISOString().slice(0, 10);
}

/** Precio unitario: 2 decimales, hasta 4 si hace falta (ej. 0.425 por unidad en compras por millar) */
export function pu(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
