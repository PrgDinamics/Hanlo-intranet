import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyLima } from "@/lib/format";

export type Reporte = {
  resumen: {
    cantidad: number; cotizado: number; aceptadas: number; aceptado: number; pendientes: number;
    pendiente: number; ticket: number; tasa: number; anuladas: number;
  };
  por_mes: { mes: string; cantidad: number; cotizado: number; aceptado: number }[];
  por_estado: { estado: string; cantidad: number; monto: number }[];
  por_agente: { agente: string; cantidad: number; cotizado: number; aceptadas: number; aceptado: number; tasa: number }[];
  por_cliente: { id: string; cliente: string; documento: string; cantidad: number; cotizado: number; aceptadas: number; aceptado: number; ultima: string }[];
  por_articulo: { codigo: string; articulo: string; cotizaciones: number; cantidad: number; monto: number; costo: number; aceptado: number }[];
  por_proveedor: { proveedor: string; ruc: string | null; items: number; costo: number; costo_aceptado: number }[];
};

export type FiltrosReporte = { desde: string; hasta: string; empresa?: string; agente?: string };

type SP = Record<string, string | string[] | undefined>;

export function leerFiltros(sp: SP | URLSearchParams): FiltrosReporte {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return typeof v === "string" && v ? v : undefined;
  };
  const hoy = hoyLima();
  // Fecha real (2026-02-30 o 2026-99-99 no valen) y UUID válidos; si no, se usan los valores por defecto
  const fechaOk = (v?: string) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  };
  const uuid = (v?: string) => (v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined);
  let desde = fechaOk(get("desde")) ? get("desde")! : `${hoy.slice(0, 4)}-01-01`;
  let hasta = fechaOk(get("hasta")) ? get("hasta")! : hoy;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  return { desde, hasta, empresa: uuid(get("empresa")), agente: uuid(get("agente")) };
}

export async function cargarReporte(supabase: SupabaseClient, f: FiltrosReporte): Promise<Reporte> {
  const { data, error } = await supabase.rpc("reporte_comercial", {
    p_desde: f.desde,
    p_hasta: f.hasta,
    p_empresa: f.empresa ?? null,
    p_agente: f.agente ?? null,
  });
  if (error) throw new Error(error.message);
  return data as Reporte;
}
