"use server";

import { revalidatePath } from "next/cache";
import { getSesion, requirePermiso } from "@/lib/sesion";
import { consultarDni, consultarRuc, type DatosDocumento } from "@/lib/decolecta";
import { completarTcSunat, guardarTcSunat } from "@/lib/tipo-cambio";
import { hoyLima } from "@/lib/format";

export async function consultarDocumento(
  tipo: string,
  numero: string,
): Promise<{ ok: true; datos: DatosDocumento } | { ok: false; error: string }> {
  await getSesion();
  const n = numero.replace(/\D/g, "");
  try {
    if (tipo === "RUC") {
      if (n.length !== 11) return { ok: false, error: "El RUC debe tener 11 dígitos" };
      return { ok: true, datos: await consultarRuc(n) };
    }
    if (tipo === "DNI") {
      if (n.length !== 8) return { ok: false, error: "El DNI debe tener 8 dígitos" };
      return { ok: true, datos: await consultarDni(n) };
    }
    return { ok: false, error: "Solo se puede consultar RUC o DNI" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Trae el T.C. SUNAT de hoy y lo guarda (o actualiza) en la tabla tipos_cambio */
export async function traerTipoCambio(): Promise<{ ok: true; mensaje: string } | { ok: false; error: string }> {
  await requirePermiso("tipos_cambio");
  try {
    const tc = await guardarTcSunat(hoyLima());
    revalidatePath("/configuracion/tipos-cambio");
    return { ok: true, mensaje: `Actualizado: SUNAT ${tc.fecha}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Completa el historial de los últimos 30 días con los valores de SUNAT */
export async function completarHistorialTc(): Promise<{ ok: true; mensaje: string } | { ok: false; error: string }> {
  await requirePermiso("tipos_cambio");
  try {
    const n = await completarTcSunat(30);
    revalidatePath("/configuracion/tipos-cambio");
    return { ok: true, mensaje: n ? `Se agregaron ${n} día(s) desde SUNAT` : "El historial de 30 días ya estaba completo" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
