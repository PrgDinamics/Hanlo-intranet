/**
 * Se llama al cargar el proxy y el cliente de Supabase del servidor (una vez por proceso).
 * Supabase escribe en la consola un error cuando el navegador trae una sesión vieja que ya no existe
 * ("Invalid Refresh Token: Refresh Token Not Found"). No es un error de la intranet: el usuario solo
 * vuelve al login y el proxy borra esas cookies. Se calla solo ese caso; cualquier otro error se sigue viendo.
 */
const SESION_VENCIDA = new Set(["refresh_token_not_found", "refresh_token_already_used", "session_expired"]);

export function silenciarSesionVencida() {
  if ((globalThis as { __hanloSilencio?: boolean }).__hanloSilencio) return;
  (globalThis as { __hanloSilencio?: boolean }).__hanloSilencio = true;
  const vencida = (args: unknown[]) => {
    const e = args[0] as { __isAuthError?: boolean; code?: string } | undefined;
    return args.length === 1 && !!e && typeof e === "object" && !!e.__isAuthError && !!e.code && SESION_VENCIDA.has(e.code);
  };
  // Supabase lo escribe con console.error o console.warn según dónde lo detecta
  for (const m of ["error", "warn"] as const) {
    const original = console[m];
    console[m] = (...args: unknown[]) => { if (!vencida(args)) original(...args); };
  }
}
silenciarSesionVencida();
