import "server-only";
import { consultaHabilitada, tipoCambioSunat } from "@/lib/decolecta";
import { createAdminClient } from "@/lib/supabase/admin";
import { hoyLima } from "@/lib/format";

/** Trae el T.C. SUNAT de una fecha (o el último publicado) y lo guarda como fuente "sunat" */
export async function guardarTcSunat(fecha?: string) {
  const tc = await tipoCambioSunat(fecha);
  const { error } = await createAdminClient()
    .from("tipos_cambio")
    .upsert({ fecha: tc.fecha, compra: tc.compra, venta: tc.venta, fuente: "sunat" }, { onConflict: "fecha" });
  if (error) throw new Error(error.message);
  return tc;
}

/**
 * Si todavía no hay T.C. de hoy y la consulta está configurada, lo trae de SUNAT.
 * Lo usan la cotización nueva y el cron diario, así queda un registro de todos los días.
 */
export async function asegurarTipoCambioHoy(ultimaFecha?: string | null) {
  const hoy = hoyLima();
  if (!consultaHabilitada()) return null;
  try {
    if (ultimaFecha === undefined) {
      const { data } = await createAdminClient().from("tipos_cambio").select("fecha").eq("fecha", hoy).maybeSingle();
      if (data) return null;
    } else if (ultimaFecha === hoy) {
      return null;
    }
    return (await guardarTcSunat(hoy)).venta;
  } catch {
    return null; // si falla, se usa el último registrado
  }
}

/** Completa los días que falten en los últimos N días (1 consulta por día faltante) */
export async function completarTcSunat(dias: number) {
  const admin = createAdminClient();
  const [y, m, d] = hoyLima().split("-").map(Number);
  const fechas = Array.from({ length: dias }, (_, i) => new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  const { data } = await admin.from("tipos_cambio").select("fecha").gte("fecha", fechas[fechas.length - 1]);
  const existentes = new Set((data ?? []).map((r) => String(r.fecha)));
  let nuevos = 0;
  for (const f of fechas) {
    if (existentes.has(f)) continue;
    try {
      const tc = await guardarTcSunat(f);
      if (!existentes.has(tc.fecha)) nuevos++;
      existentes.add(tc.fecha);
      existentes.add(f);
    } catch {
      // día sin publicación o error puntual: se sigue con el resto
    }
  }
  return nuevos;
}
