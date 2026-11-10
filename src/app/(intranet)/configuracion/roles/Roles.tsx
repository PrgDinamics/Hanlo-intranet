"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { eliminarRol, guardarRol, type RolInput } from "@/lib/acciones-roles";
import { PERMISOS } from "@/lib/permisos";
import ui from "@/components/ui/ui.module.css";
import s from "./roles.module.css";

export type RolFila = { id: string; nombre: string; descripcion: string | null; sistema: boolean; permisos: string[]; usuarios: number };

const GRUPOS = [...new Set(PERMISOS.map((p) => p.grupo))];
const corto = (clave: string) => PERMISOS.find((p) => p.clave === clave)?.label ?? clave;

export function Roles({ roles }: { roles: RolFila[] }) {
  const router = useRouter();
  const [form, setForm] = useState<(RolInput & { sistema: boolean; usuarios: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const abrir = (r?: RolFila) => {
    setError(null);
    setForm(r
      ? { id: r.id, nombre: r.nombre, descripcion: r.descripcion ?? "", permisos: r.permisos, sistema: r.sistema, usuarios: r.usuarios }
      : { id: null, nombre: "", descripcion: "", permisos: [], sistema: false, usuarios: 0 });
  };
  const alternar = (clave: string) =>
    setForm((f) => f && { ...f, permisos: f.permisos.includes(clave) ? f.permisos.filter((x) => x !== clave) : [...f.permisos, clave] });

  const guardar = () => form && start(async () => {
    const r = await guardarRol(form);
    if (!r.ok) return setError(r.error);
    setForm(null);
    router.refresh();
  });
  const eliminar = () => form?.id && start(async () => {
    if (!confirm(`¿Eliminar el rol "${form.nombre}"?`)) return;
    const r = await eliminarRol(form.id!);
    if (!r.ok) return setError(r.error);
    setForm(null);
    router.refresh();
  });

  return (
    <div className={ui.card}>
      <div className={ui.cardHead}>
        <span className={ui.cardTitle}><ShieldCheck /> {roles.length} roles</span>
        <button className={`${ui.btn} ${ui.primary}`} onClick={() => abrir()}><Plus /> Nuevo rol</button>
      </div>
      <div className={s.lista}>
        {roles.map((r) => (
          <button key={r.id} type="button" className={s.rol} onClick={() => abrir(r)}>
            <div className={s.rolHead}>
              <strong>{r.nombre}</strong>
              {r.sistema ? <Badge tono="brand"><Lock size={11} /> Fijo</Badge> : null}
              <span className={ui.muted}>{r.usuarios} usuario{r.usuarios === 1 ? "" : "s"}</span>
            </div>
            {r.descripcion && <p className={s.desc}>{r.descripcion}</p>}
            <div className={s.chips}>
              {r.sistema ? <span className={s.chip}>Todos los permisos</span>
                : r.permisos.length === 0 ? <span className={`${s.chip} ${s.chipMuted}`}>Solo cotiza (lo suyo)</span>
                : r.permisos.map((p) => <span key={p} className={s.chip}>{corto(p)}</span>)}
            </div>
          </button>
        ))}
      </div>

      <Modal
        open={!!form}
        onClose={() => !pending && setForm(null)}
        title={form?.sistema ? "Rol Administrador" : form?.id ? "Editar rol" : "Nuevo rol"}
        width={620}
        footer={form && (
          <>
            {form.id && !form.sistema && (
              <button className={`${ui.btn} ${ui.danger}`} style={{ marginRight: "auto" }} onClick={eliminar} disabled={pending}><Trash2 /> Eliminar</button>
            )}
            <button className={ui.btn} onClick={() => setForm(null)} disabled={pending}>{form.sistema ? "Cerrar" : "Cancelar"}</button>
            {!form.sistema && (
              <button className={`${ui.btn} ${ui.primary}`} onClick={guardar} disabled={pending}>{pending ? "Guardando..." : "Guardar"}</button>
            )}
          </>
        )}
      >
        {form && (
          <div className={ui.stack}>
            {error && <div className={ui.alert}><AlertCircle /> {error}</div>}
            {form.sistema && (
              <div className={`${ui.alert} ${s.info}`}><Lock /> Este rol es fijo: siempre tiene todos los permisos, así nunca se pierde el acceso total.</div>
            )}
            <label className={ui.field}>
              <span className={`${ui.label} ${ui.req}`}>Nombre del rol</span>
              <input className={ui.input} value={form.nombre} maxLength={40} disabled={form.sistema} placeholder="Ej. Coordinador comercial"
                onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </label>
            <label className={ui.field}>
              <span className={ui.label}>Descripción</span>
              <input className={ui.input} value={form.descripcion} maxLength={300} disabled={form.sistema} placeholder="Para qué sirve este rol"
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
            </label>
            {GRUPOS.map((g) => (
              <fieldset key={g} className={s.grupo}>
                <legend>{g}</legend>
                {PERMISOS.filter((p) => p.grupo === g).map((p) => (
                  <label key={p.clave} className={s.permiso}>
                    <input type="checkbox" disabled={form.sistema} checked={form.sistema || form.permisos.includes(p.clave)} onChange={() => alternar(p.clave)} />
                    <span>
                      {p.label}
                      {"hint" in p && p.hint && <small>{p.hint}</small>}
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
            <p className={ui.hint}>
              Todos los roles pueden cotizar. Usuarios, roles y agentes comerciales (con sus límites de venta) son siempre exclusivos del Administrador.
              {form.usuarios > 0 && ` Los cambios aplican de inmediato a ${form.usuarios} usuario${form.usuarios === 1 ? "" : "s"}.`}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
