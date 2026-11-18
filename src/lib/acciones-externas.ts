"use server";

import { getSesion } from "@/lib/sesion";
import { consultarDni, consultarRuc, type DatosDocumento } from "@/lib/decolecta";

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
