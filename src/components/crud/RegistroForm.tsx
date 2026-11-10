"use client";

import { useRef, useState, useTransition } from "react";
import { AlertCircle, ImagePlus, Save, Search, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { guardarRegistro, eliminarRegistro } from "@/lib/acciones";
import { consultarDocumento } from "@/lib/acciones-externas";
import { MODULOS, type Campo, type Opcion } from "@/lib/modulos";
import { FotoZoom } from "@/components/ui/FotoZoom";
import ui from "@/components/ui/ui.module.css";
import s from "./crud.module.css";

const SPAN: Record<number, string> = { 3: ui.span3, 4: ui.span4, 6: ui.span6, 8: ui.span8, 12: ui.span12 };

export type Refs = Record<string, Opcion[]>;

function valorInicial(c: Campo, registro?: Record<string, unknown> | null) {
  const v = registro?.[c.name];
  if (v !== undefined && v !== null) return v;
  return c.default ?? (c.type === "checkbox" ? false : "");
}

export function RegistroForm({
  modKey, registro, refs, onSaved, onDeleted, onCancel, compact, consulta, soloLectura,
}: {
  modKey: string;
  registro?: Record<string, unknown> | null;
  refs: Refs;
  onSaved?: (id: string) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
  compact?: boolean;
  /** Mostrar botón para autocompletar desde SUNAT/RENIEC */
  consulta?: boolean;
  /** Sin permiso de edición: muestra los datos deshabilitados */
  soloLectura?: boolean;
}) {
  const mod = MODULOS[modKey];
  const id = (registro?.id as string) ?? null;
  const [valores, setValores] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(mod.campos.map((c) => [c.name, valorInicial(c, registro)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const enviando = useRef(false); // evita duplicados por doble clic

  const set = (name: string, v: unknown) => {
    setValores((p) => ({ ...p, [name]: v }));
    setOkMsg(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando.current) return;
    enviando.current = true;
    setError(null);
    start(async () => {
      try {
        const r = await guardarRegistro(modKey, id, valores);
        if (!r.ok) return setError(r.error);
        setOkMsg("Cambios guardados");
        onSaved?.(r.id);
      } finally {
        enviando.current = false;
      }
    });
  };

  const [buscando, setBuscando] = useState(false);
  const [infoDoc, setInfoDoc] = useState<{ texto: string; alerta: boolean } | null>(null);

  const buscarDocumento = async () => {
    const cfg = mod.consulta;
    if (!cfg) return;
    const tipo = cfg.tipo ? String(valores[cfg.tipo] ?? "RUC") : "RUC";
    setError(null);
    setInfoDoc(null);
    setBuscando(true);
    const r = await consultarDocumento(tipo, String(valores[cfg.doc] ?? ""));
    setBuscando(false);
    if (!r.ok) return setError(r.error);
    setValores((p) => {
      const n = { ...p, [cfg.nombre]: r.datos.nombre };
      if (r.datos.direccion) n[cfg.direccion] = r.datos.direccion;
      return n;
    });
    if (r.datos.estado || r.datos.condicion) {
      const alerta = (r.datos.estado && r.datos.estado !== "ACTIVO") || (r.datos.condicion && r.datos.condicion !== "HABIDO");
      setInfoDoc({ texto: `SUNAT: ${[r.datos.estado, r.datos.condicion].filter(Boolean).join(" · ")}`, alerta: !!alerta });
    } else {
      setInfoDoc({ texto: "Datos obtenidos de RENIEC", alerta: false });
    }
  };

  const eliminar = () => {
    if (!id || !confirm(`¿Eliminar este ${mod.singular}? Esta acción no se puede deshacer.`)) return;
    start(async () => {
      const r = await eliminarRegistro(modKey, id);
      if (!r.ok) return setError(r.error);
      onDeleted?.();
    });
  };

  return (
    <form onSubmit={submit} className={ui.stack}>
      {soloLectura && (
        <div className={ui.hint} style={{ background: "var(--muted-soft)", padding: "8px 12px", borderRadius: 7 }}>
          Solo lectura: tu usuario no tiene permiso para modificar {mod.titulo.toLowerCase()}.
        </div>
      )}
      <fieldset disabled={soloLectura} style={{ border: "none", minWidth: 0 }} className={ui.stack}>
      {error && <div className={ui.alert}><AlertCircle /> {error}</div>}
      {okMsg && <div className={`${ui.alert} ${ui.alertOk}`}>{okMsg}</div>}
      <div className={ui.grid}>
        {mod.campos.map((c) => (
          <div key={c.name} className={SPAN[c.span ?? 12]}>
            <CampoInput
              campo={c}
              value={valores[c.name]}
              onChange={(v) => set(c.name, v)}
              refs={refs}
              tabla={mod.tabla}
              extra={
                consulta && !soloLectura && mod.consulta?.doc === c.name ? (
                  <button type="button" className={`${ui.btn} ${s.lookupBtn}`} onClick={buscarDocumento} disabled={buscando}
                    title="Autocompletar desde SUNAT / RENIEC">
                    <Search /> {buscando ? "..." : "Buscar"}
                  </button>
                ) : null
              }
              nota={mod.consulta?.doc === c.name && infoDoc ? infoDoc : null}
            />
          </div>
        ))}
      </div>
      </fieldset>
      {!soloLectura && <div className={`${ui.row} ${compact ? "" : s.formActions}`}>
        {id && onDeleted && (
          <button type="button" className={`${ui.btn} ${ui.danger}`} onClick={eliminar} disabled={pending}>
            <Trash2 /> Eliminar
          </button>
        )}
        <span className={ui.spacer} />
        {onCancel && (
          <button type="button" className={ui.btn} onClick={onCancel} disabled={pending}>Cancelar</button>
        )}
        <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
          <Save /> {pending ? "Guardando..." : id ? "Guardar cambios" : `Crear ${mod.singular}`}
        </button>
      </div>}
    </form>
  );
}

function CampoInput({
  campo: c, value, onChange, refs, tabla, extra, nota,
}: {
  campo: Campo;
  value: unknown;
  onChange: (v: unknown) => void;
  refs: Refs;
  tabla: string;
  extra?: React.ReactNode;
  nota?: { texto: string; alerta: boolean } | null;
}) {
  if (c.type === "checkbox") {
    return (
      <label className={ui.check}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {c.label}
      </label>
    );
  }

  const v = value === null || value === undefined ? "" : String(value);
  let input: React.ReactNode;
  if (c.type === "textarea") {
    input = <textarea className={ui.input} value={v} onChange={(e) => onChange(e.target.value)} required={c.required} />;
  } else if (c.type === "select") {
    const opts = c.ref ? refs[c.ref.tabla] ?? [] : c.options ?? [];
    input = (
      <select className={ui.input} value={v} onChange={(e) => onChange(e.target.value)} required={c.required}>
        {!c.required && <option value="">(ninguno)</option>}
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (c.type === "image") {
    input = <ImagenInput value={v} onChange={onChange} carpeta={tabla} />;
  } else {
    const listId = c.sugerencias ? `sug-${tabla}-${c.name}` : undefined;
    input = (
      <>
      {c.sugerencias && (
        <datalist id={listId}>{c.sugerencias.map((o) => <option key={o} value={o} />)}</datalist>
      )}
      <input
        className={extra ? `${ui.input} ${s.docInput}` : ui.input}
        list={listId}
        type={c.type}
        step={c.step}
        value={v}
        placeholder={c.placeholder}
        // Campo de RUC con botón Buscar: solo dígitos, 11 como máximo
        inputMode={extra ? "numeric" : undefined}
        onChange={(e) => {
          const t = extra ? e.target.value.replace(/\D/g, "").slice(0, 11) : e.target.value;
          onChange(c.upper ? t.toUpperCase() : t);
        }}
        required={c.required}
      />
      </>
    );
  }

  return (
    <label className={ui.field}>
      <span className={`${ui.label} ${c.required ? ui.req : ""}`}>{c.label}</span>
      {extra ? <div className={s.withBtn}>{input}{extra}</div> : input}
      {nota && (
        <span className={ui.hint} style={{ color: nota.alerta ? "var(--danger)" : "var(--ok)", fontWeight: 500 }}>{nota.texto}</span>
      )}
      {c.hint && <span className={ui.hint}>{c.hint}</span>}
    </label>
  );
}

function ImagenInput({ value, onChange, carpeta }: { value: string; onChange: (v: unknown) => void; carpeta: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const subir = async (file: File) => {
    setErr(null);
    if (file.size > 3 * 1024 * 1024) return setErr("La imagen debe pesar menos de 3 MB");
    setSubiendo(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${carpeta}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("media").upload(path, await file.arrayBuffer(), { contentType: file.type });
    setSubiendo(false);
    if (error) return setErr("No se pudo subir la imagen: " + error.message);
    onChange(supabase.storage.from("media").getPublicUrl(path).data.publicUrl);
  };

  return (
    <div className={s.image}>
      {value ? (
        <FotoZoom src={value} tam={84} className={s.imageZoom} />
      ) : (
        <div className={s.imageBox}><ImagePlus /></div>
      )}
      <div className={ui.stack} style={{ gap: 6 }}>
        <div className={ui.row}>
          <button type="button" className={`${ui.btn} ${ui.sm}`} onClick={() => ref.current?.click()} disabled={subiendo}>
            <ImagePlus /> {subiendo ? "Subiendo..." : value ? "Cambiar imagen" : "Subir imagen"}
          </button>
          {value && (
            <button type="button" className={`${ui.btn} ${ui.sm} ${ui.ghost}`} onClick={() => onChange("")}>
              Quitar
            </button>
          )}
        </div>
        <span className={ui.hint}>JPG, PNG o WEBP hasta 3 MB</span>
        {err && <span className={ui.hint} style={{ color: "var(--danger)" }}>{err}</span>}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])}
      />
    </div>
  );
}
