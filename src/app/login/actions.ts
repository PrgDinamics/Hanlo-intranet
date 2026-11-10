"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function iniciarSesion(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  if (!email || !password) return { error: "Ingresa tu correo y contraseña" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Correo o contraseña incorrectos" };

  redirect(rutaInterna(next));
}

/**
 * Solo rutas de la propia intranet: se interpreta "next" como URL contra un origen ficticio y
 * se rechaza si apunta a otro sitio ("//sitio.com", "/\\sitio.com", "/\t/sitio.com"...).
 */
function rutaInterna(next: string): string {
  if (!next.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(next)) return "/";
  try {
    const base = "http://intranet.local";
    const u = new URL(next, base);
    return u.origin === base ? `${u.pathname}${u.search}${u.hash}` : "/";
  } catch {
    return "/";
  }
}

export async function cerrarSesion() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
