import { PageHeader } from "@/components/ui/PageHeader";
import { FilterSelect, SearchBox } from "@/components/ui/SearchBox";
import { Pager, pageRange } from "@/components/ui/Pager";
import { getSesion, puedeEditar, requireAdmin, requirePermiso } from "@/lib/sesion";
import { MODULOS } from "@/lib/modulos";
import { consultaHabilitada } from "@/lib/decolecta";
import { CrudTabla, NuevoBoton } from "./CrudTabla";
import type { Refs } from "./RegistroForm";
import ui from "@/components/ui/ui.module.css";

type SP = Record<string, string | string[] | undefined>;

export async function cargarRefs(modKey: string): Promise<Refs> {
  const { supabase } = await getSesion();
  const refs: Refs = {};
  for (const c of MODULOS[modKey].campos) {
    if (!c.ref) continue;
    const { data } = await supabase.from(c.ref.tabla).select(`id, ${c.ref.label}`).order(c.ref.label);
    refs[c.ref.tabla] = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      value: String(r.id),
      label: String(r[c.ref!.label]),
    }));
  }
  return refs;
}

/** Listado genérico de un maestro con búsqueda, filtros y paginación */
export async function ModuloPage({
  modKey, searchParams, extraActions, encabezado,
}: { modKey: string; searchParams: SP; extraActions?: React.ReactNode; encabezado?: React.ReactNode }) {
  const mod = MODULOS[modKey];
  const { supabase, permisos } = mod.permisoRol
    ? await requirePermiso(mod.permisoRol)
    : mod.admin ? await requireAdmin() : await getSesion();
  const editable = puedeEditar(permisos, mod.permiso);

  const str = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const q = str("q")?.trim();
  const { page, from, to } = pageRange(str("p"));

  let query = supabase.from(mod.tabla).select(mod.select, { count: "exact" });
  if (q && mod.busqueda.length) {
    const term = q.replace(/[%,()]/g, " ");
    query = query.or(mod.busqueda.map((c) => `${c}.ilike.%${term}%`).join(","));
  }
  for (const f of mod.filtros ?? []) {
    const v = str(f.name);
    if (v) query = query.eq(f.name, v);
  }
  const { data, count, error } = await query.order(mod.orden.col, { ascending: mod.orden.asc }).range(from, to);
  const refs = await cargarRefs(modKey);
  const consulta = !!mod.consulta && consultaHabilitada();

  const params: Record<string, string | undefined> = { q };
  for (const f of mod.filtros ?? []) params[f.name] = str(f.name);

  return (
    <>
      <PageHeader title={mod.titulo} subtitle={mod.descripcion} actions={<>{extraActions}{editable && <NuevoBoton modKey={modKey} refs={refs} consulta={consulta} />}</>} />
      {encabezado}
      <div className={ui.card}>
        {(mod.busqueda.length > 0 || mod.filtros?.length) && (
          <div className={ui.toolbar}>
            {mod.busqueda.length > 0 && <SearchBox placeholder={`Buscar ${mod.titulo.toLowerCase()}...`} />}
            {mod.filtros?.map((f) => (
              <FilterSelect key={f.name} name={f.name} options={f.options} placeholder={f.label} />
            ))}
          </div>
        )}
        {error ? (
          <div className={ui.cardBody}><div className={ui.alert}>{error.message}</div></div>
        ) : (
          <CrudTabla modKey={modKey} rows={(data ?? []) as unknown as (Record<string, unknown> & { id: string })[]} refs={refs} consulta={consulta} soloLectura={!editable} />
        )}
        <Pager page={page} total={count ?? 0} params={params} path={mod.ruta} />
      </div>
    </>
  );
}
