import { createClient } from "@/lib/supabase/server";
import { cargarReporte, leerFiltros } from "@/lib/reportes";
import { generarExcel, respuestaExcel } from "@/lib/excel";
import { ESTADOS, type EstadoCotizacion } from "@/lib/estados";
import { fecha } from "@/lib/format";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("No autorizado", { status: 401 });
  // Reportes es solo para gerencia
  const { data: permitido } = await supabase.rpc("tiene_permiso", { p: "reportes" });
  if (!permitido) return new Response("Sin permiso para reportes", { status: 403 });

  const f = leerFiltros(new URL(request.url).searchParams);
  const r = await cargarReporte(supabase, f);
  const sub = `Del ${fecha(f.desde)} al ${fecha(f.hasta)} · montos en soles · generado ${new Date().toLocaleString("es-PE", { timeZone: "America/Lima" })}`;

  const buffer = await generarExcel(
    [
      {
        nombre: "Resumen", titulo: "Resumen comercial",
        columnas: [{ header: "Indicador", key: "k", width: 32 }, { header: "Valor", key: "v", width: 18, tipo: "num" }],
        filas: [
          { k: "Cotizaciones emitidas", v: r.resumen.cantidad },
          { k: "Monto cotizado (S/)", v: r.resumen.cotizado },
          { k: "Cotizaciones aceptadas", v: r.resumen.aceptadas },
          { k: "Monto aceptado (S/)", v: r.resumen.aceptado },
          { k: "Pendientes de respuesta", v: r.resumen.pendientes },
          { k: "Monto pendiente (S/)", v: r.resumen.pendiente },
          { k: "Ticket promedio (S/)", v: r.resumen.ticket },
          { k: "Tasa de cierre (%)", v: r.resumen.tasa },
          { k: "Anuladas", v: r.resumen.anuladas },
        ],
      },
      {
        nombre: "Por mes", titulo: "Cotizaciones por mes",
        columnas: [
          { header: "Mes", key: "mes", width: 12 }, { header: "Cantidad", key: "cantidad", tipo: "int" },
          { header: "Cotizado", key: "cotizado", tipo: "money", width: 16 }, { header: "Aceptado", key: "aceptado", tipo: "money", width: 16 },
        ],
        filas: r.por_mes,
      },
      {
        nombre: "Por agente", titulo: "Desempeño por agente",
        columnas: [
          { header: "Agente", key: "agente", width: 28 }, { header: "Cotizaciones", key: "cantidad", tipo: "int" },
          { header: "Cotizado", key: "cotizado", tipo: "money", width: 16 }, { header: "Aceptadas", key: "aceptadas", tipo: "int" },
          { header: "Aceptado", key: "aceptado", tipo: "money", width: 16 }, { header: "Tasa de cierre", key: "tasa", tipo: "pct" },
        ],
        filas: r.por_agente,
      },
      {
        nombre: "Por cliente", titulo: "Cotizaciones por cliente",
        columnas: [
          { header: "Cliente", key: "cliente", width: 38 }, { header: "Documento", key: "documento", width: 14 },
          { header: "Cotizaciones", key: "cantidad", tipo: "int" }, { header: "Cotizado", key: "cotizado", tipo: "money", width: 16 },
          { header: "Aceptadas", key: "aceptadas", tipo: "int" }, { header: "Aceptado", key: "aceptado", tipo: "money", width: 16 },
          { header: "Última", key: "ultima", tipo: "date" },
        ],
        filas: r.por_cliente,
      },
      {
        nombre: "Por artículo", titulo: "Artículos más cotizados",
        columnas: [
          { header: "Código", key: "codigo", width: 16 }, { header: "Artículo", key: "articulo", width: 40 },
          { header: "Cotizaciones", key: "cotizaciones", tipo: "int" }, { header: "Cantidad", key: "cantidad", tipo: "num" },
          { header: "Monto cotizado", key: "monto", tipo: "money", width: 16 }, { header: "Costo", key: "costo", tipo: "money", width: 16 },
          { header: "Aceptado", key: "aceptado", tipo: "money", width: 16 },
        ],
        filas: r.por_articulo,
      },
      {
        nombre: "Por proveedor", titulo: "Compras estimadas por proveedor",
        columnas: [
          { header: "Proveedor", key: "proveedor", width: 38 }, { header: "RUC", key: "ruc", width: 14 },
          { header: "Ítems", key: "items", tipo: "int" }, { header: "Costo cotizado", key: "costo", tipo: "money", width: 16 },
          { header: "Costo aceptado", key: "costo_aceptado", tipo: "money", width: 16 },
        ],
        filas: r.por_proveedor,
      },
      {
        nombre: "Por estado", titulo: "Cotizaciones por estado",
        columnas: [
          { header: "Estado", key: "estado", width: 16 }, { header: "Cantidad", key: "cantidad", tipo: "int" },
          { header: "Monto", key: "monto", tipo: "money", width: 16 },
        ],
        filas: r.por_estado.map((e) => ({ ...e, estado: ESTADOS[e.estado as EstadoCotizacion]?.label ?? e.estado })),
      },
    ],
    sub,
  );
  return respuestaExcel(buffer, `reporte-comercial_${f.desde}_${f.hasta}.xlsx`);
}
