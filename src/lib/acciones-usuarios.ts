"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/sesion";
import { createAdminClient } from "@/lib/supabase/admin";
import { mensajeError } from "@/lib/errores";
import type { Resultado } from "@/lib/acciones";

export type UsuarioInput = {
  id?: string | null;
  nombre: string;
  email: string;
  password?: string;
  rol_id: string;
  agente_id: string | null;
  activo: boolean;
};

export async function guardarUsuario(u: UsuarioInput): Promise<Resultado> {
  const { supabase, perfil } = await requireAdmin();
  const nombre = u.nombre.trim();
  const email = u.email.trim().toLowerCase();
  if (!nombre || !email) return { ok: false, error: "Completa nombre y correo" };
  if (u.password && u.password.length < 8) return { ok: false, error: "La contraseña debe tener al menos 8 caracteres" };
  const { data: rol } = await supabase.from("roles").select("id, sistema").eq("id", u.rol_id).maybeSingle();
  if (!rol) return { ok: false, error: "Elige un rol" };
  if (u.id === perfil.id && (!rol.sistema || !u.activo)) {
    return { ok: false, error: "No puedes quitarte el rol de Administrador ni desactivarte a ti mismo" };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  let id = u.id ?? null;
  if (!id) {
    if (!u.password) return { ok: false, error: "Define una contraseña inicial" };
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: u.password,
      email_confirm: true,
      user_metadata: { nombre },
    });
    if (error) {
      return { ok: false, error: /already|registered|exists/i.test(error.message) ? "Ya existe un usuario con ese correo" : error.message };
    }
    id = data.user.id;
  } else {
    const cambios: { email?: string; password?: string; ban_duration?: string } = { email };
    if (u.password) cambios.password = u.password;
    cambios.ban_duration = u.activo ? "none" : "876000h";
    const { error } = await admin.auth.admin.updateUserById(id, cambios);
    if (error) return { ok: false, error: error.message };
  }

  const { error } = await supabase
    .from("perfiles")
    .update({ nombre, email, rol_id: rol.id, agente_id: u.agente_id || null, activo: u.activo })
    .eq("id", id);
  if (error) return { ok: false, error: mensajeError(error) };

  revalidatePath("/configuracion/usuarios");
  return { ok: true, id };
}
