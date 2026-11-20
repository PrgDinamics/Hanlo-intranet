"use client";
/* eslint-disable @next/next/no-img-element -- logos servidos desde el cPanel de la web, no por Next */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, EyeOff, ImageUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { useConfirmar } from "@/components/ui/Confirmar";
import {
  agregarClienteWeb, editarClienteWeb, mostrarClienteWeb, moverClienteWeb, quitarClienteWeb,
} from "@/lib/acciones-clientes-web";
import { prepararLogo } from "@/lib/logo-navegador";
import type { ClienteWeb } from "@/lib/clientes-web";
import ui from "@/components/ui/ui.module.css";
import s from "./clientes-web.module.css";

type Logo = { png: Blob; url: string } | null;

/** Zona para elegir el logo: lo prepara en el navegador y muestra cómo quedó */
function ElegirLogo({ logo, actual, onLogo, onError }: { logo: Logo; actual?: string; onLogo: (l: Logo) => void; onError: (e: string) => void }) {
  return (
    <label className={s.zona}>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const r = await prepararLogo(f);
          if (!r.ok) return onError(r.error);
          onError("");
          onLogo({ png: r.png, url: r.url });
        }} />
      {logo ? <img src={logo.url} alt="Logo preparado" /> : actual ? <img src={actual} alt="Logo actual" /> : <ImageUp />}
      <span>{logo || actual ? "Clic para cambiar el logo" : <><b>Elige el logo</b><br />PNG, JPG, WebP o SVG, hasta 1 MB</>}</span>
    </label>
  );
}

export function ClientesWebAdmin({ sitio, clientes, errorInicial }: { sitio: string; clientes: ClienteWeb[]; errorInicial: string | null }) {
  const router = useRouter();
  const confirmar = useConfirmar();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(errorInicial);
  const [nombre, setNombre] = useState("");
  const [logo, setLogo] = useState<Logo>(null);
  const [editar, setEditar] = useState<{ c: ClienteWeb; nombre: string; logo: Logo } | null>(null);
  const url = (c: ClienteWeb) => `${sitio}${c.logo}`;
  const visibles = clientes.filter((c) => c.activo !== false);

  const correr = (fn: () => Promise<{ ok: boolean; error?: string }>, despues?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "No se pudo guardar");
      despues?.();
      router.refresh();
    });

  const agregar = () => {
    if (!nombre.trim()) return setError("Escribe el nombre de la empresa");
    if (!logo) return setError("Elige el logo");
    const fd = new FormData();
    fd.append("nombre", nombre.trim());
    fd.append("logo", logo.png, "logo.png");
    correr(() => agregarClienteWeb(fd) as Promise<{ ok: boolean; error?: string }>, () => { setNombre(""); setLogo(null); });
  };

  const guardarEdicion = () => {
    if (!editar) return;
    const fd = new FormData();
    fd.append("slug", editar.c.slug);
    fd.append("nombre", editar.nombre.trim());
    if (editar.logo) fd.append("logo", editar.logo.png, "logo.png");
    correr(() => editarClienteWeb(fd) as Promise<{ ok: boolean; error?: string }>, () => setEditar(null));
  };

  return (
    <div className={ui.stack}>
      {error && <div className={ui.alert}>{error}</div>}

      <div className={ui.card}>
        <div className={ui.cardHead}><span className={ui.cardTitle}><Plus /> Agregar cliente</span></div>
        <div className={`${ui.cardBody} ${s.nuevo}`}>
          <ElegirLogo logo={logo} onLogo={setLogo} onError={(e) => setError(e || null)} />
          <div className={s.campos}>
            <label className={ui.field}>
              <span className={`${ui.label} ${ui.req}`}>Nombre de la empresa</span>
              <input className={ui.input} value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <p className={s.hint}>
              Al elegirlo, el logo se prepara solo: se quita el fondo blanco, se recortan los bordes y queda de 120 px de alto con fondo transparente.
              Queda al final de la cinta; con las flechas cambias el orden.
            </p>
            <div>
              <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending} onClick={agregar}>
                <Plus /> {pending ? "Guardando..." : "Agregar a la web"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={ui.card}>
        <div className={ui.cardHead}>
          <span className={ui.cardTitle}>{clientes.length} cliente(s) · {visibles.length} visible(s) en la web</span>
        </div>
        {clientes.length === 0 ? (
          <div className={ui.cardBody}>
            <Empty>Todavía no hay clientes. Mientras tanto la web muestra los logos que trae fijos.</Empty>
          </div>
        ) : (
          <>
            {clientes.map((c, i) => (
              <div key={c.slug} className={`${s.fila} ${c.activo === false ? s.oculto : ""}`}>
                <span className={s.num}>{i + 1}</span>
                <span className={s.logo}><img src={url(c)} alt={c.nombre} /></span>
                <span>
                  <span className={s.nombre}>{c.nombre}</span>{" "}
                  {c.activo === false ? <Badge tono="muted">Oculto</Badge> : <Badge tono="ok">Visible</Badge>}
                </span>
                <span className={s.botones}>
                  <button type="button" className={`${ui.btn} ${ui.ghost}`} title="Subir" disabled={pending || i === 0}
                    onClick={() => correr(() => moverClienteWeb(c.slug, -1))}><ArrowUp /></button>
                  <button type="button" className={`${ui.btn} ${ui.ghost}`} title="Bajar" disabled={pending || i === clientes.length - 1}
                    onClick={() => correr(() => moverClienteWeb(c.slug, 1))}><ArrowDown /></button>
                  <button type="button" className={`${ui.btn} ${ui.ghost}`} title={c.activo === false ? "Mostrar en la web" : "Ocultar de la web"} disabled={pending}
                    onClick={() => correr(() => mostrarClienteWeb(c.slug, c.activo === false))}>{c.activo === false ? <Eye /> : <EyeOff />}</button>
                  <button type="button" className={`${ui.btn} ${ui.ghost}`} title="Editar nombre o logo" disabled={pending}
                    onClick={() => { setError(null); setEditar({ c, nombre: c.nombre, logo: null }); }}><Pencil /></button>
                  <button type="button" className={`${ui.btn} ${ui.ghost}`} title="Quitar" disabled={pending}
                    onClick={async () => {
                      if (!(await confirmar({ titulo: `Quitar ${c.nombre}`, mensaje: "Sale de la web y se borra su logo del cPanel. Para que no aparezca un tiempo, mejor ocúltalo.", peligro: true, aceptar: "Quitar" }))) return;
                      correr(() => quitarClienteWeb(c.slug));
                    }}><Trash2 /></button>
                </span>
              </div>
            ))}
            <div className={s.cinta} aria-label="Así se ve en la web">
              {visibles.map((c) => <img key={c.slug} src={url(c)} alt={c.nombre} title={c.nombre} />)}
            </div>
          </>
        )}
      </div>

      <Modal open={!!editar} onClose={() => setEditar(null)} title="Editar cliente" width={520}
        footer={<>
          <button className={ui.btn} onClick={() => setEditar(null)}>Cancelar</button>
          <button className={`${ui.btn} ${ui.primary}`} disabled={pending} onClick={guardarEdicion}>{pending ? "Guardando..." : "Guardar"}</button>
        </>}>
        {editar && (
          <div className={ui.stack}>
            {error && <div className={ui.alert}>{error}</div>}
            <ElegirLogo logo={editar.logo} actual={url(editar.c)} onLogo={(l) => setEditar((e) => (e ? { ...e, logo: l } : e))} onError={(e) => setError(e || null)} />
            <label className={ui.field}>
              <span className={`${ui.label} ${ui.req}`}>Nombre de la empresa</span>
              <input className={ui.input} value={editar.nombre} maxLength={80} onChange={(e) => setEditar((x) => (x ? { ...x, nombre: e.target.value } : x))} />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
