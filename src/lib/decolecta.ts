import "server-only";

/**
 * Consultas a SUNAT / RENIEC vía Decolecta (https://decolecta.com).
 * Requiere DECOLECTA_TOKEN. Si no está configurado, las funciones de consulta se ocultan en la UI.
 */
const BASE = process.env.DECOLECTA_URL ?? "https://api.decolecta.com/v1";

export function consultaHabilitada() {
  return !!process.env.DECOLECTA_TOKEN;
}

async function get<T>(path: string): Promise<T> {
  const token = process.env.DECOLECTA_TOKEN;
  if (!token) throw new Error("Consulta no configurada (falta DECOLECTA_TOKEN)");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") {
      throw new Error("SUNAT está tardando demasiado en responder. Intenta de nuevo en unos minutos");
    }
    throw new Error("No se pudo conectar con el servicio de consulta. Revisa la conexión e intenta de nuevo");
  }
  if (res.status === 404 || res.status === 422) throw new Error("No se encontró el documento");
  if (res.status === 401 || res.status === 403) throw new Error("Token de consulta inválido o sin saldo");
  if (res.status === 429) throw new Error("Se alcanzó el límite de consultas del mes. Completa los datos a mano");
  if (!res.ok) throw new Error(`El servicio de consulta no está disponible (código ${res.status}). Intenta de nuevo o completa los datos a mano`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error("El servicio de consulta devolvió una respuesta no válida. Intenta de nuevo o completa los datos a mano");
  }
}

export type DatosDocumento = {
  nombre: string;
  direccion: string | null;
  estado: string | null;
  condicion: string | null;
};

type RucResp = {
  razon_social: string;
  estado?: string;
  condicion?: string;
  direccion?: string;
  distrito?: string;
  provincia?: string;
  departamento?: string;
};
type DniResp = { full_name?: string; first_name?: string; first_last_name?: string; second_last_name?: string };

const limpio = (v?: string | null) => (v && v.trim() && v.trim() !== "-" ? v.trim() : null);

export async function consultarRuc(ruc: string): Promise<DatosDocumento> {
  const r = await get<RucResp>(`/sunat/ruc?numero=${encodeURIComponent(ruc)}`);
  const ubic = [r.distrito, r.provincia, r.departamento].map(limpio).filter(Boolean).join(", ");
  const dir = [limpio(r.direccion), ubic].filter(Boolean).join(", ");
  return { nombre: r.razon_social, direccion: dir || null, estado: limpio(r.estado), condicion: limpio(r.condicion) };
}

export async function consultarDni(dni: string): Promise<DatosDocumento> {
  const r = await get<DniResp>(`/reniec/dni?numero=${encodeURIComponent(dni)}`);
  const nombre =
    [r.first_name, r.first_last_name, r.second_last_name].filter(Boolean).join(" ") || r.full_name || "";
  return { nombre, direccion: null, estado: null, condicion: null };
}

type TcResp = { buy_price: string; sell_price: string; date: string };

/** Tipo de cambio SUNAT (USD → PEN) del día indicado o el último publicado */
export async function tipoCambioSunat(fecha?: string) {
  const r = await get<TcResp>(`/tipo-cambio/sunat${fecha ? `?date=${fecha}` : ""}`);
  return { fecha: r.date, compra: Number(r.buy_price), venta: Number(r.sell_price) };
}
