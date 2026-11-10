import { createClient } from "@/lib/supabase/server";
import { generarExcel, respuestaExcel } from "@/lib/excel";
import { ESTADOS, type EstadoCotizacion } from "@/lib/estados";
import { haceDias, hoyLima } from "@/lib/format";
import { filtroNumero, todasLasFilas } from "@/lib/consultas";

/** Exporta el listado de cotizaciones con los mismos filtros de la pantalla */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("No autorizado", { status: 401 });

  const sp = new URL(request.url).searchParams;
  const q = sp.get("q")?.trim();
  const estado = sp.get("estado");
  const agente = sp.get("agente");
  const periodo = sp.get("periodo");

  const consulta = () => {
    let query = supabase
      .from("v_cotizaciones")
      .select("codigo, fecha_emision, fecha_vencimiento, cliente_nombre, cliente_doc, empresa_nombre, agente_nombre, forma_pago_nombre, moneda, tipo_cambio, subtotal, igv, total, estado, motivo_anulacion");
    if (q) {
      const t = q.replace(/[%,()]/g, " ");
      query = query.or([`cliente_nombre.ilike.%${t}%`, `cliente_doc.ilike.%${t}%`, filtroNumero(t)].filter(Boolean).join(","));
    }
    if (estado) query = query.eq("estado", estado);
    else query = query.neq("estado", "reemplazada");
    if (agente) query = query.eq("agente_id", agente);
    if (periodo) {
      const hoy = hoyLima();
      const desde = periodo === "mes" ? `${hoy.slice(0, 7)}-01` : periodo === "anio" ? `${hoy.slice(0, 4)}-01-01` : periodo === "30" ? haceDias(30) : null;
      if (desde) query = query.gte("fecha_emision", desde);
    }
    // orden estable para paginar: fecha, número, versión e id
    return query.order("fecha_emision", { ascending: false }).order("numero", { ascending: false })
      .order("version", { ascending: false }).order("id");
  };
  // La API devuelve como máximo 1000 filas por consulta: se pide por páginas hasta 10,000
  let data;
  try {
    data = await todasLasFilas((a, b) => consulta().range(a, b), 10000);
  } catch (e) {
    return new Response(`No se pudo generar el Excel: ${(e as Error).message}`, { status: 500 });
  }

  const buffer = await generarExcel([
    {
      nombre: "Cotizaciones",
      titulo: "Listado de cotizaciones",
      columnas: [
        { header: "Código", key: "codigo", width: 16 }, { header: "Emisión", key: "fecha_emision", tipo: "date" },
        { header: "Vence", key: "fecha_vencimiento", tipo: "date" }, { header: "Cliente", key: "cliente_nombre", width: 36 },
        { header: "Documento", key: "cliente_doc", width: 14 }, { header: "Empresa", key: "empresa_nombre", width: 26 },
        { header: "Agente", key: "agente_nombre", width: 20 }, { header: "Forma de pago", key: "forma_pago_nombre", width: 20 },
        { header: "Moneda", key: "moneda", width: 8 }, { header: "T.C.", key: "tipo_cambio", tipo: "num", width: 8 },
        { header: "Subtotal", key: "subtotal", tipo: "num", width: 14 }, { header: "IGV", key: "igv", tipo: "num", width: 12 },
        { header: "Total", key: "total", tipo: "num", width: 14 }, { header: "Estado", key: "estado", width: 12 },
        { header: "Motivo anulación", key: "motivo_anulacion", width: 30 },
      ],
      filas: data.map((c) => ({ ...c, estado: ESTADOS[c.estado as EstadoCotizacion]?.label ?? c.estado })),
    },
  ]);
  return respuestaExcel(buffer, `cotizaciones_${hoyLima()}.xlsx`);
}
