import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireAdmin } from "@/lib/sesion";
import { Usuarios } from "./Usuarios";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsuariosPage() {
  const { supabase, perfil } = await requireAdmin();
  const [{ data: usuarios }, { data: agentes }, { data: roles }, { data: empresas }, { data: asignadas }] = await Promise.all([
    supabase.from("perfiles").select("id, nombre, email, rol, rol_id, agente_id, activo, created_at, r:roles(nombre, sistema), agente:agentes(nombre, crea_cliente, crea_articulo, limite_venta)").order("nombre"),
    supabase.from("agentes").select("id, nombre").eq("activo", true).order("nombre"),
    supabase.from("roles").select("id, nombre, sistema").order("sistema", { ascending: false }).order("nombre"),
    supabase.from("empresas").select("id, razon_social, activo").order("razon_social"),
    supabase.from("perfil_empresas").select("perfil_id, empresa_id"),
  ]);
  const nombreEmpresa = new Map((empresas ?? []).map((e) => [e.id, e.razon_social as string]));
  return (
    <>
      <PageHeader title="Usuarios" subtitle="Personas con acceso a la intranet y su rol. Lo que puede hacer cada rol se define en Roles y permisos." />
      <Usuarios
        yo={perfil.id}
        usuarios={(usuarios ?? []).map((u) => {
          const a = u.agente as { nombre?: string } | null;
          const suyas = (asignadas ?? []).filter((x) => x.perfil_id === u.id).map((x) => x.empresa_id as string)
            .filter((e) => nombreEmpresa.has(e));
          const r = u.r as { nombre?: string; sistema?: boolean } | null;
          return {
            id: u.id, nombre: u.nombre, email: u.email, rol_id: u.rol_id as string, agente_id: u.agente_id,
            activo: u.activo, created_at: u.created_at,
            rol_nombre: r?.nombre ?? "Vendedor",
            rol_sistema: !!r?.sistema,
            agente_nombre: a?.nombre ?? null,
            empresas: suyas,
            empresas_txt: r?.sistema ? "Todas" : suyas.length ? suyas.map((e) => nombreEmpresa.get(e)).join(", ") : "Ninguna",
          };
        })}
        agentes={(agentes ?? []).map((a) => ({ value: a.id, label: a.nombre }))}
        roles={(roles ?? []).map((r) => ({ value: r.id, label: r.nombre }))}
        rolesAdmin={(roles ?? []).filter((r) => r.sistema).map((r) => r.id)}
        empresas={(empresas ?? []).map((e) => ({ value: e.id, label: e.activo ? e.razon_social : `${e.razon_social} (inactiva)` }))}
        empresasActivas={(empresas ?? []).filter((e) => e.activo).map((e) => e.id)}
        rolVendedor={(roles ?? []).find((r) => r.nombre === "Vendedor")?.id ?? (roles ?? []).find((r) => !r.sistema)?.id ?? ""}
      />
    </>
  );
}
