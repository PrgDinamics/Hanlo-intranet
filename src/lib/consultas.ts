/**
 * Ayudas para consultas a Supabase.
 * La API devuelve como máximo 1000 filas por consulta (max_rows): lo que necesite más se pide por páginas.
 */

type Pagina<T> = (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

const TAM = 1000;

/**
 * Trae todas las filas pidiendo de 1000 en 1000 con `.range(desde, hasta)`.
 * La consulta debe tener un orden estable (`.order(...)`) para no repetir ni saltar filas.
 * Si una página falla lanza un Error (nunca devuelve una lista incompleta en silencio).
 * `maximo` corta la lista (ej. el Excel exporta hasta 10,000 filas).
 */
export async function todasLasFilas<T>(pagina: Pagina<T>, maximo = Infinity): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; desde < maximo; desde += TAM) {
    const hasta = Math.min(desde + TAM, maximo) - 1;
    const { data, error } = await pagina(desde, hasta);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < hasta - desde + 1) break;
  }
  return out;
}

/** ¿Es un UUID? Un id inválido en la URL (/clientes/abc) hace fallar la consulta en Postgres */
export function esUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** El número de cotización es int: un RUC (11 dígitos) no cabe y haría fallar toda la búsqueda */
const MAX_INT = 2147483647;

/** Filtro PostgREST "numero.eq.N" para buscar por número de cotización, o null si el texto no sirve */
export function filtroNumero(texto: string): string | null {
  const digitos = texto.replace(/\D/g, "");
  if (!digitos) return null;
  const n = Number(digitos);
  return n >= 1 && n <= MAX_INT ? `numero.eq.${n}` : null;
}
