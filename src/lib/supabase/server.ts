import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/**
 * opciones.sinActividad: para importaciones masivas. Los cambios fila por fila no van al
 * registro de actividad (solo se respeta si el usuario es admin); se registra un resumen.
 */
export async function createClient(opciones?: { sinActividad?: boolean }) {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    global: opciones?.sinActividad ? { headers: { "x-sin-actividad": "1" } } : undefined,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Llamado desde un Server Component: el proxy refresca la sesión.
        }
      },
    },
  });
}
