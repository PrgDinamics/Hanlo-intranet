import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireAdmin } from "@/lib/sesion";
import { Usuarios } from "./Usuarios";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsuariosPage() {
  const { supabase, perfil } = await requireAdmin();
  const [{ data: usuarios }, { data: agentes }, { data: roles }] = await Promise.all([
    supabase.from("perfiles").select("id, nombre, email, rol, rol_id, agente_id, activo, created_at, r:roles(nombre, sistema), agente:agentes(nombre, crea_cliente, crea_articulo, limite_venta)").order("nombre"),
    supabase.from("agentes").select("id, nombre").eq("activo", true).order("nombre"),
    supabase.from("roles").select("id, nombre, sistema").order("sistema", { ascending: false }).order("nombre"),
  ]);
  return (
    <>
      <PageHeader title="Usuarios" subtitle="Personas con acceso a la intranet y su rol. Lo que puede hacer cada rol se define en Roles y permisos." />
      <Usuarios
        yo={perfil.id}
        usuarios={(usuarios ?? []).map((u) => {
          const a = u.agente as { nombre?: string; crea_cliente?: boolean; crea_articulo?: boolean; limite_venta?: number | null } | null;
          const permisos = a
            ? [a.crea_cliente && "clientes", a.crea_articulo && "artículos"].filter(Boolean).join(" y ")
            : "";
          const r = u.r as { nombre?: string; sistema?: boolean } | null;
          return {
            id: u.id, nombre: u.nombre, email: u.email, rol_id: u.rol_id as string, agente_id: u.agente_id,
            activo: u.activo, created_at: u.created_at,
            rol_nombre: r?.nombre ?? "Vendedor",
            rol_sistema: !!r?.sistema,
            agente_nombre: a?.nombre ?? null,
            permisos_txt: r?.sistema ? "Todo" : a
              ? `${permisos ? `Crea ${permisos}` : "Solo cotiza"} · ${a.limite_venta != null ? `límite S/ ${Number(a.limite_venta).toLocaleString("es-PE")}` : "sin límite"}`
              : "Sin agente: solo cotiza, sin límite",
          };
        })}
        agentes={(agentes ?? []).map((a) => ({ value: a.id, label: a.nombre }))}
        roles={(roles ?? []).map((r) => ({ value: r.id, label: r.nombre }))}
        rolVendedor={(roles ?? []).find((r) => r.nombre === "Vendedor")?.id ?? (roles ?? []).find((r) => !r.sistema)?.id ?? ""}
      />
    </>
  );
}
