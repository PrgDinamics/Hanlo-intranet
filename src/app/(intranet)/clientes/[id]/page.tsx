import Link from "next/link";
import { notFound } from "next/navigation";
import { History, Plus, User } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EstadoBadge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { DetalleForm } from "@/components/crud/DetalleForm";
import { cargarRefs } from "@/components/crud/ModuloPage";
import { getSesion } from "@/lib/sesion";
import { consultaHabilitada } from "@/lib/decolecta";
import { fecha, money } from "@/lib/format";
import { esUuid, todasLasFilas } from "@/lib/consultas";
import ui from "@/components/ui/ui.module.css";
import d from "@/components/crud/detalle.module.css";

export default async function ClientePage({ params }: PageProps<"/clientes/[id]">) {
  const { id } = await params;
  // Un id que no es UUID haría fallar la consulta de cotizaciones (todasLasFilas lanza): es "no encontrado"
  if (!esUuid(id)) notFound();
  const { supabase, permisos } = await getSesion();
  const editable = permisos.crea_cliente;
  const [{ data: cli }, lista, refs] = await Promise.all([
    supabase.from("clientes").select("*").eq("id", id).maybeSingle(),
    // Todas las cotizaciones del cliente por páginas (la API corta en 1000): los totales salen de la lista completa
    todasLasFilas((a, b) => supabase.from("v_cotizaciones")
      .select("id, codigo, fecha_emision, total, moneda, tipo_cambio, estado, agente_nombre")
      .eq("cliente_id", id).neq("estado", "reemplazada")
      .order("fecha_emision", { ascending: false }).order("id").range(a, b)),
    cargarRefs("clientes"),
  ]);
  if (!cli) notFound();

  const enSoles = (c: (typeof lista)[number]) => (c.moneda === "USD" ? Number(c.total) * Number(c.tipo_cambio ?? 1) : Number(c.total));
  const validas = lista.filter((c) => c.estado !== "anulada" && c.estado !== "borrador");
  const aceptadas = validas.filter((c) => c.estado === "aceptada");
  const cerradas = validas.filter((c) => ["aceptada", "rechazada", "vencida"].includes(c.estado));

  return (
    <>
      <PageHeader
        back={{ href: "/clientes", label: "Clientes" }}
        title={cli.nombre}
        subtitle={<>{cli.tipo_doc} <span className={ui.mono}>{cli.num_doc}</span></>}
        actions={
          <Link href={`/cotizaciones/nueva?cliente=${id}`} className={`${ui.btn} ${ui.primary}`}>
            <Plus /> Cotizar a este cliente
          </Link>
        }
      />
      <div className={d.layout}>
        <div className={ui.card}>
          <div className={ui.cardHead}><span className={ui.cardTitle}><User /> Datos del cliente</span></div>
          <div className={ui.cardBody}>
            <DetalleForm modKey="clientes" registro={cli} refs={refs} consulta={consultaHabilitada()} soloLectura={!editable} />
          </div>
        </div>

        <div className={ui.card}>
          <div className={ui.cardHead}><span className={ui.cardTitle}><History /> Récord comercial</span></div>
          <div className={d.stats} style={{ borderBottom: "1px solid var(--border)" }}>
            <div><small>Cotizaciones</small><strong>{validas.length}</strong></div>
            <div><small>Aceptadas</small><strong>{aceptadas.length}</strong></div>
            <div><small>Monto aceptado</small><strong>{money(aceptadas.reduce((a, c) => a + enSoles(c), 0))}</strong></div>
            <div><small>Tasa de cierre</small><strong>{cerradas.length ? Math.round((aceptadas.length / cerradas.length) * 100) : 0}%</strong></div>
          </div>
          {lista.length === 0 ? (
            <Empty>Este cliente aún no tiene cotizaciones</Empty>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead><tr><th>Código</th><th>Fecha</th><th className={ui.num}>Total</th><th>Estado</th></tr></thead>
                <tbody>
                  {lista.map((c) => (
                    <tr key={c.id}>
                      <td><Link href={`/cotizaciones/${c.id}`} className={ui.mono} style={{ color: "var(--brand-ink)" }}>{c.codigo}</Link></td>
                      <td>{fecha(c.fecha_emision)}</td>
                      <td className={ui.num}>{money(c.total, c.moneda)}</td>
                      <td><EstadoBadge estado={c.estado} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
