import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { getSesion } from "@/lib/sesion";
import { fecha, haceDias, hoyLima, num } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";
import s from "./resumen-tc.module.css";

/** Tipo de cambio vigente, variación contra el registro anterior y rango de los últimos 30 días */
export async function ResumenTc() {
  const { supabase } = await getSesion();
  const { data } = await supabase
    .from("tipos_cambio")
    .select("fecha, compra, venta, fuente")
    .gte("fecha", haceDias(30))
    .order("fecha", { ascending: false });
  const filas = (data ?? []).map((r) => ({ ...r, compra: Number(r.compra), venta: Number(r.venta) }));
  const hoy = hoyLima();
  const actual = filas[0];
  if (!actual) return null;
  const anterior = filas[1];
  const dif = anterior ? actual.venta - anterior.venta : 0;
  const ventas = filas.map((f) => f.venta);
  const min = Math.min(...ventas), max = Math.max(...ventas);
  const prom = ventas.reduce((a, b) => a + b, 0) / ventas.length;
  const Flecha = dif > 0.0005 ? ArrowUpRight : dif < -0.0005 ? ArrowDownRight : Minus;

  return (
    <section className={s.grid}>
      <div className={`${ui.card} ${s.hoy}`}>
        <div className={s.titulo}>
          {actual.fecha === hoy ? "Hoy" : "Último registrado"} · {fecha(actual.fecha)}
          <span className={actual.fuente === "sunat" ? s.sunat : s.manual}>{actual.fuente === "sunat" ? "SUNAT" : "Manual"}</span>
        </div>
        <div className={s.valores}>
          <div><small>Compra</small><strong>{num(actual.compra, 3)}</strong></div>
          <div><small>Venta</small><strong>{num(actual.venta, 3)}</strong></div>
        </div>
        {anterior && (
          <div className={`${s.var} ${dif > 0.0005 ? s.sube : dif < -0.0005 ? s.baja : ""}`}>
            <Flecha /> {dif >= 0 ? "+" : ""}{num(dif, 3)} vs {fecha(anterior.fecha)}
          </div>
        )}
        {actual.fecha !== hoy && <p className={ui.hint}>Aún no hay tipo de cambio de hoy. Las cotizaciones usan este.</p>}
      </div>
      <div className={`${ui.card} ${s.rango}`}>
        <div className={s.titulo}>Venta · últimos 30 días ({filas.length} registros)</div>
        <div className={s.valores}>
          <div><small>Mínimo</small><strong>{num(min, 3)}</strong></div>
          <div><small>Promedio</small><strong>{num(prom, 3)}</strong></div>
          <div><small>Máximo</small><strong>{num(max, 3)}</strong></div>
        </div>
      </div>
    </section>
  );
}
