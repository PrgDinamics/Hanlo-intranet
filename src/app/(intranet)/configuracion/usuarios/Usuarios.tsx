"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, KeyRound, Plus, Shield, UserCog } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { guardarUsuario, type UsuarioInput } from "@/lib/acciones-usuarios";
import type { Opcion } from "@/lib/modulos";
import ui from "@/components/ui/ui.module.css";

type U = {
  id: string; nombre: string; email: string | null; rol_id: string; rol_nombre: string; rol_sistema: boolean;
  agente_id: string | null; activo: boolean; created_at: string; agente_nombre: string | null; permisos_txt: string;
};

export function Usuarios({ usuarios, agentes, roles, rolVendedor, yo }: {
  usuarios: U[]; agentes: Opcion[]; roles: Opcion[]; rolVendedor: string; yo: string;
}) {
  const VACIO: UsuarioInput = { id: null, nombre: "", email: "", password: "", rol_id: rolVendedor, agente_id: null, activo: true };
  const router = useRouter();
  const [form, setForm] = useState<UsuarioInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof UsuarioInput, v: unknown) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const guardar = () => {
    if (!form) return;
    setError(null);
    start(async () => {
      const r = await guardarUsuario(form);
      if (!r.ok) return setError(r.error);
      setForm(null);
      router.refresh();
    });
  };

  return (
    <div className={ui.card}>
      <div className={ui.cardHead}>
        <span className={ui.cardTitle}><UserCog /> {usuarios.length} usuarios</span>
        <button className={`${ui.btn} ${ui.primary}`} onClick={() => { setError(null); setForm({ ...VACIO }); }}>
          <Plus /> Nuevo usuario
        </button>
      </div>
      {usuarios.length === 0 ? <Empty /> : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Agente</th><th>Permisos</th><th>Estado</th></tr></thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className={ui.rowLink}
                  onClick={() => { setError(null); setForm({ id: u.id, nombre: u.nombre, email: u.email ?? "", password: "", rol_id: u.rol_id, agente_id: u.agente_id, activo: u.activo }); }}>
                  <td className={ui.strong}>{u.nombre} {u.id === yo && <span className={ui.muted}>(tú)</span>}</td>
                  <td>{u.email}</td>
                  <td>{u.rol_sistema ? <Badge tono="brand">{u.rol_nombre}</Badge> : <Badge>{u.rol_nombre}</Badge>}</td>
                  <td>{u.agente_nombre}</td>
                  <td className={ui.muted}>{u.permisos_txt}</td>
                  <td>{u.activo ? <Badge tono="ok">Activo</Badge> : <Badge tono="muted">Inactivo</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Editar usuario" : "Nuevo usuario"}
        width={540}
        footer={
          <>
            <button className={ui.btn} onClick={() => setForm(null)}>Cancelar</button>
            <button className={`${ui.btn} ${ui.primary}`} onClick={guardar} disabled={pending}>
              {pending ? "Guardando..." : "Guardar"}
            </button>
          </>
        }
      >
        {form && (
          <div className={ui.stack}>
            {error && <div className={ui.alert}><AlertCircle /> {error}</div>}
            <div className={ui.grid}>
              <label className={`${ui.field} ${ui.span12}`}>
                <span className={`${ui.label} ${ui.req}`}>Nombre completo</span>
                <input className={ui.input} value={form.nombre} onChange={(e) => set("nombre", e.target.value)} />
              </label>
              <label className={`${ui.field} ${ui.span12}`}>
                <span className={`${ui.label} ${ui.req}`}>Correo (usuario de acceso)</span>
                <input className={ui.input} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </label>
              <label className={`${ui.field} ${ui.span12}`}>
                <span className={`${ui.label} ${form.id ? "" : ui.req}`}>
                  <KeyRound size={13} style={{ verticalAlign: -2 }} /> {form.id ? "Nueva contraseña" : "Contraseña inicial"}
                </span>
                <input className={ui.input} type="text" autoComplete="new-password" value={form.password ?? ""}
                  placeholder={form.id ? "Dejar vacío para no cambiarla" : "Mínimo 8 caracteres"}
                  onChange={(e) => set("password", e.target.value)} />
              </label>
              <label className={`${ui.field} ${ui.span6}`}>
                <span className={ui.label}><Shield size={13} style={{ verticalAlign: -2 }} /> Rol</span>
                <select className={ui.input} value={form.rol_id} onChange={(e) => set("rol_id", e.target.value)}>
                  {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <label className={`${ui.field} ${ui.span6}`}>
                <span className={ui.label}>Agente comercial</span>
                <select className={ui.input} value={form.agente_id ?? ""} onChange={(e) => set("agente_id", e.target.value || null)}>
                  <option value="">(ninguno)</option>
                  {agentes.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </label>
              <div className={ui.span12}>
                <label className={ui.check}>
                  <input type="checkbox" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} />
                  Usuario activo (puede ingresar)
                </label>
              </div>
              <p className={`${ui.span12} ${ui.hint}`}>
                El rol define a qué partes entra (ver Roles y permisos). Crear clientes o artículos también puede venir de su agente comercial, y el límite de venta siempre viene del agente.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
