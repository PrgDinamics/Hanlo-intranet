import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esPermiso, type Permiso } from "@/lib/permisos";

export type Permisos = {
  es_admin: boolean;
  crea_cliente: boolean;
  crea_articulo: boolean;
  /** Monto máximo en soles sin aprobación. null = sin límite */
  limite_venta: number | null;
  /** Permisos de su rol (el Administrador los tiene todos) */
  acciones: Permiso[];
};

export type Perfil = {
  id: string;
  nombre: string;
  email: string | null;
  rol: "admin" | "vendedor";
  rol_id: string | null;
  /** Nombre del rol (Administrador, Vendedor, Coordinador...) */
  rol_nombre: string;
  agente_id: string | null;
  activo: boolean;
};

/**
 * Usuario + perfil de la sesión actual (memoizado por request).
 * getClaims valida el token (localmente si el proyecto usa llaves asimétricas) y evita
 * un viaje extra al servidor de Auth; perfil y permisos se piden en paralelo.
 */
export const getSesion = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  const user = { id: claims.sub, email: (claims.email as string | undefined) ?? null };

  const [{ data: fila0 }, { data: p }, { data: acc }] = await Promise.all([
    supabase.from("perfiles").select("id, nombre, email, rol, rol_id, agente_id, activo, r:roles(nombre)").eq("id", user.id).single(),
    supabase.rpc("mis_permisos"),
    supabase.rpc("mis_permisos_rol"),
  ]);
  const crudo = fila0 as (Omit<Perfil, "rol_nombre"> & { r: { nombre: string } | null }) | null;
  const perfil: Perfil | null = crudo
    ? {
        id: crudo.id, nombre: crudo.nombre, email: crudo.email, rol: crudo.rol, rol_id: crudo.rol_id,
        agente_id: crudo.agente_id, activo: crudo.activo,
        rol_nombre: crudo.r?.nombre ?? (crudo.rol === "admin" ? "Administrador" : "Vendedor"),
      }
    : null;
  if (!perfil || !perfil.activo) {
    await supabase.auth.signOut();
    redirect("/login?error=inactivo");
  }
  const fila = (Array.isArray(p) ? p[0] : p) as Permisos | undefined;
  const permisos: Permisos = {
    es_admin: perfil.rol === "admin",
    crea_cliente: perfil.rol === "admin" || !!fila?.crea_cliente,
    crea_articulo: perfil.rol === "admin" || !!fila?.crea_articulo,
    limite_venta: perfil.rol === "admin" || fila?.limite_venta == null ? null : Number(fila.limite_venta),
    acciones: ((acc as string[] | null) ?? []).filter(esPermiso),
  };
  return { supabase, user, perfil, permisos };
});

/** ¿El usuario puede modificar el maestro indicado? */
export function puedeEditar(permisos: Permisos, permiso?: "crea_cliente" | "crea_articulo") {
  if (!permiso) return true;
  return permisos[permiso];
}

/** ¿La sesión tiene este permiso de rol? */
export function puede(permisos: Permisos, p: Permiso) {
  return permisos.es_admin || permisos.acciones.includes(p);
}

/** Exige un permiso de rol; si no lo tiene, vuelve al dashboard */
export async function requirePermiso(p: Permiso) {
  const s = await getSesion();
  if (!puede(s.permisos, p)) redirect("/");
  return s;
}

export async function requireAdmin() {
  const s = await getSesion();
  if (s.perfil.rol !== "admin") redirect("/");
  return s;
}
