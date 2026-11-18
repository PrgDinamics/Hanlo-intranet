import { createClient } from "@/lib/supabase/server";
import { generarExcel, respuestaExcel } from "@/lib/excel";
import { haceDias, hoyLima } from "@/lib/format";
import { todasLasFilas } from "@/lib/consultas";
import { ACCION, DIAS_ACTIVIDAD, TABLAS, cambiosEnTexto, fechaHora } from "@/lib/actividad";

/** Descarga el registro de actividad con los mismos filtros de la pantalla (se guarda 45 días) */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("No autorizado", { status: 401 });
  const { data: permitido } = await supabase.rpc("tiene_permiso", { p: "actividad" });
  if (!permitido) return new Response("Sin permiso para el registro de actividad", { status: 403 });

  const sp = new URL(request.url).searchParams;
  const q = sp.get("q")?.trim();
  const tabla = sp.get("tabla") && sp.get("tabla")! in TABLAS ? sp.get("tabla") : null;
  const accion = sp.get("accion") && sp.get("accion")! in ACCION ? sp.get("accion") : null;
  const periodo = /^\d{1,4}$/.test(sp.get("periodo") ?? "") ? sp.get("periodo") : null;

  const consulta = () => {
    let query = supabase.from("actividad").select("id, created_at, usuario, tabla, registro, accion, cambios");
    if (q) {
      const t = q.replace(/[%,()]/g, " ");
      query = query.or(`registro.ilike.%${t}%,usuario.ilike.%${t}%`);
    }
    if (tabla) query = query.eq("tabla", tabla);
    if (accion) query = query.eq("accion", accion);
    if (periodo) query = query.gte("created_at", haceDias(Number(periodo)));
    return query.order("created_at", { ascending: false }).order("id");
  };
  let data;
  try {
    data = await todasLasFilas((a, b) => consulta().range(a, b), 50000);
  } catch (e) {
    return new Response(`No se pudo generar el Excel: ${(e as Error).message}`, { status: 500 });
  }

  const buffer = await generarExcel([
    {
      nombre: "Actividad",
      titulo: `Registro de actividad (últimos ${DIAS_ACTIVIDAD} días como máximo)`,
      columnas: [
        { header: "Fecha y hora", key: "fecha", width: 18 }, { header: "Usuario", key: "usuario", width: 26 },
        { header: "Acción", key: "accion", width: 10 }, { header: "Módulo", key: "modulo", width: 20 },
        { header: "Registro", key: "registro", width: 36 }, { header: "Cambios", key: "cambios", width: 90 },
      ],
      filas: data.map((a) => ({
        fecha: fechaHora(a.created_at),
        usuario: a.usuario ?? "Sistema",
        accion: ACCION[a.accion as keyof typeof ACCION]?.label ?? a.accion,
        modulo: TABLAS[a.tabla]?.label ?? a.tabla,
        registro: a.registro,
        cambios: cambiosEnTexto(a.accion, a.cambios),
      })),
    },
  ]);
  return respuestaExcel(buffer, `actividad_${hoyLima()}.xlsx`);
}
