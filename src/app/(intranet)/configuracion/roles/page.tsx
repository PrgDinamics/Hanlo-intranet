import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireAdmin } from "@/lib/sesion";
import { Roles, type RolFila } from "./Roles";

export const metadata: Metadata = { title: "Roles y permisos" };

export default async function RolesPage() {
  const { supabase } = await requireAdmin();
  const [{ data: roles }, { data: perfiles }] = await Promise.all([
    supabase.from("roles").select("id, nombre, descripcion, sistema, permisos").order("sistema", { ascending: false }).order("nombre"),
    supabase.from("perfiles").select("rol_id").eq("activo", true),
  ]);
  const usuarios = new Map<string, number>();
  for (const p of perfiles ?? []) if (p.rol_id) usuarios.set(p.rol_id, (usuarios.get(p.rol_id) ?? 0) + 1);
  return (
    <>
      <PageHeader
        title="Roles y permisos"
        subtitle="Qué puede hacer cada tipo de usuario. Usuarios, roles y agentes comerciales los administra solo el Administrador."
      />
      <Roles roles={(roles ?? []).map((r) => ({ ...r, usuarios: usuarios.get(r.id) ?? 0 })) as RolFila[]} />
    </>
  );
}
