import "@/lib/supabase/silencio";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

const PUBLICAS = ["/login", "/api/keepalive"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const logueado = !!data?.claims;
  // Sesión vieja que Supabase ya no reconoce (cerró sesión en otro lado, cambió la clave, etc.):
  // se borran sus cookies para que no se vuelva a intentar en cada página
  const viejas = logueado ? [] : request.cookies.getAll().filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name)).map((c) => c.name);
  const limpiar = <T extends NextResponse>(res: T) => {
    for (const n of viejas) res.cookies.delete(n);
    return res;
  };
  const { pathname } = request.nextUrl;
  const esPublica = PUBLICAS.some((p) => pathname.startsWith(p));

  // Las acciones del servidor (guardar, emitir...) responden ellas mismas con la redirección al login;
  // si el proxy las redirigiera, el navegador recibiría la página de login en vez de la respuesta y fallaría.
  const esAccion = request.method === "POST" && request.headers.has("next-action");
  if (!logueado && !esPublica && !esAccion) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return limpiar(NextResponse.redirect(url));
  }
  if (logueado && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return limpiar(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|pdfjs/).*)"],
};
